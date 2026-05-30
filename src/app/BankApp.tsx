"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Expense, type Person } from "@/lib/supabase";
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

function StarIcon({ className = "", color = "#1f1f1f" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 32 30" fill="none" className={className}>
      <path
        d="M16 4l3.3 7.4 8 .8-6 5.4 1.7 7.9L16 22.7 8.9 25.5l1.8-7.9-6-5.4 8-.8L16 4Z"
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

/* ------------------------------------------------------------------ */
/*  Small building blocks                                             */
/* ------------------------------------------------------------------ */

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "All activity" screen state.
  const [view, setView] = useState<"home" | "all">("home");
  const [filter, setFilter] = useState<"all" | Person>("all");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);

  // Re-render every minute so the balance rolls over at Vancouver midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setExpenses((data ?? []) as Expense[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalSpent = useMemo(
    () => expenses.reduce((sum, e) => sum + Number(e.amount), 0),
    [expenses],
  );
  const balance = bankBalance(totalSpent, now);

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

  if (view === "all") {
    return (
      <AllActivityScreen
        expenses={expenses}
        loading={loading}
        now={now}
        filter={filter}
        onFilter={setFilter}
        onBack={() => setView("home")}
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

      {/* ---- bottom nav ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto max-w-[420px] px-4 pb-[max(env(safe-area-inset-bottom),8px)] pt-1">
          <div className="flex items-center justify-around rounded-[22px] bg-white/95 py-2 shadow-[0_-2px_20px_rgba(120,150,200,0.18)] backdrop-blur">
            <NavItem label="Home" active icon={<HomeIcon className="w-5" color="#2f63e6" />} />
            <NavItem label="Analytics" icon={<BarsIcon className="w-5" />} />
            <NavItem label="Goals" icon={<StarIcon className="w-5" />} />
            <NavItem label="Settings" icon={<GearIcon className="w-5" />} />
          </div>
        </div>
      </nav>
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
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button type="button" className="flex flex-col items-center gap-1">
      {icon}
      <span className={`text-[12px] ${active ? "text-[#2f63e6]" : "text-[#2b2b2b]"}`}>
        {label}
      </span>
    </button>
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

      {/* ---- bottom nav ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto max-w-[420px] px-4 pb-[max(env(safe-area-inset-bottom),8px)] pt-1">
          <div className="flex items-center justify-around rounded-[22px] bg-white/95 py-2 shadow-[0_-2px_20px_rgba(120,150,200,0.18)] backdrop-blur">
            <NavItem label="Home" active icon={<HomeIcon className="w-5" color="#2f63e6" />} />
            <NavItem label="Analytics" icon={<BarsIcon className="w-5" />} />
            <NavItem label="Goals" icon={<StarIcon className="w-5" />} />
            <NavItem label="Settings" icon={<GearIcon className="w-5" />} />
          </div>
        </div>
      </nav>
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
