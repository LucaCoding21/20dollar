"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Expense, type Goal, type Person } from "@/lib/supabase";
import { bankBalance, DAILY_ALLOWANCE } from "@/lib/bank";

/* ------------------------------------------------------------------ */
/*  Data (matches the reference mockup 1:1)                            */
/* ------------------------------------------------------------------ */

const AVATAR: Record<Person, string> = {
  luca: "/assetsforai(renameme)/luca.png",
  irish: "/assetsforai(renameme)/irish.png",
};

// Both faces are tight head-only crops in the same style, so they read
// at the same size with no per-person correction.
const AVATAR_SCALE: Record<Person, number> = { luca: 1, irish: 1 };

const NAME: Record<Person, string> = { luca: "Luca", irish: "Irish" };

const VANCOUVER = "America/Vancouver";

// Hand-drawn category icons live in /public/categories/<slug>.png. We have no
// dedicated picker yet (not in the reference), so the category is inferred from
// the note keywords at insert time and persisted on the row.
const CATEGORY_SLUGS = [
  "coffee", "food", "groceries", "transport", "fun",
  "clothes", "gifts", "bills", "health", "shopping",
] as const;

// Friendly label shown in the analytics "Where it went" breakdown. Mirrors the
// everyday words the couple uses (food → "Snacks", transport → "Bus").
const CATEGORY_LABEL: Record<string, string> = {
  coffee: "Coffee", food: "Snacks", groceries: "Groceries", transport: "Bus",
  fun: "Fun", clothes: "Clothes", gifts: "Gifts", bills: "Bills",
  health: "Health", shopping: "Shopping",
};

// Keyword + merchant/brand lexicon. Multi-word entries (with a space) are
// matched as phrases and weighted highest, so "uber eats" lands in food, not
// transport. Lists lean Vancouver-local since that's who uses this.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  coffee: ["coffee", "latte", "espresso", "americano", "cappuccino", "mocha", "macchiato", "cafe", "tea", "chai", "matcha", "boba", "bubble tea", "starbucks", "tim hortons", "tims", "blenz", "jj bean", "nespresso", "brew"],
  food: ["food", "snack", "lunch", "dinner", "brunch", "breakfast", "eat", "eating", "restaurant", "takeout", "take out", "delivery", "doordash", "uber eats", "skip the dishes", "meal", "pizza", "burger", "sushi", "ramen", "noodles", "fries", "taco", "sandwich", "mcdonalds", "chipotle", "ice cream"],
  groceries: ["grocery", "groceries", "grocer", "market", "supermarket", "safeway", "costco", "walmart", "save on foods", "save-on", "superstore", "no frills", "whole foods", "tnt", "produce"],
  transport: ["bus", "train", "uber", "lyft", "taxi", "cab", "transit", "fare", "gas", "fuel", "petrol", "skytrain", "seabus", "compass", "compass card", "parking", "toll", "evo", "ferry", "bc ferries", "gondola"],
  fun: ["movie", "game", "gaming", "party", "concert", "netflix", "spotify", "disney", "arcade", "bowling", "ticket", "amusement park", "playland", "escape room", "karaoke"],
  clothes: ["clothes", "clothing", "shirt", "tshirt", "t-shirt", "shoe", "sneakers", "jacket", "coat", "pants", "dress", "hoodie", "sweater", "sock", "jeans", "hat", "lululemon", "uniqlo", "zara", "nike", "adidas"],
  gifts: ["gift", "present", "birthday", "anniversary", "valentine", "christmas", "wedding"],
  bills: ["bill", "rent", "subscription", "phone", "internet", "hydro", "wifi", "insurance", "utility", "utilities", "electricity", "mortgage", "credit card", "fido", "telus", "rogers", "shaw"],
  health: ["health", "doctor", "pharmacy", "drugstore", "shoppers", "london drugs", "medicine", "med", "gym", "fitness", "dentist", "vitamin", "prescription", "therapy", "physio"],
  shopping: ["shop", "shopping", "store", "amazon", "mall", "online", "ikea", "best buy", "dollar store", "dollarama", "winners", "electronics"],
};

// Fold accents, lowercase, and reduce punctuation to spaces so "Café",
// "t-shirt", and "PIZZA!!!" all normalize cleanly.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORM_KEYWORDS: Record<string, { words: string[]; phrases: string[] }> =
  Object.fromEntries(
    CATEGORY_SLUGS.map((slug) => {
      const words: string[] = [];
      const phrases: string[] = [];
      for (const raw of CATEGORY_KEYWORDS[slug]) {
        const n = normalize(raw);
        (n.includes(" ") ? phrases : words).push(n);
      }
      return [slug, { words, phrases }];
    }),
  );

// Levenshtein, bailing out early once we exceed 1 edit (all we care about).
function within1Edit(a: string, b: string): boolean {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return false;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > 1) return false; // whole row already over budget
    prev = cur;
  }
  return prev[n] <= 1;
}

// Score every category and take the strongest signal: exact/plural word = 2,
// multi-word phrase = 3, fuzzy (1-typo) word ≥5 chars = 1. Ties fall back to
// CATEGORY_SLUGS order. Returns null when nothing scores.
function inferCategory(note: string): string | null {
  const norm = normalize(note);
  if (!norm) return null;
  const tokens = norm.split(" ");
  const tokenSet = new Set(tokens);
  const padded = ` ${norm} `;

  let bestSlug: string | null = null;
  let bestScore = 0;

  for (const slug of CATEGORY_SLUGS) {
    const { words, phrases } = NORM_KEYWORDS[slug];
    let score = 0;

    for (const phrase of phrases) {
      if (padded.includes(` ${phrase} `)) score += 3;
    }

    for (const kw of words) {
      const plural = kw.endsWith("s") ? kw.slice(0, -1) : `${kw}s`;
      if (tokenSet.has(kw) || tokenSet.has(plural)) {
        score += 2;
        continue;
      }
      if (kw.length >= 5) {
        for (const t of tokens) {
          if (t.length >= 5 && within1Edit(t, kw)) {
            score += 1;
            break;
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestSlug = slug;
    }
  }

  return bestSlug;
}

function categoryIcon(slug: string | null): string {
  return `/categories/${slug && (CATEGORY_SLUGS as readonly string[]).includes(slug) ? slug : "shopping"}.png`;
}

// Stored `amount` is positive for a spend, negative for money paid back in.
function formatAmount(amount: number): { text: string; spent: boolean } {
  const spent = amount > 0;
  const abs = Math.abs(amount);
  const num = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return { text: `${spent ? "-" : "+"}$${num}`, spent };
}

function formatBalance(balance: number): string {
  const neg = balance < 0;
  const abs = Math.abs(balance);
  const num = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${neg ? "-" : ""}$${num}`;
}

// Compact dollars for goals: "$120", "$67.50". Always non-negative here.
function money(n: number): string {
  const abs = Math.abs(n);
  return `$${Number.isInteger(abs) ? String(abs) : abs.toFixed(2)}`;
}

// Fraction filled (0..1), guarding against a zero / missing target.
function goalProgress(g: Goal): number {
  const t = Number(g.target);
  if (!(t > 0)) return 0;
  return Math.min(1, Math.max(0, Number(g.saved) / t));
}

// Upload a goal photo to the public `goals` bucket and return its public URL.
// Returns null on failure (caller surfaces the error).
async function uploadGoalImage(file: File): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("goals")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) return null;
  return supabase.storage.from("goals").getPublicUrl(path).data.publicUrl;
}

// "Today · 9:12 AM" / "Yesterday · 6:47 PM" / "May 10 · 8:21 AM" — civil dates
// compared in Vancouver time so the labels match the allowance roll-over.
function formatWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: VANCOUVER,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(x);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: VANCOUVER,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);

  const that = day(d);
  let label: string;
  if (that === day(now)) label = "Today";
  else if (that === day(new Date(now.getTime() - 86_400_000))) label = "Yesterday";
  else label = new Intl.DateTimeFormat("en-US", { timeZone: VANCOUVER, month: "short", day: "numeric" }).format(d);

  return `${label} · ${time}`;
}

/* ------------------------------------------------------------------ */
/*  Icons                                                             */
/* ------------------------------------------------------------------ */


function PenDoodle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 40" fill="none" className={className}>
      <path
        d="M30 8c3-3 6-3 8-1s2 5-1 8L17 35l-7 2 2-7L30 8Z"
        stroke="#3a3a3a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M27 11l8 8" stroke="#3a3a3a" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M40 34c2-2 4-2 6 0s4 2 6 0"
        stroke="#3a3a3a"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <path
        d="M8 10h24c2.2 0 4 1.8 4 4v11c0 2.2-1.8 4-4 4H19l-7 6v-6H8c-2.2 0-4-1.8-4-4V14c0-2.2 1.8-4 4-4Z"
        stroke="#9a9aa0"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="19.5" r="1.9" fill="#9a9aa0" />
      <circle cx="20" cy="19.5" r="1.9" fill="#9a9aa0" />
      <circle cx="26" cy="19.5" r="1.9" fill="#9a9aa0" />
    </svg>
  );
}

function HeartIcon({ className = "", color = "#1f1f1f" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 32 30" fill="none" className={className}>
      <path
        d="M16 27S3 19.5 3 10.6C3 6.4 6.2 3.5 10 3.5c2.6 0 4.8 1.4 6 3.6 1.2-2.2 3.4-3.6 6-3.6 3.8 0 7 2.9 7 7.1C29 19.5 16 27 16 27Z"
        fill={color === "#1f1f1f" ? "none" : color}
        stroke={color}
        strokeWidth={color === "#1f1f1f" ? 2.2 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* nav icons */
function HomeIcon({ className = "", color = "#1f1f1f" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 32 30" fill="none" className={className}>
      <path
        d="M4 14 16 4l12 10"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 12v13h7v-7h4v7h7V12"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BarsIcon({ className = "", color = "#1f1f1f" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 32 30" fill="none" className={className}>
      <rect x="4.5" y="13" width="5.5" height="12" rx="2.4" stroke={color} strokeWidth="2.3" />
      <rect x="13.2" y="5.5" width="5.5" height="19.5" rx="2.4" stroke={color} strokeWidth="2.3" />
      <rect x="21.9" y="10" width="5.5" height="15" rx="2.4" stroke={color} strokeWidth="2.3" />
    </svg>
  );
}

function StarIcon({
  className = "",
  color = "#1f1f1f",
  filled = false,
}: {
  className?: string;
  color?: string;
  filled?: boolean;
}) {
  return (
    <svg viewBox="0 0 32 30" fill="none" className={className}>
      <path
        d="M16 4l3.3 7.4 8 .8-6 5.4 1.7 7.9L16 22.7 8.9 25.5l1.8-7.9-6-5.4 8-.8L16 4Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon({ className = "", color = "#1f1f1f" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <path
        d="M13.5 3.2h5l.7 3.1c.9.3 1.7.8 2.5 1.4l3-1.1 2.5 4.3-2.3 2.1c.1.5.1 1 .1 1.5s0 1-.1 1.5l2.3 2.1-2.5 4.3-3-1.1c-.8.6-1.6 1.1-2.5 1.4l-.7 3.1h-5l-.7-3.1c-.9-.3-1.7-.8-2.5-1.4l-3 1.1-2.5-4.3 2.3-2.1c-.1-.5-.1-1-.1-1.5s0-1 .1-1.5L1.3 11l2.5-4.3 3 1.1c.8-.6 1.6-1.1 2.5-1.4l.7-3.2Z"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="4" stroke={color} strokeWidth="2.2" />
    </svg>
  );
}

function ChevronLeftIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M15 5l-7 7 7 7" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon({ className = "", color = "#c2c2c8" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 5l7 7-7 7" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon({ className = "", color = "#9a9aa0" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M14.5 5.5l4 4M4 20l1-4L16 5c.8-.8 2.2-.8 3 0s.8 2.2 0 3L8 19l-4 1Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className = "", color = "#9a9aa0" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5 7h14M10 7V5.5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V7M6.5 7l.8 12c0 .6.5 1 1 1h7.4c.5 0 1-.4 1-1l.8-12"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.5 10.5v6.5M13.5 10.5v6.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function FlagIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 21V4" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M6 4.5h11.5l-2.2 3.4 2.2 3.4H6"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon({ className = "", color = "#2f63e6" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon({ className = "", color = "#9a9aa0" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 8.5h3l1.4-2h7.2L17 8.5h3c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-7c0-1.1.9-2 2-2Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3.3" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                             */
/* ------------------------------------------------------------------ */

// A goal's icon IS its uploaded photo (square crop). Falls back to a star tile
// when a goal has no photo yet.
function GoalImage({ url, size, className = "" }: { url: string | null; size: number; className?: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className={`shrink-0 rounded-[14px] object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[14px] bg-[#eef3fb] ${className}`}
      style={{ width: size, height: size }}
    >
      <StarIcon className="w-1/2" color="#9bb4e6" />
    </span>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-full bg-[#dfe7f4] ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#6790dc] to-[#5181d4] transition-[width]"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition ${
        on ? "bg-gradient-to-b from-[#6790dc] to-[#5181d4]" : "bg-[#dfe2ea]"
      }`}
    >
      <span
        className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-[left] ${
          on ? "left-[23px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

function Avatar({ person, size }: { person: Person; size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={AVATAR[person]}
        alt={NAME[person]}
        className="object-contain"
        style={{ width: size, height: size, transform: `scale(${AVATAR_SCALE[person]})` }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen                                                            */
/* ------------------------------------------------------------------ */

export default function BankApp() {
  const [who, setWho] = useState<Person>("luca");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which screen is showing. Home tab = home/all; Goals tab = goals/allGoals.
  const [view, setView] = useState<
    "home" | "all" | "goals" | "allGoals" | "analytics" | "category"
  >("home");
  // The category whose full history is showing on the "category" screen.
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Person>("all");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);

  // Goals screen state: which goal is being funded / edited / removed, and
  // whether the "new goal" sheet is open.
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [pendingDeleteGoal, setPendingDeleteGoal] = useState<Goal | null>(null);

  // Re-render every minute so the balance rolls over at Vancouver midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const [ex, gl] = await Promise.all([
      supabase.from("expenses").select("*").order("created_at", { ascending: false }),
      supabase.from("goals").select("*").order("created_at", { ascending: false }),
    ]);
    if (ex.error) setError(ex.error.message);
    else if (gl.error) setError(gl.error.message);
    else {
      setError(null);
      setExpenses((ex.data ?? []) as Expense[]);
      setGoals((gl.data ?? []) as Goal[]);
    }
    setLoading(false);
  }, []);

  const loadGoals = useCallback(async () => {
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setGoals((data ?? []) as Goal[]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalSpent = useMemo(
    () => expenses.reduce((sum, e) => sum + Number(e.amount), 0),
    [expenses],
  );
  // Money parked in goals is set aside from the bank, so it shrinks the
  // available balance just like a spend does.
  const totalSaved = useMemo(
    () => goals.reduce((sum, g) => sum + Number(g.saved), 0),
    [goals],
  );
  const balance = bankBalance(totalSpent + totalSaved, now);

  async function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0 || saving) return;

    setSaving(true);
    const trimmed = note.trim();
    const { error } = await supabase.from("expenses").insert({
      person: who,
      amount: value,
      note: trimmed || null,
      category: inferCategory(trimmed),
    });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }
    setAmount("");
    setNote("");
    load();
  }

  async function saveEdit(row: Expense, next: { amount: number; note: string; person: Person }) {
    const trimmed = next.note.trim();
    const { error } = await supabase
      .from("expenses")
      .update({
        person: next.person,
        amount: next.amount,
        note: trimmed || null,
        category: inferCategory(trimmed),
      })
      .eq("id", row.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setEditing(null);
    load();
  }

  async function deleteExpense(row: Expense) {
    const { error } = await supabase.from("expenses").delete().eq("id", row.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setPendingDelete(null);
    load();
  }

  /* ---- goal operations ---- */

  // Move `amount` out of the bank and into the goal (bumps `saved`).
  async function contributeToGoal(goal: Goal, amount: number) {
    const { error } = await supabase
      .from("goals")
      .update({ saved: Number(goal.saved) + amount })
      .eq("id", goal.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setContributing(null);
    loadGoals();
  }

  // Make `id` the one featured "current" goal, clearing the flag on the rest.
  async function markCurrent(id: string): Promise<boolean> {
    const cleared = await supabase.from("goals").update({ is_current: false }).neq("id", id);
    if (cleared.error) {
      setError(cleared.error.message);
      return false;
    }
    const set = await supabase.from("goals").update({ is_current: true }).eq("id", id);
    if (set.error) {
      setError(set.error.message);
      return false;
    }
    return true;
  }

  async function createGoal(next: {
    title: string;
    subtitle: string;
    target: number;
    image_url: string | null;
    makeCurrent: boolean;
  }) {
    const { data, error } = await supabase
      .from("goals")
      .insert({
        title: next.title,
        subtitle: next.subtitle || null,
        target: next.target,
        saved: 0,
        image_url: next.image_url,
        // The very first goal is current by default.
        is_current: next.makeCurrent || goals.length === 0,
      })
      .select("id")
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    // Clearing the flag on the others is a no-op when this goal isn't current.
    if (data && (next.makeCurrent || goals.length === 0)) await markCurrent(data.id);
    setError(null);
    setNewGoalOpen(false);
    loadGoals();
  }

  async function saveGoalEdit(
    goal: Goal,
    next: {
      title: string;
      subtitle: string;
      target: number;
      image_url: string | null;
      makeCurrent: boolean;
    },
  ) {
    const { error } = await supabase
      .from("goals")
      .update({
        title: next.title,
        subtitle: next.subtitle || null,
        target: next.target,
        image_url: next.image_url,
      })
      .eq("id", goal.id);
    if (error) {
      setError(error.message);
      return;
    }
    if (next.makeCurrent && !goal.is_current) await markCurrent(goal.id);
    setError(null);
    setEditingGoal(null);
    loadGoals();
  }

  async function setGoalCurrent(goal: Goal) {
    if (goal.is_current) return;
    if (await markCurrent(goal.id)) loadGoals();
  }

  // Removing a goal returns its parked money to the bank automatically, since
  // the balance subtracts the sum of every goal's `saved`.
  async function deleteGoal(goal: Goal) {
    const { error } = await supabase.from("goals").delete().eq("id", goal.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setPendingDeleteGoal(null);
    loadGoals();
  }

  // Shared modal stack for the goals screens (mounted by both goals + allGoals).
  const goalModals = (
    <>
      {contributing && (
        <ContributeModal
          goal={contributing}
          available={balance}
          onClose={() => setContributing(null)}
          onConfirm={contributeToGoal}
        />
      )}
      {newGoalOpen && (
        <GoalFormModal onClose={() => setNewGoalOpen(false)} onSave={createGoal} />
      )}
      {editingGoal && (
        <GoalFormModal
          goal={editingGoal}
          onClose={() => setEditingGoal(null)}
          onSave={(next) => saveGoalEdit(editingGoal, next)}
        />
      )}
      {pendingDeleteGoal && (
        <ConfirmDeleteGoalModal
          goal={pendingDeleteGoal}
          onCancel={() => setPendingDeleteGoal(null)}
          onConfirm={() => deleteGoal(pendingDeleteGoal)}
        />
      )}
    </>
  );

  if (view === "analytics") {
    return (
      <AnalyticsScreen
        expenses={expenses}
        loading={loading}
        now={now}
        onHome={() => setView("home")}
        onGoals={() => setView("goals")}
        onViewCategory={(slug) => {
          setCategorySlug(slug);
          setView("category");
        }}
      />
    );
  }

  if (view === "category" && categorySlug) {
    return (
      <CategoryActivityScreen
        slug={categorySlug}
        expenses={expenses}
        loading={loading}
        now={now}
        onBack={() => setView("analytics")}
        onHome={() => setView("home")}
        onGoals={() => setView("goals")}
      />
    );
  }

  if (view === "all") {
    return (
      <AllActivityScreen
        expenses={expenses}
        loading={loading}
        now={now}
        filter={filter}
        onFilter={setFilter}
        onBack={() => setView("home")}
        onGoals={() => setView("goals")}
        onEdit={setEditing}
        onDelete={setPendingDelete}
        editing={editing}
        onCloseEdit={() => setEditing(null)}
        onSaveEdit={saveEdit}
        pendingDelete={pendingDelete}
        onCancelDelete={() => setPendingDelete(null)}
        onConfirmDelete={deleteExpense}
        error={error}
      />
    );
  }

  if (view === "goals") {
    return (
      <>
        <GoalsScreen
          goals={goals}
          loading={loading}
          error={error}
          onHome={() => setView("home")}
          onViewAll={() => setView("allGoals")}
          onContribute={setContributing}
          onNewGoal={() => setNewGoalOpen(true)}
        />
        {goalModals}
      </>
    );
  }

  if (view === "allGoals") {
    return (
      <>
        <AllGoalsScreen
          goals={goals}
          loading={loading}
          error={error}
          onBack={() => setView("goals")}
          onHome={() => setView("home")}
          onContribute={setContributing}
          onNewGoal={() => setNewGoalOpen(true)}
          onEdit={setEditingGoal}
          onDelete={setPendingDeleteGoal}
          onSetCurrent={setGoalCurrent}
        />
        {goalModals}
      </>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-20 pt-[max(env(safe-area-inset-top),14px)]">
        {/* ---- Shared Bank card ---- */}
        <section className="relative overflow-hidden rounded-[22px] bg-[#e7f1fd] px-5 pt-3.5 pb-4 shadow-[0_8px_24px_rgba(120,150,200,0.18)]">
          <p className="text-center text-[15px] text-[#3a3a3a]">Shared Bank</p>
          <p
            className={`mt-0.5 text-center text-[46px] leading-none ${
              balance < 0 ? "text-[#d4453e]" : "text-black"
            }`}
          >
            {loading ? "—" : formatBalance(balance)}
          </p>
          <p className="mt-2 text-center text-[11px] text-[#8d8d93]">
            <span className="text-[#2f63e6]">+ ${DAILY_ALLOWANCE}</span> every midnight (Vancouver time)
          </p>
        </section>

        {/* ---- person chips ---- */}
        <div className="flex justify-center gap-3.5">
          <PersonChip person="luca" heartColor="#2f63e6" />
          <PersonChip person="irish" heartColor="#f3a6c9" />
        </div>

        {/* ---- Add a transaction ---- */}
        <section className="relative rounded-[22px] bg-white px-4 pt-3.5 pb-4 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] text-[#2b2b2b]">Add a transaction</h2>
            <PenDoodle className="w-9 opacity-90" />
          </div>

          <div className="mb-2.5 flex items-stretch gap-2">
            {/* amount */}
            <div className="flex flex-1 items-center gap-1.5 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
              <span className="text-[18px] text-[#2b2b2b]">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-[18px] text-[#2b2b2b] outline-none placeholder:text-[#c3c6ce]"
              />
            </div>
            {/* person toggle */}
            <div className="flex items-stretch overflow-hidden rounded-[14px] border border-[#e7e9ef]">
              {(["luca", "irish"] as Person[]).map((p) => {
                const active = who === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setWho(p)}
                    className={`flex items-center gap-1 rounded-[14px] py-1.5 pl-1.5 pr-2.5 transition ${
                      active ? "border border-[#a3b8e6] bg-[#dbe3f6]" : "border border-transparent"
                    }`}
                  >
                    <Avatar person={p} size={26} />
                    <span className="text-[14px] text-[#2b2b2b]">{NAME[p]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* note */}
          <div className="mb-3 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
            <ChatIcon className="w-4 shrink-0" />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was it for?"
              className="w-full bg-transparent text-[14px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
            />
          </div>

          {/* submit */}
          <button
            type="button"
            onClick={submit}
            disabled={saving || amount.trim() === ""}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add transaction"}
          </button>
          {error && (
            <p className="mt-2.5 text-center text-[12px] text-[#d4453e]">{error}</p>
          )}
        </section>

        {/* ---- Recent activity ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-1.5 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-0.5 flex items-center justify-between">
            <h2 className="text-[16px] text-[#2b2b2b]">Recent activity</h2>
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setView("all");
              }}
              className="text-[13px] text-[#2f63e6]"
            >
              View all
            </button>
          </div>
          {loading ? null : expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-5">
              <Avatar person="luca" size={52} />
              <p className="mt-2 text-[14px] text-[#2b2b2b]">No activity yet</p>
              <p className="mt-0.5 text-[12px] text-[#a9a9b0]">Add a transaction to get started!</p>
            </div>
          ) : (
            <ul>
              {expenses.map((e, i) => {
                const { text, spent } = formatAmount(Number(e.amount));
                const label = e.note || (spent ? "Spent" : "Paid back");
                return (
                  <li
                    key={e.id}
                    className={`flex items-center gap-2.5 py-2 ${
                      i !== expenses.length - 1 ? "border-b border-[#f0f0f2]" : ""
                    }`}
                  >
                    <Avatar person={e.person} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-tight text-[#2b2b2b]">
                        {NAME[e.person]} <span className="mx-1 text-[#c2c2c8]">·</span> {label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#a9a9b0]">
                        {formatWhen(e.created_at, now)}
                      </p>
                    </div>
                    <span className={`text-[14px] ${spent ? "text-[#2b2b2b]" : "text-[#18953f]"}`}>
                      {text}
                    </span>
                    <span className="flex w-6 shrink-0 justify-center">
                      {spent ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={categoryIcon(e.category)} alt="" className="h-5 w-5 object-contain" />
                      ) : (
                        <HeartIcon className="w-5" />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <BottomNav
        tab="home"
        onHome={() => setView("home")}
        onGoals={() => setView("goals")}
        onAnalytics={() => setView("analytics")}
      />
    </div>
  );
}

function PersonChip({ person, heartColor }: { person: Person; heartColor: string }) {
  return (
    <div className="flex flex-1 max-w-[180px] items-center justify-center gap-2 rounded-[24px] bg-white px-3 py-1.5 shadow-[0_6px_18px_rgba(120,150,200,0.14)]">
      <Avatar person={person} size={44} />
      <div className="flex flex-col items-start">
        <span className="text-[17px] leading-none text-[#2b2b2b]">{NAME[person]}</span>
        <HeartIcon className="mt-1.5 w-4" color={heartColor} />
      </div>
    </div>
  );
}

function NavItem({
  label,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1">
      {icon}
      <span className={`text-[12px] ${active ? "text-[#2f63e6]" : "text-[#2b2b2b]"}`}>
        {label}
      </span>
    </button>
  );
}

// Shared bottom nav. `tab` highlights the active section; Home, Analytics, and
// Goals route. Settings isn't built yet (no-op).
function BottomNav({
  tab,
  onHome,
  onGoals,
  onAnalytics,
}: {
  tab: "home" | "goals" | "analytics";
  onHome: () => void;
  onGoals: () => void;
  onAnalytics?: () => void;
}) {
  const blue = "#2f63e6";
  const dark = "#1f1f1f";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20">
      <div className="mx-auto max-w-[420px] px-4 pb-[max(env(safe-area-inset-bottom),8px)] pt-1">
        <div className="flex items-center justify-around rounded-[22px] bg-white/95 py-2 shadow-[0_-2px_20px_rgba(120,150,200,0.18)] backdrop-blur">
          <NavItem
            label="Home"
            active={tab === "home"}
            onClick={onHome}
            icon={<HomeIcon className="w-5" color={tab === "home" ? blue : dark} />}
          />
          <NavItem
            label="Analytics"
            active={tab === "analytics"}
            onClick={onAnalytics}
            icon={<BarsIcon className="w-5" color={tab === "analytics" ? blue : dark} />}
          />
          <NavItem
            label="Goals"
            active={tab === "goals"}
            onClick={onGoals}
            icon={<StarIcon className="w-5" color={tab === "goals" ? blue : dark} />}
          />
          <NavItem label="Settings" icon={<GearIcon className="w-5" />} />
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  All activity screen                                               */
/* ------------------------------------------------------------------ */

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[14px] transition active:scale-95 ${
        active
          ? "bg-gradient-to-b from-[#6790dc] to-[#5181d4] text-white"
          : "bg-white text-[#2b2b2b] shadow-[0_4px_12px_rgba(120,150,200,0.14)]"
      }`}
    >
      {children}
    </button>
  );
}

function AllActivityScreen({
  expenses,
  loading,
  now,
  filter,
  onFilter,
  onBack,
  onGoals,
  onEdit,
  onDelete,
  editing,
  onCloseEdit,
  onSaveEdit,
  pendingDelete,
  onCancelDelete,
  onConfirmDelete,
  error,
}: {
  expenses: Expense[];
  loading: boolean;
  now: Date;
  filter: "all" | Person;
  onFilter: (f: "all" | Person) => void;
  onBack: () => void;
  onGoals: () => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  editing: Expense | null;
  onCloseEdit: () => void;
  onSaveEdit: (row: Expense, next: { amount: number; note: string; person: Person }) => void;
  pendingDelete: Expense | null;
  onCancelDelete: () => void;
  onConfirmDelete: (e: Expense) => void;
  error: string | null;
}) {
  const shown = filter === "all" ? expenses : expenses.filter((e) => e.person === filter);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col px-4 pb-24 pt-[max(env(safe-area-inset-top),14px)]">
        {/* ---- one big card holds the whole screen ---- */}
        <section className="flex flex-1 flex-col rounded-[28px] bg-[#eaf2fd]/85 px-4 pb-3 pt-3 shadow-[0_12px_36px_rgba(120,150,200,0.22)] backdrop-blur-sm">
          {/* ---- header ---- */}
          <div className="relative flex items-center justify-center py-1.5">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95"
            >
              <ChevronLeftIcon className="w-5" />
            </button>
            <h1 className="text-[19px] text-[#2b2b2b]">All activity</h1>
          </div>

          {/* ---- filter chips ---- */}
          <div className="mt-1.5 flex justify-center gap-2.5">
            <FilterChip active={filter === "all"} onClick={() => onFilter("all")}>
              All
            </FilterChip>
            <FilterChip active={filter === "luca"} onClick={() => onFilter("luca")}>
              <Avatar person="luca" size={22} />
              Luca
            </FilterChip>
            <FilterChip active={filter === "irish"} onClick={() => onFilter("irish")}>
              <Avatar person="irish" size={22} />
              Irish
            </FilterChip>
          </div>

          <p className="mt-2.5 text-center text-[12px] text-[#a9a9b0]">
            Tap the icons to edit or remove
          </p>

          {error && (
            <p className="mt-2 text-center text-[12px] text-[#d4453e]">{error}</p>
          )}

          {/* ---- list ---- */}
          <div className="mt-2 rounded-[20px] bg-white px-4 pb-1.5 pt-1.5 shadow-[0_6px_18px_rgba(120,150,200,0.16)]">
          {loading ? null : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Avatar person="luca" size={52} />
              <p className="mt-2 text-[14px] text-[#2b2b2b]">No activity yet</p>
              <p className="mt-0.5 text-[12px] text-[#a9a9b0]">Add a transaction to get started!</p>
            </div>
          ) : (
            <ul>
              {shown.map((e, i) => {
                const { text, spent } = formatAmount(Number(e.amount));
                const label = e.note || (spent ? "Spent" : "Paid back");
                return (
                  <li
                    key={e.id}
                    className={`flex items-center gap-2.5 py-2.5 ${
                      i !== shown.length - 1 ? "border-b border-[#f0f0f2]" : ""
                    }`}
                  >
                    <Avatar person={e.person} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-tight text-[#2b2b2b]">
                        {NAME[e.person]} <span className="mx-1 text-[#c2c2c8]">·</span> {label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#a9a9b0]">
                        {formatWhen(e.created_at, now)}
                      </p>
                    </div>
                    <span className={`text-[14px] ${spent ? "text-[#2b2b2b]" : "text-[#18953f]"}`}>
                      {text}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEdit(e)}
                      aria-label="Edit"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
                    >
                      <PencilIcon className="w-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(e)}
                      aria-label="Delete"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
                    >
                      <TrashIcon className="w-[18px]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </section>
      </div>

      {editing && (
        <EditModal expense={editing} onClose={onCloseEdit} onSave={onSaveEdit} />
      )}
      {pendingDelete && (
        <ConfirmDeleteModal
          expense={pendingDelete}
          onCancel={onCancelDelete}
          onConfirm={() => onConfirmDelete(pendingDelete)}
        />
      )}

      <BottomNav tab="home" onHome={onBack} onGoals={onGoals} />
    </div>
  );
}

function EditModal({
  expense,
  onClose,
  onSave,
}: {
  expense: Expense;
  onClose: () => void;
  onSave: (row: Expense, next: { amount: number; note: string; person: Person }) => void;
}) {
  // Stored amount is positive for a spend, negative for paid-back. The modal
  // edits a friendly positive number plus a "kind" toggle.
  const initialAbs = Math.abs(Number(expense.amount));
  const [kind, setKind] = useState<"spent" | "back">(Number(expense.amount) >= 0 ? "spent" : "back");
  const [amount, setAmount] = useState(
    Number.isInteger(initialAbs) ? String(initialAbs) : initialAbs.toFixed(2),
  );
  const [note, setNote] = useState(expense.note ?? "");
  const [person, setPerson] = useState<Person>(expense.person);
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  function commit() {
    if (!valid || busy) return;
    setBusy(true);
    onSave(expense, {
      amount: kind === "spent" ? Math.abs(value) : -Math.abs(value),
      note,
      person,
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">Edit transaction</h2>

        <div className="mb-2.5 flex items-stretch gap-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
            <span className="text-[18px] text-[#2b2b2b]">$</span>
            <input
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-transparent text-[18px] text-[#2b2b2b] outline-none placeholder:text-[#c3c6ce]"
            />
          </div>
          <div className="flex items-stretch overflow-hidden rounded-[14px] border border-[#e7e9ef]">
            {(["luca", "irish"] as Person[]).map((p) => {
              const active = person === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPerson(p)}
                  className={`flex items-center gap-1 rounded-[14px] py-1.5 pl-1.5 pr-2.5 transition ${
                    active ? "border border-[#a3b8e6] bg-[#dbe3f6]" : "border border-transparent"
                  }`}
                >
                  <Avatar person={p} size={26} />
                  <span className="text-[14px] text-[#2b2b2b]">{NAME[p]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* spent / paid-back toggle */}
        <div className="mb-2.5 flex overflow-hidden rounded-[14px] border border-[#e7e9ef]">
          {(["spent", "back"] as const).map((k) => {
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 py-2 text-[14px] transition ${
                  active ? "bg-[#dbe3f6] text-[#2f63e6]" : "text-[#8d8d93]"
                }`}
              >
                {k === "spent" ? "Spent" : "Paid back"}
              </button>
            );
          })}
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <ChatIcon className="w-4 shrink-0" />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was it for?"
            className="w-full bg-transparent text-[14px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!valid || busy}
            className="flex-1 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  expense,
  onCancel,
  onConfirm,
}: {
  expense: Expense;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { text } = formatAmount(Number(expense.amount));
  const label = expense.note || "this transaction";
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-6 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[320px] rounded-[22px] bg-white p-5 text-center shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#fdecec]">
          <TrashIcon className="w-6" color="#d4453e" />
        </span>
        <h2 className="text-[16px] text-[#2b2b2b]">Remove transaction?</h2>
        <p className="mt-1 text-[13px] text-[#8d8d93]">
          {NAME[expense.person]} · {label} ({text})
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-[14px] bg-[#e4544c] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(212,69,62,0.32)] transition active:scale-[0.99]"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Goals screen                                                      */
/* ------------------------------------------------------------------ */

// "+ New goal" pill, used in both the goals home and the view-all screen.
function NewGoalButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full border border-[#cdd9f0] bg-white px-3 py-1.5 text-[13px] text-[#2f63e6] transition active:scale-95"
    >
      <PlusIcon className="w-3.5" />
      New goal
    </button>
  );
}

// A "More goals" card on the goals home: photo · title/amount · short progress
// bar · chevron. Tapping the card opens the contribute sheet.
function MoreGoalCard({ goal, onContribute }: { goal: Goal; onContribute: (g: Goal) => void }) {
  return (
    <button
      type="button"
      onClick={() => onContribute(goal)}
      className="flex w-full items-center gap-3 rounded-[18px] bg-white px-3.5 py-3 text-left shadow-[0_6px_16px_rgba(120,150,200,0.12)] transition active:scale-[0.99]"
    >
      <GoalImage url={goal.image_url} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-tight text-[#2b2b2b]">{goal.title}</p>
        <p className="mt-0.5 text-[12px] text-[#a9a9b0]">
          {money(Number(goal.saved))} <span className="text-[#c2c2c8]">of {money(Number(goal.target))}</span>
        </p>
      </div>
      <ProgressBar value={goalProgress(goal)} className="h-2 w-[34%] shrink-0" />
      <ChevronRightIcon className="w-4 shrink-0" />
    </button>
  );
}

// One goal row for the view-all screen: photo · title/amount · progress, then
// the action icons (make-current star, add, edit, remove).
function GoalRow({
  goal,
  onContribute,
  onEdit,
  onDelete,
  onSetCurrent,
}: {
  goal: Goal;
  onContribute: (g: Goal) => void;
  onEdit: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  onSetCurrent: (g: Goal) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <GoalImage url={goal.image_url} size={40} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[14px] leading-tight text-[#2b2b2b]">
          {goal.title}
          {goal.is_current && <FlagIcon className="w-3 shrink-0" color="#2f63e6" />}
        </p>
        <p className="mt-0.5 text-[11px] text-[#a9a9b0]">
          {money(Number(goal.saved))} of {money(Number(goal.target))}
        </p>
        <ProgressBar value={goalProgress(goal)} className="mt-1.5 h-1.5 w-full" />
      </div>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => onSetCurrent(goal)}
          aria-label="Make current goal"
          className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
        >
          <StarIcon className="w-[18px]" color={goal.is_current ? "#2f63e6" : "#c4c7cf"} filled={goal.is_current} />
        </button>
        <button
          type="button"
          onClick={() => onContribute(goal)}
          aria-label="Add to goal"
          className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
        >
          <PlusIcon className="w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(goal)}
          aria-label="Edit"
          className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
        >
          <PencilIcon className="w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(goal)}
          aria-label="Delete"
          className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
        >
          <TrashIcon className="w-[18px]" />
        </button>
      </div>
    </li>
  );
}

function GoalsHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center py-1.5">
      <h1 className="text-[22px] text-[#2b2b2b]">{title}</h1>
    </div>
  );
}

function GoalsScreen({
  goals,
  loading,
  error,
  onHome,
  onViewAll,
  onContribute,
  onNewGoal,
}: {
  goals: Goal[];
  loading: boolean;
  error: string | null;
  onHome: () => void;
  onViewAll: () => void;
  onContribute: (g: Goal) => void;
  onNewGoal: () => void;
}) {
  // The featured goal is the one flagged current; fall back to the newest.
  const current = goals.find((g) => g.is_current) ?? goals[0] ?? null;
  const rest = current ? goals.filter((g) => g.id !== current.id) : [];

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-3 px-4 pb-20 pt-[max(env(safe-area-inset-top),14px)]">
        <GoalsHeader title="Goals" />

        {error && <p className="text-center text-[12px] text-[#d4453e]">{error}</p>}

        {loading ? null : !current ? (
          /* ---- empty state ---- */
          <section className="rounded-[22px] bg-white px-5 py-8 text-center shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#eef3fb]">
              <StarIcon className="w-7" color="#9bb4e6" />
            </span>
            <p className="text-[15px] text-[#2b2b2b]">No goals yet</p>
            <p className="mt-1 text-[12px] text-[#a9a9b0]">
              Add a goal and start saving your leftover budget toward it.
            </p>
            <button
              type="button"
              onClick={onNewGoal}
              className="mx-auto mt-4 flex items-center justify-center gap-2 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] px-5 py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99]"
            >
              <PlusIcon className="w-4" color="#ffffff" />
              New goal
            </button>
          </section>
        ) : (
          <>
            {/* ---- Current goal ---- */}
            <CurrentGoalCard goal={current} onContribute={onContribute} />

            {/* ---- More goals ---- */}
            <section className="rounded-[24px] bg-[#eaf2fd]/85 px-3.5 pb-3 pt-3 shadow-[0_10px_30px_rgba(120,150,200,0.18)] backdrop-blur-sm">
              <div className="mb-2.5 flex items-center justify-between px-1">
                <h2 className="text-[16px] text-[#2b2b2b]">More goals</h2>
                <NewGoalButton onClick={onNewGoal} />
              </div>

              {rest.length === 0 ? (
                <div className="rounded-[18px] bg-white px-4 py-5 text-center shadow-[0_6px_16px_rgba(120,150,200,0.12)]">
                  <p className="text-[12px] text-[#a9a9b0]">No other goals yet — tap “New goal” to add one.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rest.map((g) => (
                    <MoreGoalCard key={g.id} goal={g} onContribute={onContribute} />
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={onViewAll}
                className="mt-2 block w-full pr-1 text-right text-[13px] text-[#2f63e6]"
              >
                View all goals →
              </button>
            </section>
          </>
        )}
      </div>

      <BottomNav tab="goals" onHome={onHome} onGoals={() => {}} />
    </div>
  );
}

function CurrentGoalCard({
  goal,
  onContribute,
}: {
  goal: Goal;
  onContribute: (g: Goal) => void;
}) {
  const saved = Number(goal.saved);
  const target = Number(goal.target);
  const toGo = Math.max(0, target - saved);
  const done = saved >= target && target > 0;

  return (
    <section className="rounded-[28px] bg-white px-4 pb-4 pt-3.5 shadow-[0_10px_30px_rgba(120,150,200,0.2)]">
      {/* ---- card header ---- */}
      <div className="flex items-center px-1">
        <span className="flex items-center gap-2 text-[15px] text-[#2b2b2b]">
          <FlagIcon className="w-6" color="#2b2b2b" />
          Current goal
        </span>
      </div>

      {/* ---- inner detail card ---- */}
      <div className="mt-3 rounded-[22px] bg-[#fbfcff] px-4 pb-4 pt-3.5 ring-1 ring-[#eef1f8]">
        {/* a big vertical photo on the left, details on the right */}
        <div className="flex items-stretch gap-4">
          <span
            className="flex w-[112px] shrink-0 items-center justify-center self-stretch overflow-hidden bg-[#e7f1fd]"
            style={{ borderRadius: "62% 38% 55% 45% / 52% 46% 54% 48%" }}
          >
            {goal.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={goal.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <StarIcon className="w-9" color="#9bb4e6" />
            )}
          </span>

          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-[26px] leading-tight text-[#2b2b2b]">{goal.title}</p>
            {goal.subtitle && (
              <p className="mt-0.5 truncate text-[13px] text-[#8d8d93]">{goal.subtitle}</p>
            )}
            <p className="mt-2.5 text-[24px] leading-none text-[#2b2b2b]">
              {money(saved)} <span className="text-[16px]">of {money(target)}</span>
            </p>
            <ProgressBar value={goalProgress(goal)} className="mt-3 h-2.5 w-full" />
            <p className="mt-2 text-[12px] text-[#a4a7af]">
              {done ? "Goal reached! 🎉" : `${money(toGo)} to go`}
            </p>
          </div>
        </div>

        {/* ---- contributors + add ---- */}
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PersonPill person="luca" heartColor="#2f63e6" />
            <PersonPill person="irish" heartColor="#f3a6c9" />
          </div>
          <button
            type="button"
            onClick={() => onContribute(goal)}
            disabled={done}
            className="flex shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-gradient-to-b from-[#6790dc] to-[#5181d4] px-5 py-2.5 text-[14px] text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            Add leftover
          </button>
        </div>
      </div>
    </section>
  );
}

// Small white pill showing a contributor: avatar · name · heart.
function PersonPill({ person, heartColor }: { person: Person; heartColor: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-[13px] text-[#2b2b2b] ring-1 ring-[#eceef4]">
      <Avatar person={person} size={22} />
      {NAME[person]}
      <HeartIcon className="w-3" color={heartColor} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  All goals screen (mirrors All activity)                           */
/* ------------------------------------------------------------------ */

function AllGoalsScreen({
  goals,
  loading,
  error,
  onBack,
  onHome,
  onContribute,
  onNewGoal,
  onEdit,
  onDelete,
  onSetCurrent,
}: {
  goals: Goal[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onHome: () => void;
  onContribute: (g: Goal) => void;
  onNewGoal: () => void;
  onEdit: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  onSetCurrent: (g: Goal) => void;
}) {
  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col px-4 pb-24 pt-[max(env(safe-area-inset-top),14px)]">
        <section className="flex flex-1 flex-col rounded-[28px] bg-[#eaf2fd]/85 px-4 pb-3 pt-3 shadow-[0_12px_36px_rgba(120,150,200,0.22)] backdrop-blur-sm">
          {/* ---- header ---- */}
          <div className="relative flex items-center justify-center py-1.5">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95"
            >
              <ChevronLeftIcon className="w-5" />
            </button>
            <h1 className="text-[19px] text-[#2b2b2b]">All goals</h1>
            <span className="absolute right-0">
              <NewGoalButton onClick={onNewGoal} />
            </span>
          </div>

          <p className="mt-2.5 text-center text-[12px] text-[#a9a9b0]">
            Tap the icons to set current, add, edit, or remove
          </p>

          {error && <p className="mt-2 text-center text-[12px] text-[#d4453e]">{error}</p>}

          {/* ---- list ---- */}
          <div className="mt-2 rounded-[20px] bg-white px-4 pb-1.5 pt-1.5 shadow-[0_6px_18px_rgba(120,150,200,0.16)]">
            {loading ? null : goals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eef3fb]">
                  <StarIcon className="w-6" color="#9bb4e6" />
                </span>
                <p className="mt-2 text-[14px] text-[#2b2b2b]">No goals yet</p>
                <p className="mt-0.5 text-[12px] text-[#a9a9b0]">Add a goal to get started!</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#f0f0f2]">
                {goals.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    onContribute={onContribute}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSetCurrent={onSetCurrent}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <BottomNav tab="goals" onHome={onHome} onGoals={onBack} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Goal modals                                                       */
/* ------------------------------------------------------------------ */

// Move leftover budget out of the bank and into a goal. Capped at what's
// actually available so the bank can't be pushed negative this way.
function ContributeModal({
  goal,
  available,
  onClose,
  onConfirm,
}: {
  goal: Goal;
  available: number;
  onClose: () => void;
  onConfirm: (g: Goal, amount: number) => void;
}) {
  const toGo = Math.max(0, Number(goal.target) - Number(goal.saved));
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const valid =
    Number.isFinite(value) && value > 0 && value <= available + 1e-9;

  function commit() {
    if (!valid || busy) return;
    setBusy(true);
    onConfirm(goal, value);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <GoalImage url={goal.image_url} size={44} />
          <div className="min-w-0">
            <h2 className="truncate text-[16px] text-[#2b2b2b]">Add to {goal.title}</h2>
            <p className="text-[12px] text-[#8d8d93]">
              {money(Number(goal.saved))} of {money(Number(goal.target))} · {money(toGo)} to go
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <span className="text-[18px] text-[#2b2b2b]">$</span>
          <input
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-[18px] text-[#2b2b2b] outline-none placeholder:text-[#c3c6ce]"
          />
        </div>
        <p className="mt-2 text-[12px] text-[#8d8d93]">
          {money(Math.max(0, available))} available in the bank
        </p>
        {value > 0 && value > available + 1e-9 && (
          <p className="mt-1 text-[12px] text-[#d4453e]">That&apos;s more than the bank has.</p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!valid || busy}
            className="flex-1 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add to goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

// New / edit goal sheet. The photo becomes the goal's icon (uploaded to the
// public `goals` bucket). Used for both create and edit.
function GoalFormModal({
  goal,
  onClose,
  onSave,
}: {
  goal?: Goal;
  onClose: () => void;
  onSave: (next: {
    title: string;
    subtitle: string;
    target: number;
    image_url: string | null;
    makeCurrent: boolean;
  }) => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [subtitle, setSubtitle] = useState(goal?.subtitle ?? "");
  const initialTarget = goal ? Number(goal.target) : 0;
  const [target, setTarget] = useState(
    goal ? (Number.isInteger(initialTarget) ? String(initialTarget) : initialTarget.toFixed(2)) : "",
  );
  const [imageUrl, setImageUrl] = useState<string | null>(goal?.image_url ?? null);
  const [preview, setPreview] = useState<string | null>(goal?.image_url ?? null);
  const [file, setFile] = useState<File | null>(null);
  // New goals default to becoming current; editing keeps the goal's flag.
  const [makeCurrent, setMakeCurrent] = useState(goal ? goal.is_current : true);
  const [busy, setBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const targetValue = Number(target);
  const valid = title.trim() !== "" && Number.isFinite(targetValue) && targetValue > 0;

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setImgError(null);
  }

  async function commit() {
    if (!valid || busy) return;
    setBusy(true);
    setImgError(null);

    let url = imageUrl;
    if (file) {
      url = await uploadGoalImage(file);
      if (!url) {
        setImgError("Couldn't upload that photo. Try another one.");
        setBusy(false);
        return;
      }
      setImageUrl(url);
    }

    onSave({
      title: title.trim(),
      subtitle: subtitle.trim(),
      target: targetValue,
      image_url: url,
      makeCurrent,
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">
          {goal ? "Edit goal" : "New goal"}
        </h2>

        {/* photo picker */}
        <label className="mb-3 flex cursor-pointer items-center gap-3">
          <span className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[#eef3fb] ring-1 ring-[#e7e9ef]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <CameraIcon className="w-7" />
            )}
          </span>
          <span className="text-[13px] text-[#2f63e6]">
            {preview ? "Change photo" : "Add a photo of your goal"}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {imgError && <p className="mb-2 text-[12px] text-[#d4453e]">{imgError}</p>}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goal name (e.g. Date night)"
          className="mb-2.5 w-full rounded-[14px] bg-white px-3 py-2.5 text-[15px] text-[#2b2b2b] outline-none ring-1 ring-[#e7e9ef] placeholder:text-[#aeb1b9]"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="A little detail (optional)"
          className="mb-2.5 w-full rounded-[14px] bg-white px-3 py-2.5 text-[14px] text-[#2b2b2b] outline-none ring-1 ring-[#e7e9ef] placeholder:text-[#aeb1b9]"
        />
        <div className="mb-3 flex items-center gap-1.5 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <span className="text-[18px] text-[#2b2b2b]">$</span>
          <input
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target amount"
            className="w-full bg-transparent text-[16px] text-[#2b2b2b] outline-none placeholder:text-[#c3c6ce]"
          />
        </div>

        {/* make current toggle */}
        <div className="mb-3 flex items-center justify-between rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <span className="text-[14px] text-[#2b2b2b]">Make this my current goal</span>
          <Toggle on={makeCurrent} onChange={setMakeCurrent} />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!valid || busy}
            className="flex-1 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? "Saving…" : goal ? "Save" : "Create goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Analytics screen                                                  */
/* ------------------------------------------------------------------ */

function CalendarIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={color} strokeWidth="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BagIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 8h12l-1 12.5H7L6 8Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 9.5V7a3 3 0 0 1 6 0v2.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const VANCOUVER_TZ = VANCOUVER;
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function vanYMD(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VANCOUVER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function dayNum(p: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

// Day of week in Vancouver as 0=Mon … 6=Sun.
function vanWeekdayMon0(d: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: VANCOUVER_TZ,
    weekday: "short",
  }).format(d);
  const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
  return idx < 0 ? 0 : idx;
}

// Day-number of this Vancouver week's Monday.
function currentWeekStart(now: Date): number {
  return dayNum(vanYMD(now)) - vanWeekdayMon0(now);
}

function isThisWeek(iso: string, now: Date): boolean {
  const i = dayNum(vanYMD(new Date(iso))) - currentWeekStart(now);
  return i >= 0 && i <= 6;
}

// The category slug an expense rolls up to (unknown/blank → "shopping").
function expenseSlug(e: Expense): string {
  return e.category && CATEGORY_LABEL[e.category] ? e.category : "shopping";
}

// "Today · 4:20 PM" / "Yesterday · 5:33 PM" / "Thursday · 4:20 PM" — weekday
// names within the current week, civil dates compared in Vancouver time.
function formatWeekdayWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const civil = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: VANCOUVER_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(x);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: VANCOUVER_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);

  const that = civil(d);
  let label: string;
  if (that === civil(now)) label = "Today";
  else if (that === civil(new Date(now.getTime() - 86_400_000))) label = "Yesterday";
  else label = new Intl.DateTimeFormat("en-US", { timeZone: VANCOUVER_TZ, weekday: "long" }).format(d);

  return `${label} · ${time}`;
}

type WeekStats = {
  spent: number;
  avgPerDay: number;
  underBudget: number;
  daily: number[]; // Mon..Sun spend
  byPerson: Record<Person, number>;
  byCategory: { slug: string; amount: number }[];
};

// Everything on the analytics screen is scoped to the current Vancouver week
// (Mon–Sun). Spends are positive amounts; paid-back rows are ignored here.
function weekStats(expenses: Expense[], now: Date): WeekStats {
  const weekStart = currentWeekStart(now);
  const daily = [0, 0, 0, 0, 0, 0, 0];
  const byPerson: Record<Person, number> = { luca: 0, irish: 0 };
  const catMap = new Map<string, number>();

  for (const e of expenses) {
    const amt = Number(e.amount);
    if (amt <= 0) continue; // only spends
    const idx = dayNum(vanYMD(new Date(e.created_at))) - weekStart;
    if (idx < 0 || idx > 6) continue;
    daily[idx] += amt;
    byPerson[e.person] += amt;
    const slug = expenseSlug(e);
    catMap.set(slug, (catMap.get(slug) ?? 0) + amt);
  }

  const spent = daily.reduce((s, v) => s + v, 0);
  const activeDays = daily.filter((v) => v > 0).length;
  // Average per active weekday (Mon–Fri) — the headline "Avg / day".
  const activeWeekdays = daily.slice(0, 5).filter((v) => v > 0).length;
  const avgPerDay = spent / Math.max(1, activeWeekdays);
  // "Under budget" = days you came in below your daily pace.
  const pace = spent / Math.max(1, activeDays);
  const underBudget = daily.filter((v) => v > 0 && v < pace).length;

  const byCategory = [...catMap.entries()]
    .map(([slug, amount]) => ({ slug, amount }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return (
        (CATEGORY_SLUGS as readonly string[]).indexOf(a.slug) -
        (CATEGORY_SLUGS as readonly string[]).indexOf(b.slug)
      );
    });

  return { spent, avgPerDay, underBudget, daily, byPerson, byCategory };
}

// Donut split of the bank between the two people. Luca is the blue arc, Irish
// the pink remainder; the total sits in the hole.
function SplitDonut({ luca, irish }: { luca: number; irish: number }) {
  const total = luca + irish;
  const r = 52;
  const c = 2 * Math.PI * r;
  const lucaFrac = total > 0 ? luca / total : 0;
  return (
    <svg viewBox="0 0 140 140" className="h-[118px] w-[118px]">
      <g transform="translate(140,0) scale(-1,1) rotate(-90 70 70)">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#f4abce" strokeWidth="17" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke="#5e8be8"
          strokeWidth="17"
          strokeDasharray={`${lucaFrac * c} ${c}`}
          strokeLinecap="round"
        />
      </g>
      <text x="70" y="66" textAnchor="middle" className="fill-[#2b2b2b]" style={{ fontSize: 26 }}>
        {money(total)}
      </text>
      <text x="70" y="84" textAnchor="middle" className="fill-[#a9a9b0]" style={{ fontSize: 12 }}>
        total
      </text>
    </svg>
  );
}

function AnalyticsScreen({
  expenses,
  loading,
  now,
  onHome,
  onGoals,
  onViewCategory,
}: {
  expenses: Expense[];
  loading: boolean;
  now: Date;
  onHome: () => void;
  onGoals: () => void;
  onViewCategory: (slug: string) => void;
}) {
  const stats = useMemo(() => weekStats(expenses, now), [expenses, now]);
  const [sheetSlug, setSheetSlug] = useState<string | null>(null);
  const lucaPct = stats.spent > 0 ? Math.round((stats.byPerson.luca / stats.spent) * 100) : 0;
  const irishPct = stats.spent > 0 ? 100 - lucaPct : 0;
  const catMax = Math.max(1, ...stats.byCategory.map((c) => c.amount));
  const top = stats.byCategory.slice(0, 5);
  const maxDaily = Math.max(1, ...stats.daily);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-24 pt-[max(env(safe-area-inset-top),14px)]">
        <div className="flex items-center justify-center py-1.5">
          <h1 className="text-[20px] text-[#2b2b2b]">Analytics</h1>
        </div>

        {/* ---- This week ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-3.5 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-2.5 flex items-center gap-2">
            <h2 className="text-[16px] text-[#2b2b2b]">This week</h2>
            <CalendarIcon className="w-4" color="#9aa0ab" />
          </div>
          <div className="flex items-stretch divide-x divide-[#eef1f8]">
            <Stat label="Spent" value={loading ? "—" : money(stats.spent)} className="pr-2" />
            <Stat
              label="Avg / day"
              value={loading ? "—" : `$${stats.avgPerDay.toFixed(2)}`}
              className="px-2"
            />
            <Stat
              label="Under budget"
              value={loading ? "—" : `${stats.underBudget}`}
              unit="days"
              className="pl-2"
            />
          </div>
        </section>

        {/* ---- Spending split ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-3.5 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-1 flex items-center gap-1.5">
            <h2 className="text-[16px] text-[#2b2b2b]">Spending split</h2>
            <HeartIcon className="w-3.5" color="#f3a6c9" />
          </div>
          <div className="flex items-center justify-between">
            <SplitPerson person="luca" amount={stats.byPerson.luca} heartColor="#2f63e6" />
            <SplitDonut luca={stats.byPerson.luca} irish={stats.byPerson.irish} />
            <SplitPerson person="irish" amount={stats.byPerson.irish} heartColor="#f3a6c9" align="right" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[12px] text-[#5e8be8]">{lucaPct}%</span>
            <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-[#f0f2f7]">
              <div className="h-full bg-[#5e8be8]" style={{ width: `${lucaPct}%` }} />
              <div className="h-full flex-1 bg-[#f4abce]" />
            </div>
            <span className="text-[12px] text-[#e58fb6]">{irishPct}%</span>
          </div>
        </section>

        {/* ---- Where it went ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-2 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[16px] text-[#2b2b2b]">Where it went</h2>
            <BagIcon className="w-4" color="#9aa0ab" />
          </div>
          {top.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-[#a9a9b0]">No spending yet this week.</p>
          ) : (
            <ul>
              {top.map((c) => (
                <li key={c.slug}>
                  <button
                    type="button"
                    onClick={() => setSheetSlug(c.slug)}
                    className="flex w-full items-center gap-2.5 py-2 text-left transition active:scale-[0.99]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={categoryIcon(c.slug)} alt="" className="h-6 w-6 shrink-0 object-contain" />
                    <span className="w-[58px] shrink-0 text-[14px] text-[#2b2b2b]">
                      {CATEGORY_LABEL[c.slug] ?? c.slug}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef1f7]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#6f9af0] to-[#5a86e6]"
                        style={{ width: `${Math.max(8, (c.amount / catMax) * 100)}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-[14px] text-[#2b2b2b]">
                      {money(c.amount)}
                    </span>
                    <ChevronRightIcon className="w-4 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Daily spend ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-3 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] text-[#2b2b2b]">Daily spend</h2>
              <BarsIcon className="w-4" color="#9aa0ab" />
            </div>
            <HeartIcon className="w-3.5" color="#2b2b2b" />
          </div>
          <div className="relative mt-1 flex h-[124px] items-end justify-between gap-1.5 px-0.5 pt-5">
            {stats.daily.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                {v > 0 && <span className="text-[10px] text-[#9aa0ab]">{money(v)}</span>}
                <div
                  className="w-[62%] rounded-t-[6px] bg-gradient-to-b from-[#6f9af0] to-[#5a86e6]"
                  style={{ height: `${Math.max(v > 0 ? 6 : 0, (v / maxDaily) * 84)}px` }}
                />
              </div>
            ))}
            {/* weekly average line */}
            {stats.spent > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                style={{ bottom: `${(stats.avgPerDay / maxDaily) * 84}px` }}
              >
                <div className="flex-1 border-t-2 border-dotted border-[#9bb0d6]" />
                <span className="ml-1 shrink-0 rounded-full bg-[#eef3fb] px-1.5 py-[1px] text-[9px] text-[#5e8be8]">
                  avg {money(stats.avgPerDay)}
                </span>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex justify-between px-0.5">
            {WEEKDAY_LETTERS.map((d, i) => (
              <span key={i} className="flex-1 text-center text-[11px] text-[#9aa0ab]">
                {d}
              </span>
            ))}
          </div>
        </section>
      </div>

      {sheetSlug && (
        <CategoryDetailSheet
          slug={sheetSlug}
          expenses={expenses}
          now={now}
          stats={stats}
          onClose={() => setSheetSlug(null)}
          onViewAll={() => {
            const slug = sheetSlug;
            setSheetSlug(null);
            onViewCategory(slug);
          }}
        />
      )}

      <BottomNav tab="analytics" onHome={onHome} onGoals={onGoals} onAnalytics={() => {}} />
    </div>
  );
}

function BulbIcon({ className = "", color = "#6b7686" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 1 1.6l.2 1.1h4.8l.2-1.1c.1-.6.5-1.2 1-1.6A6 6 0 0 0 12 3Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path d="M9.6 19.5h4.8M10.4 22h3.2" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

// Bottom sheet opened from a "Where it went" row: this week's spend in the
// category, who spent it, and a quick insight + link to the full history.
function CategoryDetailSheet({
  slug,
  expenses,
  now,
  stats,
  onClose,
  onViewAll,
}: {
  slug: string;
  expenses: Expense[];
  now: Date;
  stats: WeekStats;
  onClose: () => void;
  onViewAll: () => void;
}) {
  const label = CATEGORY_LABEL[slug] ?? slug;
  const rows = expenses
    .filter((e) => Number(e.amount) > 0 && expenseSlug(e) === slug && isThisWeek(e.created_at, now))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const total = rows.reduce((s, e) => s + Number(e.amount), 0);
  const pct = stats.spent > 0 ? Math.round((total / stats.spent) * 100) : 0;
  const rank = stats.byCategory.findIndex((c) => c.slug === slug) + 1;
  const plural = label.endsWith("s") ? "were" : "was";
  const insight =
    rank === 1
      ? `${label} ${plural} your biggest category this week.`
      : `${label} made up ${pct}% of your spending this week.`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-[26px] bg-white px-5 pb-7 pt-2.5 shadow-[0_-12px_40px_rgba(60,90,150,0.25)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mx-auto mb-3.5 h-1.5 w-10 rounded-full bg-[#e2e5ec]" />

        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={categoryIcon(slug)} alt="" className="h-7 w-7 shrink-0 object-contain" />
          <h2 className="text-[20px] text-[#2b2b2b]">{label}</h2>
        </div>

        <p className="mt-2 text-[26px] leading-none text-[#2b2b2b]">
          {money(total)} <span className="text-[16px]">this week</span>
        </p>
        <p className="mt-1 text-[13px] text-[#8d8d93]">
          {rows.length} purchase{rows.length === 1 ? "" : "s"}{" "}
          <span className="mx-0.5">·</span> <span className="text-[#2f63e6]">{pct}%</span> of total spending
        </p>

        <div className="my-3 border-t border-dashed border-[#e6e8ef]" />

        <ul className="flex flex-col gap-3">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center gap-3">
              <Avatar person={e.person} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] leading-tight text-[#2b2b2b]">
                  {NAME[e.person]} <span className="mx-0.5 text-[#c2c2c8]">·</span> {e.note || label}
                </p>
                <p className="mt-0.5 text-[11px] text-[#a9a9b0]">{formatWeekdayWhen(e.created_at, now)}</p>
              </div>
              <span className="text-[15px] text-[#2b2b2b]">-{money(Number(e.amount))}</span>
            </li>
          ))}
        </ul>

        <div className="my-3 border-t border-dashed border-[#e6e8ef]" />

        <div className="flex items-center gap-2 rounded-[14px] bg-[#eef3fb] px-3 py-2.5">
          <BulbIcon className="w-5 shrink-0" />
          <p className="text-[12px] text-[#5a6678]">{insight}</p>
        </div>

        <button
          type="button"
          onClick={onViewAll}
          className="mt-3.5 w-full text-center text-[14px] text-[#2f63e6]"
        >
          View all {label.toLowerCase()} activity →
        </button>
      </div>
    </div>
  );
}

// Full history for one category, reached from the detail sheet's "View all".
function CategoryActivityScreen({
  slug,
  expenses,
  loading,
  now,
  onBack,
  onHome,
  onGoals,
}: {
  slug: string;
  expenses: Expense[];
  loading: boolean;
  now: Date;
  onBack: () => void;
  onHome: () => void;
  onGoals: () => void;
}) {
  const label = CATEGORY_LABEL[slug] ?? slug;
  const rows = expenses.filter((e) => Number(e.amount) > 0 && expenseSlug(e) === slug);
  const total = rows.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col px-4 pb-24 pt-[max(env(safe-area-inset-top),14px)]">
        <section className="flex flex-1 flex-col rounded-[28px] bg-[#eaf2fd]/85 px-4 pb-3 pt-3 shadow-[0_12px_36px_rgba(120,150,200,0.22)] backdrop-blur-sm">
          {/* ---- header ---- */}
          <div className="relative flex items-center justify-center py-1.5">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95"
            >
              <ChevronLeftIcon className="w-5" />
            </button>
            <h1 className="flex items-center gap-2 text-[19px] text-[#2b2b2b]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={categoryIcon(slug)} alt="" className="h-6 w-6 object-contain" />
              {label}
            </h1>
          </div>

          <p className="mt-1 text-center text-[12px] text-[#a9a9b0]">
            {rows.length} purchase{rows.length === 1 ? "" : "s"} · {money(total)} all time
          </p>

          {/* ---- list ---- */}
          <div className="mt-2 rounded-[20px] bg-white px-4 pb-1.5 pt-1.5 shadow-[0_6px_18px_rgba(120,150,200,0.16)]">
            {loading ? null : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={categoryIcon(slug)} alt="" className="h-12 w-12 object-contain opacity-70" />
                <p className="mt-2 text-[14px] text-[#2b2b2b]">No {label.toLowerCase()} yet</p>
                <p className="mt-0.5 text-[12px] text-[#a9a9b0]">Spending here will show up on this screen.</p>
              </div>
            ) : (
              <ul>
                {rows.map((e, i) => {
                  const { text } = formatAmount(Number(e.amount));
                  return (
                    <li
                      key={e.id}
                      className={`flex items-center gap-2.5 py-2.5 ${
                        i !== rows.length - 1 ? "border-b border-[#f0f0f2]" : ""
                      }`}
                    >
                      <Avatar person={e.person} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] leading-tight text-[#2b2b2b]">
                          {NAME[e.person]} <span className="mx-1 text-[#c2c2c8]">·</span> {e.note || label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#a9a9b0]">{formatWhen(e.created_at, now)}</p>
                      </div>
                      <span className="text-[14px] text-[#2b2b2b]">{text}</span>
                      <span className="flex w-6 shrink-0 justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={categoryIcon(e.category)} alt="" className="h-5 w-5 object-contain" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <BottomNav tab="analytics" onHome={onHome} onGoals={onGoals} onAnalytics={onBack} />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  className = "",
}: {
  label: string;
  value: string;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-1 flex-col items-center text-center ${className}`}>
      <span className="text-[11px] text-[#a9a9b0]">{label}</span>
      <span className="mt-1 text-[26px] leading-none text-[#2b2b2b]">
        {value}
        {unit && <span className="ml-1 text-[15px] text-[#2b2b2b]">{unit}</span>}
      </span>
    </div>
  );
}

function SplitPerson({
  person,
  amount,
  heartColor,
  align = "left",
}: {
  person: Person;
  amount: number;
  heartColor: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <Avatar person={person} size={40} />
      <span className="mt-1 flex items-center gap-1 text-[14px] text-[#2b2b2b]">
        {NAME[person]}
        <HeartIcon className="w-3" color={heartColor} />
      </span>
      <span className="text-[15px] text-[#2b2b2b]">{money(amount)}</span>
    </div>
  );
}

function ConfirmDeleteGoalModal({
  goal,
  onCancel,
  onConfirm,
}: {
  goal: Goal;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const saved = Number(goal.saved);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-6 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[320px] rounded-[22px] bg-white p-5 text-center shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#fdecec]">
          <TrashIcon className="w-6" color="#d4453e" />
        </span>
        <h2 className="text-[16px] text-[#2b2b2b]">Remove goal?</h2>
        <p className="mt-1 text-[13px] text-[#8d8d93]">
          “{goal.title}”
          {saved > 0 ? ` — ${money(saved)} goes back to the bank.` : ""}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-[14px] bg-[#e4544c] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(212,69,62,0.32)] transition active:scale-[0.99]"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
