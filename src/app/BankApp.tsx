"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Expense, type Goal, type Person, type Reward } from "@/lib/supabase";
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

const NAME: Record<Person, string> = { luca: "Luca", irish: "Claire" };

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

// A reward moves through three states: locked (task not done) → ready (task
// done, not yet redeemed) → claimed. Derived purely from the two timestamps.
type RewardStatus = "locked" | "ready" | "claimed";
function rewardStatus(r: Reward): RewardStatus {
  if (r.claimed_at) return "claimed";
  if (r.done_at) return "ready";
  return "locked";
}

// Per-person reward "wallet": cash earned from claimed cash rewards, minus what
// has already been spent through reward-funded transactions. `available` is the
// spendable balance. "Anyone" rewards aren't tied to a person, so they sit out.
function computeRewardMoney(
  rewards: Reward[],
  expenses: Expense[],
): { earned: Record<Person, number>; spent: Record<Person, number>; available: Record<Person, number> } {
  const earned: Record<Person, number> = { luca: 0, irish: 0 };
  for (const r of rewards) {
    if (r.kind !== "cash" || rewardStatus(r) !== "claimed") continue;
    if (r.person === "luca" || r.person === "irish") earned[r.person] += Number(r.amount) || 0;
  }
  const spent: Record<Person, number> = { luca: 0, irish: 0 };
  for (const e of expenses) {
    if (!e.from_reward) continue;
    const amt = Number(e.amount);
    if (amt > 0 && (e.person === "luca" || e.person === "irish")) spent[e.person] += amt;
  }
  return {
    earned,
    spent,
    available: { luca: earned.luca - spent.luca, irish: earned.irish - spent.irish },
  };
}

// "May 10" — a short civil date in Vancouver, for reward done/claimed stamps.
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: VANCOUVER,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
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

function GridIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {[[4, 4], [14, 4], [4, 14], [14, 14]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="6" height="6" rx="1.8" stroke={color} strokeWidth="2" />
      ))}
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

function GiftIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 11.5h16V20a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20v-8.5Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 8h18v3.5H3V8ZM12 8v13.5" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 8S10.6 3.5 8 3.5A2.5 2.5 0 0 0 8 8.5c2.6 0 4-0.5 4-0.5Zm0 0s1.4-4.5 4-4.5a2.5 2.5 0 0 1 0 5c-2.6 0-4-.5-4-.5Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className = "", color = "#9a9aa0" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke={color} strokeWidth="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="1.4" fill={color} />
    </svg>
  );
}

function CheckIcon({ className = "", color = "#ffffff" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
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

// A reward's icon is its uploaded photo (square crop), falling back to a gift
// tile when there's no photo. Mirrors GoalImage so the two screens feel alike.
function RewardImage({ url, size, className = "" }: { url: string | null; size: number; className?: string }) {
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
      className={`flex shrink-0 items-center justify-center rounded-[14px] bg-[#fbeef6] ${className}`}
      style={{ width: size, height: size }}
    >
      <GiftIcon className="w-1/2" color="#d98bbd" />
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

// A short celebratory confetti rain. Pure CSS keyframes (see globals.css), no
// dependency. The overlay is decorative — pointer-events-none, sits above the
// modals — and the caller unmounts it after a beat. Honors reduced-motion.
const CONFETTI_COLORS = [
  "#6790dc", "#5181d4", "#5e8be8", "#f4abce", "#f3a6c9", "#d98bbd", "#22a86f", "#ffd166",
];
function Confetti({ count = 90, seed = 1 }: { count?: number; seed?: number }) {
  // Deterministic per-piece pseudo-randomness (Math.sin hash) — pure, so it's
  // safe to compute during render, and varied enough to look scattered. `seed`
  // (bumped per burst) keeps successive bursts from looking identical.
  const pieces = useMemo(() => {
    const h = (i: number, salt: number) => {
      const x = Math.sin((i + 1) * salt + seed * 2.399) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => ({
      left: h(i, 12.9898) * 100,
      size: 6 + h(i, 78.233) * 7,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: h(i, 39.346) * 0.5,
      duration: 2.4 + h(i, 11.135) * 1.8,
      drift: `${Math.round((h(i, 95.21) - 0.5) * 140)}px`,
      round: i % 2 === 0,
    }));
  }, [count, seed]);
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
      {pieces.map((p, i) => {
        const style = {
          left: `${p.left}%`,
          width: p.size,
          height: p.size,
          backgroundColor: p.color,
          borderRadius: p.round ? "9999px" : "2px",
          "--confetti-drift": p.drift,
          animation: `confetti-fall ${p.duration}s linear ${p.delay}s forwards`,
        } as React.CSSProperties;
        return <span key={i} className="confetti-piece absolute top-0 block" style={style} />;
      })}
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

export default function BankApp({ onExitToApps }: { onExitToApps?: () => void }) {
  const [who, setWho] = useState<Person>("luca");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Where the new transaction is funded from: the shared $20 bank, or the
  // person's earned reward money (which doesn't touch the bank).
  const [paySource, setPaySource] = useState<"bank" | "reward">("bank");
  // Optional GIPHY gif attached to the new transaction, plus picker visibility.
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which screen is showing. Home tab = home/all; Goals tab = goals/allGoals.
  const [view, setView] = useState<
    "home" | "all" | "goals" | "allGoals" | "analytics" | "category" | "rewards"
  >("home");
  // The category whose full history is showing on the "category" screen.
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  // Switching "pages" is just state here (no router), so the scroll position
  // carries over. Jump back to the top whenever the screen changes.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [view, categorySlug]);
  const [filter, setFilter] = useState<"all" | Person>("all");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  // A single recent-activity row the user tapped to inspect on the home screen.
  const [detail, setDetail] = useState<Expense | null>(null);

  // Goals screen state: which goal is being funded / edited / removed, and
  // whether the "new goal" sheet is open.
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [pendingDeleteGoal, setPendingDeleteGoal] = useState<Goal | null>(null);
  // A goal the user tapped to inspect (read-only detail sheet).
  const [goalDetail, setGoalDetail] = useState<Goal | null>(null);

  // Rewards screen state: the list, plus which reward is being created / edited /
  // inspected / removed.
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [newRewardOpen, setNewRewardOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rewardDetail, setRewardDetail] = useState<Reward | null>(null);
  const [pendingDeleteReward, setPendingDeleteReward] = useState<Reward | null>(null);
  // Confetti celebration: bumped key forces a fresh burst even on rapid re-fire.
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);
  function triggerCelebrate() {
    setCelebrateKey((k) => k + 1);
    setCelebrate(true);
    window.setTimeout(() => setCelebrate(false), 4200);
  }

  // Re-render every minute so the balance rolls over at Vancouver midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Deep-link entry: opening the app as `?amount=12.50&who=claire` (e.g. from
  // an iOS Shortcut / Back Tap) prefills the new-expense amount, preselects the
  // person, and drops you on the home screen ready to add a note and save. We
  // strip the params afterwards so a manual refresh starts clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("amount") && !params.has("who")) return;

    const rawAmount = params.get("amount");
    if (rawAmount != null) {
      const cleaned = rawAmount.trim();
      if (cleaned && Number.isFinite(Number(cleaned))) {
        setAmount(cleaned);
        setView("home");
      }
    }

    // "Claire" is stored as the person `irish`, so accept either spelling.
    const rawWho = params.get("who")?.trim().toLowerCase();
    if (rawWho === "luca") setWho("luca");
    else if (rawWho === "irish" || rawWho === "claire") setWho("irish");

    const url = new URL(window.location.href);
    url.searchParams.delete("amount");
    url.searchParams.delete("who");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  const load = useCallback(async () => {
    const [ex, gl, rw] = await Promise.all([
      supabase.from("expenses").select("*").order("created_at", { ascending: false }),
      supabase.from("goals").select("*").order("created_at", { ascending: false }),
      supabase.from("rewards").select("*").order("created_at", { ascending: false }),
    ]);
    if (ex.error) setError(ex.error.message);
    else if (gl.error) setError(gl.error.message);
    else {
      setError(null);
      setExpenses((ex.data ?? []) as Expense[]);
      setGoals((gl.data ?? []) as Goal[]);
    }
    // Rewards are non-critical: if the table isn't there yet (migration not run)
    // we keep the rest of the app working and just show no rewards.
    if (!rw.error) setRewards((rw.data ?? []) as Reward[]);
    setLoading(false);
  }, []);

  const loadRewards = useCallback(async () => {
    const { data, error } = await supabase
      .from("rewards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setRewards((data ?? []) as Reward[]);
    }
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

  // Reward-funded spends draw down the reward wallet, not the $20 bank, so they
  // don't count toward the bank balance.
  const totalSpent = useMemo(
    () => expenses.reduce((sum, e) => (e.from_reward ? sum : sum + Number(e.amount)), 0),
    [expenses],
  );
  // Money parked in goals is set aside from the bank, so it shrinks the
  // available balance just like a spend does.
  const totalSaved = useMemo(
    () => goals.reduce((sum, g) => sum + Number(g.saved), 0),
    [goals],
  );
  const balance = bankBalance(totalSpent + totalSaved, now);

  // Per-person reward wallet (earned − spent). Drives the cap on reward-funded
  // spends and the Reward money cards.
  const rewardMoney = useMemo(() => computeRewardMoney(rewards, expenses), [rewards, expenses]);
  // What the selected person can still spend from reward money right now.
  const rewardAvailable = Math.max(0, rewardMoney.available[who]);

  async function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0 || saving) return;
    // A reward-funded spend can't exceed what that person has earned.
    if (paySource === "reward" && (value <= 0 || value > rewardAvailable + 1e-9)) return;

    setSaving(true);
    const trimmed = note.trim();
    const { error } = await supabase.from("expenses").insert({
      person: who,
      amount: value,
      note: trimmed || null,
      category: inferCategory(trimmed),
      gif_url: gifUrl,
      from_reward: paySource === "reward",
    });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }
    setAmount("");
    setNote("");
    setGifUrl(null);
    setPaySource("bank");
    load();
  }

  async function saveEdit(
    row: Expense,
    next: { amount: number; note: string; person: Person },
  ): Promise<boolean> {
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
      return false;
    }
    setError(null);
    setEditing(null);
    load();
    return true;
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
  async function contributeToGoal(goal: Goal, amount: number): Promise<boolean> {
    const { error } = await supabase
      .from("goals")
      .update({ saved: Number(goal.saved) + amount })
      .eq("id", goal.id);
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    setContributing(null);
    loadGoals();
    return true;
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
  }): Promise<boolean> {
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
      return false;
    }
    // Clearing the flag on the others is a no-op when this goal isn't current.
    if (data && (next.makeCurrent || goals.length === 0)) await markCurrent(data.id);
    setError(null);
    setNewGoalOpen(false);
    loadGoals();
    return true;
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
  ): Promise<boolean> {
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
      return false;
    }
    if (next.makeCurrent && !goal.is_current) await markCurrent(goal.id);
    setError(null);
    setEditingGoal(null);
    loadGoals();
    return true;
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

  /* ---- reward operations ---- */

  async function createReward(next: {
    title: string;
    task: string;
    kind: "treat" | "cash";
    amount: number | null;
    person: Person | null;
    image_url: string | null;
  }): Promise<boolean> {
    const { error } = await supabase.from("rewards").insert({
      title: next.title,
      task: next.task,
      kind: next.kind,
      amount: next.kind === "cash" ? next.amount : null,
      person: next.person,
      image_url: next.image_url,
    });
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    setNewRewardOpen(false);
    loadRewards();
    return true;
  }

  async function saveRewardEdit(
    reward: Reward,
    next: {
      title: string;
      task: string;
      kind: "treat" | "cash";
      amount: number | null;
      person: Person | null;
      image_url: string | null;
    },
  ): Promise<boolean> {
    const { error } = await supabase
      .from("rewards")
      .update({
        title: next.title,
        task: next.task,
        kind: next.kind,
        amount: next.kind === "cash" ? next.amount : null,
        person: next.person,
        image_url: next.image_url,
      })
      .eq("id", reward.id);
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    setEditingReward(null);
    loadRewards();
    return true;
  }

  // Mark the gating task done / not done. Un-completing also voids any claim, so
  // a reward can't be "claimed" while its task is open.
  async function setRewardDone(reward: Reward, done: boolean): Promise<boolean> {
    const { error } = await supabase
      .from("rewards")
      .update(
        done
          ? { done_at: new Date().toISOString() }
          : { done_at: null, claimed_at: null },
      )
      .eq("id", reward.id);
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    loadRewards();
    return true;
  }

  // Redeem (or un-redeem) a reward once its task is done.
  async function setRewardClaimed(reward: Reward, claimed: boolean): Promise<boolean> {
    const { error } = await supabase
      .from("rewards")
      .update({ claimed_at: claimed ? new Date().toISOString() : null })
      .eq("id", reward.id);
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    loadRewards();
    return true;
  }

  async function deleteReward(reward: Reward) {
    const { error } = await supabase.from("rewards").delete().eq("id", reward.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setPendingDeleteReward(null);
    loadRewards();
  }

  // Shared modal stack for the goals screens (mounted by both goals + allGoals).
  const goalModals = (
    <>
      {goalDetail && (
        <GoalDetailModal
          goal={goalDetail}
          onClose={() => setGoalDetail(null)}
          onContribute={() => {
            setContributing(goalDetail);
            setGoalDetail(null);
          }}
          onEdit={() => {
            setEditingGoal(goalDetail);
            setGoalDetail(null);
          }}
          onDelete={() => {
            setPendingDeleteGoal(goalDetail);
            setGoalDetail(null);
          }}
          onSetCurrent={() => {
            setGoalCurrent(goalDetail);
            setGoalDetail(null);
          }}
        />
      )}
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

  // Shared modal stack for the rewards screen.
  const rewardModals = (
    <>
      {rewardDetail && (
        <RewardDetailModal
          reward={rewardDetail}
          onClose={() => setRewardDetail(null)}
          onToggleDone={async (done) => {
            const ok = await setRewardDone(rewardDetail, done);
            if (ok) {
              setRewardDetail((r) => (r ? { ...r, done_at: done ? new Date().toISOString() : null, claimed_at: done ? r.claimed_at : null } : r));
              if (done) triggerCelebrate();
            }
          }}
          onToggleClaim={async (claimed) => {
            const ok = await setRewardClaimed(rewardDetail, claimed);
            if (ok) {
              setRewardDetail((r) => (r ? { ...r, claimed_at: claimed ? new Date().toISOString() : null } : r));
              if (claimed) triggerCelebrate();
            }
          }}
          onEdit={() => {
            setEditingReward(rewardDetail);
            setRewardDetail(null);
          }}
          onDelete={() => {
            setPendingDeleteReward(rewardDetail);
            setRewardDetail(null);
          }}
        />
      )}
      {newRewardOpen && (
        <RewardFormModal onClose={() => setNewRewardOpen(false)} onSave={createReward} />
      )}
      {editingReward && (
        <RewardFormModal
          reward={editingReward}
          onClose={() => setEditingReward(null)}
          onSave={(next) => saveRewardEdit(editingReward, next)}
        />
      )}
      {pendingDeleteReward && (
        <ConfirmDeleteRewardModal
          reward={pendingDeleteReward}
          onCancel={() => setPendingDeleteReward(null)}
          onConfirm={() => deleteReward(pendingDeleteReward)}
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
        onRewards={() => setView("rewards")}
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
        onRewards={() => setView("rewards")}
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
        onAnalytics={() => setView("analytics")}
        onRewards={() => setView("rewards")}
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
          onEdit={setEditingGoal}
          onDetails={setGoalDetail}
          onAnalytics={() => setView("analytics")}
          onRewards={() => setView("rewards")}
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
          onAnalytics={() => setView("analytics")}
          onRewards={() => setView("rewards")}
        />
        {goalModals}
      </>
    );
  }

  if (view === "rewards") {
    return (
      <>
        <RewardsScreen
          rewards={rewards}
          expenses={expenses}
          loading={loading}
          error={error}
          onHome={() => setView("home")}
          onGoals={() => setView("goals")}
          onAnalytics={() => setView("analytics")}
          onNewReward={() => setNewRewardOpen(true)}
          onDetails={setRewardDetail}
        />
        {rewardModals}
        {celebrate && <Confetti key={celebrateKey} seed={celebrateKey} />}
      </>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-20 pt-[max(env(safe-area-inset-top),14px)]">
        {/* ---- back to the app launcher ---- */}
        {onExitToApps && (
          <div className="flex">
            <button
              type="button"
              onClick={onExitToApps}
              className="flex items-center gap-1 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-[#2b2b2b] shadow-[0_4px_12px_rgba(120,150,200,0.18)] backdrop-blur transition active:scale-95"
            >
              <GridIcon className="w-4" />
              Apps
            </button>
          </div>
        )}

        {/* ---- Shared Bank card ---- */}
        <section className="relative overflow-hidden rounded-[22px] bg-[#e7f1fd] px-5 pt-5 pb-6 shadow-[0_8px_24px_rgba(120,150,200,0.18)]">
          <p className="text-center text-[15px] text-[#3a3a3a]">Shared Bank</p>
          <p
            className={`font-daruma mt-1.5 text-center text-[68px] leading-none ${
              loading ? "text-black" : balance < 0 ? "text-[#d4453e]" : "text-[#22a86f]"
            }`}
          >
            {loading ? "—" : formatBalance(balance)}
          </p>
          <p className="mt-2 text-center text-[11px] text-[#8d8d93]">
            <span className="text-[#2f63e6]">+ ${DAILY_ALLOWANCE}</span> every midnight (Vancouver time)
          </p>
        </section>

        {/* ---- Add a transaction ---- */}
        <section className="relative rounded-[22px] bg-white px-4 pt-3.5 pb-4 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-3 flex items-center">
            <h2 className="text-[16px] text-[#2b2b2b]">Add a transaction</h2>
          </div>

          {/* note — what it was for, entered first */}
          <div className="mb-2.5 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
            <ChatIcon className="w-4 shrink-0" />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was it for?"
              className="w-full bg-transparent text-[14px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
            />
          </div>

          {/* person toggle + amount */}
          <div className="mb-3 flex items-stretch gap-2">
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
          </div>

          {/* pay with: shared bank or earned reward money */}
          <div className="mb-3">
            <div className="flex overflow-hidden rounded-[14px] border border-[#e7e9ef]">
              {(["bank", "reward"] as const).map((src) => {
                const active = paySource === src;
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setPaySource(src)}
                    className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[13px] transition ${
                      active ? "bg-[#dbe3f6] text-[#2f63e6]" : "text-[#8d8d93]"
                    }`}
                  >
                    {src === "reward" && <GiftIcon className="w-3.5" color={active ? "#2f63e6" : "#9a9aa0"} />}
                    {src === "bank" ? "Bank" : "Reward money"}
                  </button>
                );
              })}
            </div>
            {paySource === "reward" && (
              <p className="mt-1.5 text-[12px] text-[#8d8d93]">
                {NAME[who]} has <span className="text-[#2b2b2b]">{money(rewardAvailable)}</span> of reward money
              </p>
            )}
            {paySource === "reward" && Number(amount) > rewardAvailable + 1e-9 && (
              <p className="mt-1 text-[12px] text-[#d4453e]">That&apos;s more than {NAME[who]}&apos;s reward money.</p>
            )}
          </div>

          {/* gif */}
          {gifUrl ? (
            <div className="relative mb-3 overflow-hidden rounded-[14px] ring-1 ring-[#e7e9ef]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gifUrl} alt="Selected gif" decoding="async" className="max-h-64 w-full object-cover" />
              <button
                type="button"
                onClick={() => setGifUrl(null)}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-[16px] leading-none text-white backdrop-blur"
                aria-label="Remove gif"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setGifPickerOpen(true)}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-[14px] py-2.5 text-[14px] text-[#2f63e6] ring-1 ring-[#e7e9ef] transition active:scale-[0.99]"
            >
              <span className="rounded bg-[#2f63e6] px-1 py-0.5 text-[10px] font-bold leading-none text-white">GIF</span>
              Add a GIF
            </button>
          )}

          {/* submit */}
          <button
            type="button"
            onClick={submit}
            disabled={
              saving ||
              amount.trim() === "" ||
              (paySource === "reward" && !(Number(amount) > 0 && Number(amount) <= rewardAvailable + 1e-9))
            }
            className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? "Adding…" : paySource === "reward" ? "Spend reward money" : "+ Add transaction"}
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
              {expenses.slice(0, 5).map((e, i, arr) => {
                const { text, spent } = formatAmount(Number(e.amount));
                const label = e.note || (spent ? "Spent" : "Paid back");
                return (
                  <li
                    key={e.id}
                    className={i !== arr.length - 1 ? "border-b border-[#f0f0f2]" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => setDetail(e)}
                      className="flex w-full items-center gap-2.5 py-2 text-left transition active:scale-[0.99]"
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
                        {e.from_reward ? (
                          <GiftIcon className="w-5" color="#d98bbd" />
                        ) : spent ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={categoryIcon(e.category)} alt="" loading="lazy" decoding="async" className="h-5 w-5 object-contain" />
                        ) : (
                          <HeartIcon className="w-5" />
                        )}
                      </span>
                    </button>
                    {e.gif_url && (
                      <button
                        type="button"
                        onClick={() => setDetail(e)}
                        className="mb-2 block w-full overflow-hidden rounded-[14px]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={e.gif_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="max-h-48 w-full object-cover"
                        />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {detail && (
        <TransactionDetailModal
          expense={detail}
          now={now}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          onDelete={() => {
            setPendingDelete(detail);
            setDetail(null);
          }}
        />
      )}
      {editing && (
        <EditModal expense={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
      )}
      {pendingDelete && (
        <ConfirmDeleteModal
          expense={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteExpense(pendingDelete)}
        />
      )}

      <BottomNav
        tab="home"
        onHome={() => setView("home")}
        onGoals={() => setView("goals")}
        onAnalytics={() => setView("analytics")}
        onRewards={() => setView("rewards")}
      />

      {gifPickerOpen && (
        <GifPicker
          onClose={() => setGifPickerOpen(false)}
          onPick={(url) => {
            setGifUrl(url);
            setGifPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

// A GIPHY-backed gif search sheet. Opens on "trending", searches as you type,
// and calls onPick with the chosen gif's url. We prefer the animated .webp
// rendition (≈10× cheaper to decode on mobile than .gif) and fall back to the
// .gif url when GIPHY doesn't return one. Needs NEXT_PUBLIC_GIPHY_API_KEY.
type GiphyItem = { id: string; images: { fixed_width: { url: string; webp?: string } } };

// Lightest playable rendition for a GIPHY item.
const gifSrc = (g: GiphyItem) => g.images.fixed_width.webp || g.images.fixed_width.url;

function GifPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (url: string) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Missing-key is a render-time fact, not effect state.
  const error = apiKey
    ? fetchError
    : "Missing NEXT_PUBLIC_GIPHY_API_KEY — add it to .env.local.";

  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    // Debounce typing; empty query shows trending.
    const t = setTimeout(async () => {
      setLoading(true);
      setFetchError(null);
      const q = query.trim();
      const base = q
        ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q)}&`
        : `https://api.giphy.com/v1/gifs/trending?`;
      try {
        const res = await fetch(
          `${base}api_key=${apiKey}&limit=24&rating=g&bundle=fixed_width_downsampled`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`GIPHY ${res.status}`);
        const json = await res.json();
        setResults((json.data ?? []) as GiphyItem[]);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setFetchError("Couldn't reach GIPHY. Check the API key and your connection.");
        }
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query, apiKey]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80dvh] w-full max-w-[420px] flex-col rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] text-[#2b2b2b]">Pick a GIF</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f0f0f2] text-[16px] leading-none text-[#6b6b72]"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIPHY…"
          className="mb-3 w-full rounded-[14px] bg-white px-3 py-2.5 text-[14px] text-[#2b2b2b] outline-none ring-1 ring-[#e7e9ef] placeholder:text-[#aeb1b9]"
        />

        {error ? (
          <p className="py-6 text-center text-[13px] text-[#d4453e]">{error}</p>
        ) : loading && results.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#a9a9b0]">Loading…</p>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#a9a9b0]">No gifs found.</p>
        ) : (
          <div className="columns-2 gap-2 overflow-y-auto">
            {results.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(gifSrc(g))}
                className="mb-2 block w-full break-inside-avoid overflow-hidden rounded-[12px] bg-[#f0f0f2] transition active:scale-[0.98]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gifSrc(g)} alt="" loading="lazy" decoding="async" className="block w-full" />
              </button>
            ))}
          </div>
        )}

        <p className="mt-3 text-center text-[10px] text-[#c2c2c8]">Powered by GIPHY</p>
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

// Shared bottom nav. `tab` highlights the active section; all four route.
function BottomNav({
  tab,
  onHome,
  onGoals,
  onAnalytics,
  onRewards,
}: {
  tab: "home" | "goals" | "analytics" | "rewards";
  onHome: () => void;
  onGoals: () => void;
  onAnalytics: () => void;
  onRewards: () => void;
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
            label="Task"
            active={tab === "rewards"}
            onClick={onRewards}
            icon={<GiftIcon className="w-5" color={tab === "rewards" ? blue : dark} />}
          />
          <NavItem
            label="Goals"
            active={tab === "goals"}
            onClick={onGoals}
            icon={<StarIcon className="w-5" color={tab === "goals" ? blue : dark} />}
          />
          <NavItem
            label="Analytics"
            active={tab === "analytics"}
            onClick={onAnalytics}
            icon={<BarsIcon className="w-5" color={tab === "analytics" ? blue : dark} />}
          />
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
  onAnalytics,
  onRewards,
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
  onAnalytics: () => void;
  onRewards: () => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  editing: Expense | null;
  onCloseEdit: () => void;
  onSaveEdit: (
    row: Expense,
    next: { amount: number; note: string; person: Person },
  ) => Promise<boolean>;
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
              Claire
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
                      <p className="flex items-center gap-1 text-[14px] leading-tight text-[#2b2b2b]">
                        <span className="truncate">
                          {NAME[e.person]} <span className="mx-1 text-[#c2c2c8]">·</span> {label}
                        </span>
                        {e.from_reward && <GiftIcon className="w-3.5 shrink-0" color="#d98bbd" />}
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

      <BottomNav tab="home" onHome={onBack} onGoals={onGoals} onAnalytics={onAnalytics} onRewards={onRewards} />
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
  onSave: (
    row: Expense,
    next: { amount: number; note: string; person: Person },
  ) => Promise<boolean>;
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

  async function commit() {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onSave(expense, {
      amount: kind === "spent" ? Math.abs(value) : -Math.abs(value),
      note,
      person,
    });
    if (!ok) setBusy(false); // on success the modal unmounts; on failure, re-enable
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

// Read-only detail sheet for one transaction, opened by tapping a recent
// activity row on the home screen. Surfaces the full note, category, and time,
// plus the gif if one was attached, and hands off to edit / remove.
function TransactionDetailModal({
  expense,
  now,
  onClose,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  now: Date;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { text, spent } = formatAmount(Number(expense.amount));
  const categoryName = spent
    ? CATEGORY_LABEL[expense.category ?? ""] ?? "Shopping"
    : "Paid back";

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">Transaction</h2>

        {/* who + amount */}
        <div className="flex items-center gap-3">
          <Avatar person={expense.person} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight text-[#2b2b2b]">
              {NAME[expense.person]}
            </p>
            <p className="mt-0.5 text-[12px] text-[#a9a9b0]">{formatWhen(expense.created_at, now)}</p>
          </div>
          <span className={`text-[22px] ${spent ? "text-[#2b2b2b]" : "text-[#18953f]"}`}>
            {text}
          </span>
        </div>

        {/* details */}
        <div className="mt-3 space-y-2 rounded-[14px] bg-[#f7f8fb] px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#a9a9b0]">Note</span>
            <span className="min-w-0 truncate text-[14px] text-[#2b2b2b]">
              {expense.note || "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#a9a9b0]">Category</span>
            <span className="flex items-center gap-1.5 text-[14px] text-[#2b2b2b]">
              {spent ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={categoryIcon(expense.category)} alt="" className="h-4 w-4 object-contain" />
              ) : (
                <HeartIcon className="w-4" />
              )}
              {categoryName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#a9a9b0]">Paid with</span>
            <span className="flex items-center gap-1.5 text-[14px] text-[#2b2b2b]">
              {expense.from_reward ? (
                <>
                  <GiftIcon className="w-4" color="#d98bbd" />
                  Reward money
                </>
              ) : (
                "Bank"
              )}
            </span>
          </div>
        </div>

        {expense.gif_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={expense.gif_url}
            alt=""
            decoding="async"
            className="mt-3 max-h-44 w-full rounded-[14px] object-cover"
          />
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-[#fdecec] py-2.5 text-[15px] text-[#d4453e] transition active:scale-[0.99]"
          >
            <TrashIcon className="w-[18px]" color="#d4453e" />
            Remove
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99]"
          >
            <PencilIcon className="w-[18px]" color="#ffffff" />
            Edit
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

// A "More goals" card on the goals home: photo · title/amount, then two clear
// actions — "+" to add leftover toward it, and a pencil to edit it. Tapping the
// photo/title area opens the read-only detail sheet.
function MoreGoalCard({
  goal,
  onContribute,
  onEdit,
  onDetails,
}: {
  goal: Goal;
  onContribute: (g: Goal) => void;
  onEdit: (g: Goal) => void;
  onDetails: (g: Goal) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-[18px] bg-white px-3.5 py-3 shadow-[0_6px_16px_rgba(120,150,200,0.12)]">
      <button
        type="button"
        onClick={() => onDetails(goal)}
        aria-label={`View ${goal.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left transition active:scale-[0.99]"
      >
        <GoalImage url={goal.image_url} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-tight text-[#2b2b2b]">{goal.title}</span>
          <span className="mt-0.5 block text-[12px] text-[#a9a9b0]">
            {money(Number(goal.saved))} <span className="text-[#c2c2c8]">of {money(Number(goal.target))}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onEdit(goal)}
        aria-label={`Edit ${goal.title}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f6fc] transition active:scale-90"
      >
        <PencilIcon className="w-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => onContribute(goal)}
        aria-label={`Add to ${goal.title}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#6790dc] to-[#5181d4] transition active:scale-90"
      >
        <PlusIcon className="w-[18px]" color="#ffffff" />
      </button>
    </div>
  );
}

// Read-only detail sheet for one goal, opened by tapping a goal card. Shows the
// photo, progress, and how much is left, then hands off to add / edit / remove.
function GoalDetailModal({
  goal,
  onClose,
  onContribute,
  onEdit,
  onDelete,
  onSetCurrent,
}: {
  goal: Goal;
  onClose: () => void;
  onContribute: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetCurrent: () => void;
}) {
  const saved = Number(goal.saved);
  const target = Number(goal.target);
  const toGo = Math.max(0, target - saved);
  const done = saved >= target && target > 0;
  const pct = Math.round(goalProgress(goal) * 100);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">Goal</h2>

        {/* photo + title */}
        <div className="flex items-center gap-3">
          <GoalImage url={goal.image_url} size={56} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[17px] leading-tight text-[#2b2b2b]">
              {goal.title}
              {goal.is_current && <FlagIcon className="w-3.5 shrink-0" color="#2f63e6" />}
            </p>
            {goal.subtitle && (
              <p className="mt-0.5 truncate text-[12px] text-[#8d8d93]">{goal.subtitle}</p>
            )}
          </div>
        </div>

        {/* progress */}
        <div className="mt-3 rounded-[14px] bg-[#f7f8fb] px-3.5 py-3">
          <p className="text-[20px] leading-none text-[#2b2b2b]">
            {money(saved)} <span className="text-[14px] text-[#8d8d93]">of {money(target)}</span>
          </p>
          <ProgressBar value={goalProgress(goal)} className="mt-2.5 h-2.5 w-full" />
          <div className="mt-2 flex items-center justify-between text-[12px] text-[#a4a7af]">
            <span>{pct}% saved</span>
            <span>{done ? "Goal reached! 🎉" : `${money(toGo)} to go`}</span>
          </div>
        </div>

        {!goal.is_current && (
          <button
            type="button"
            onClick={onSetCurrent}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[14px] bg-[#eef3fb] py-2 text-[13px] text-[#2f63e6] transition active:scale-[0.99]"
          >
            <StarIcon className="w-4" color="#2f63e6" />
            Make this the current goal
          </button>
        )}

        {/* add */}
        <button
          type="button"
          onClick={onContribute}
          disabled={done}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
        >
          <PlusIcon className="w-[18px]" color="#ffffff" />
          Add to goal
        </button>

        {/* edit / remove */}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-[#fdecec] py-2.5 text-[15px] text-[#d4453e] transition active:scale-[0.99]"
          >
            <TrashIcon className="w-[18px]" color="#d4453e" />
            Remove
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            <PencilIcon className="w-[18px]" color="#2b2b2b" />
            Edit
          </button>
        </div>
      </div>
    </div>
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
  onEdit,
  onDetails,
  onAnalytics,
  onRewards,
}: {
  goals: Goal[];
  loading: boolean;
  error: string | null;
  onHome: () => void;
  onViewAll: () => void;
  onContribute: (g: Goal) => void;
  onNewGoal: () => void;
  onEdit: (g: Goal) => void;
  onDetails: (g: Goal) => void;
  onAnalytics: () => void;
  onRewards: () => void;
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
                  <p className="text-[12px] text-[#a9a9b0]">No other goals yet. Tap “New goal” to add one.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rest.map((g) => (
                    <MoreGoalCard
                      key={g.id}
                      goal={g}
                      onContribute={onContribute}
                      onEdit={onEdit}
                      onDetails={onDetails}
                    />
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

      <BottomNav tab="goals" onHome={onHome} onGoals={() => {}} onAnalytics={onAnalytics} onRewards={onRewards} />
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
          <span className="flex w-[112px] shrink-0 items-center justify-center self-stretch overflow-hidden rounded-[18px] bg-[#e7f1fd]">
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

        {/* ---- add ---- */}
        <div className="mt-3.5">
          <button
            type="button"
            onClick={() => onContribute(goal)}
            disabled={done}
            className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-b from-[#6790dc] to-[#5181d4] px-5 py-2.5 text-[14px] text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            <PlusIcon className="w-4" color="#ffffff" />
            Add leftover
          </button>
        </div>
      </div>
    </section>
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
  onAnalytics,
  onRewards,
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
  onAnalytics: () => void;
  onRewards: () => void;
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

      <BottomNav tab="goals" onHome={onHome} onGoals={onBack} onAnalytics={onAnalytics} onRewards={onRewards} />
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
  onConfirm: (g: Goal, amount: number) => Promise<boolean>;
}) {
  const toGo = Math.max(0, Number(goal.target) - Number(goal.saved));
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const valid =
    Number.isFinite(value) && value > 0 && value <= available + 1e-9;

  async function commit() {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onConfirm(goal, value);
    if (!ok) setBusy(false); // on success the modal unmounts; on failure, re-enable
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
  }) => Promise<boolean>;
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

    const ok = await onSave({
      title: title.trim(),
      subtitle: subtitle.trim(),
      target: targetValue,
      image_url: url,
      makeCurrent,
    });
    if (!ok) setBusy(false); // on success the modal unmounts; on failure, re-enable
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
  daysElapsed: number; // Mon..today inclusive, 1..7
  weekBudget: number; // $20 × daysElapsed accrued so far this week
  left: number; // weekBudget − spent (negative means over)
  avgPerDay: number;
  daysUnder: number; // elapsed days that stayed under the $20 allowance
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
    if (e.from_reward) continue; // reward-funded spends aren't bank spending
    const idx = dayNum(vanYMD(new Date(e.created_at))) - weekStart;
    if (idx < 0 || idx > 6) continue;
    daily[idx] += amt;
    byPerson[e.person] += amt;
    const slug = expenseSlug(e);
    catMap.set(slug, (catMap.get(slug) ?? 0) + amt);
  }

  const spent = daily.reduce((s, v) => s + v, 0);
  // Days from this week's Monday through today (inclusive), capped at the full week.
  const daysElapsed = Math.min(7, Math.max(1, dayNum(vanYMD(now)) - weekStart + 1));
  // Everything is measured against the real $20/day allowance, not a self-pace.
  const weekBudget = DAILY_ALLOWANCE * daysElapsed;
  const left = weekBudget - spent;
  const avgPerDay = spent / daysElapsed;
  // Days so far that stayed under the $20 daily allowance (a $0 day counts).
  let daysUnder = 0;
  for (let i = 0; i < daysElapsed; i++) if (daily[i] < DAILY_ALLOWANCE) daysUnder++;

  const byCategory = [...catMap.entries()]
    .map(([slug, amount]) => ({ slug, amount }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return (
        (CATEGORY_SLUGS as readonly string[]).indexOf(a.slug) -
        (CATEGORY_SLUGS as readonly string[]).indexOf(b.slug)
      );
    });

  return { spent, daysElapsed, weekBudget, left, avgPerDay, daysUnder, daily, byPerson, byCategory };
}

function AnalyticsScreen({
  expenses,
  loading,
  now,
  onHome,
  onGoals,
  onRewards,
  onViewCategory,
}: {
  expenses: Expense[];
  loading: boolean;
  now: Date;
  onHome: () => void;
  onGoals: () => void;
  onRewards: () => void;
  onViewCategory: (slug: string) => void;
}) {
  const stats = useMemo(() => weekStats(expenses, now), [expenses, now]);
  const [sheetSlug, setSheetSlug] = useState<string | null>(null);
  const catMax = Math.max(1, ...stats.byCategory.map((c) => c.amount));
  const top = stats.byCategory.slice(0, 5);
  const over = stats.left < 0;
  const budgetPct = Math.min(100, (stats.spent / Math.max(1, stats.weekBudget)) * 100);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-24 pt-[max(env(safe-area-inset-top),14px)]">
        <div className="flex items-center justify-center py-1.5">
          <h1 className="text-[20px] text-[#2b2b2b]">Analytics</h1>
        </div>

        {/* ---- This week ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-3.5 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-bold text-[#2b2b2b]">This week</h2>
              <CalendarIcon className="w-4" color="#9aa0ab" />
            </div>
            <span className="rounded-full bg-[#eef3fb] px-2.5 py-[3px] text-[11px] text-[#5e8be8]">
              Day {stats.daysElapsed} of 7
            </span>
          </div>

          {/* spent vs this week's $20/day budget */}
          <div className="flex items-end justify-between">
            <span className="text-[26px] leading-none text-[#2b2b2b]">
              {loading ? "—" : money(stats.spent)}
              <span className="ml-1 text-[12px] text-[#a9a9b0]">spent</span>
            </span>
            {!loading && (
              <span className={`text-[14px] ${over ? "text-[#ef8f9c]" : "text-[#34b88a]"}`}>
                {over ? `${money(-stats.left)} over` : `${money(stats.left)} left`}
              </span>
            )}
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#f0f2f7]">
            <div
              className={`h-full rounded-full ${over ? "bg-[#ef8f9c]" : "bg-gradient-to-r from-[#6f9af0] to-[#5a86e6]"}`}
              style={{ width: `${loading ? 0 : budgetPct}%` }}
            />
          </div>
          {!loading && (
            <p className="mt-2 text-[12px] text-[#a9a9b0]">
              Averaging ${stats.avgPerDay.toFixed(2)} a day this week
            </p>
          )}
        </section>

        {/* ---- Where it went ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-2 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[16px] font-bold text-[#2b2b2b]">Where it went</h2>
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

      <BottomNav tab="analytics" onHome={onHome} onGoals={onGoals} onAnalytics={() => {}} onRewards={onRewards} />
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

// Sassy, category-flavoured one-liners for the insight chip. `{pct}` is filled
// with the category's share of the week. Multiple variants per category; we
// pick one deterministically below so it stays put across re-renders.
const SASSY_INSIGHTS: Record<string, string[]> = {
  coffee: [
    "The coffee machine at home is right there, you know. ☕",
    "Another $7 latte? Bold of you.",
  ],
  food: [
    "{pct}% on snacks. We're calling it groceries now? 🧍",
    "Ordering food again. Your kitchen is filing a complaint.",
  ],
  groceries: [
    "Groceries. Look at you being a functional adult. 👏",
    "Actually responsible spending? Who are you.",
  ],
  transport: [
    "{pct}% just to be driven around. The legs work. 🚌",
    "All those bus taps really do add up, huh.",
  ],
  fun: [
    "And that's why we're not going to Japan. 🗾",
    "{pct}% on fun. The vacation fund is crying.",
  ],
  clothes: [
    "Another outfit? The closet is full and you know it. 🧥",
    "{pct}% on clothes and still 'nothing to wear.'",
  ],
  gifts: [
    "{pct}% on gifts. Generous of you — where's mine? 🎁",
    "Spoiling someone, I see. Hope it's worth it.",
  ],
  bills: [
    "Bills. The responsible kind of broke. 😮‍💨",
    "{pct}% on bills. Adulting isn't a personality, but okay.",
  ],
  health: [
    "Health spending? Okay, that's the good kind. 💪",
    "Taking care of yourself. We'll allow it.",
  ],
  shopping: [
    "Do you really need this? Be honest. 🛍️",
    "{pct}% on shopping. The cart was full again, wasn't it.",
  ],
};

// Generic sass for the top category and the fallback line.
const SASSY_TOP = "{label} is the main villain of your wallet this week. 👀";
const SASSY_FALLBACK = ["Do you really need this? Be honest.", "{label} is quietly eating the budget."];

// Build the insight string for a category. rank 1 gets the "biggest" jab;
// otherwise a category-specific quip (or a generic one). Variant is chosen from
// the data so it's stable per render rather than random.
function sassyInsight(slug: string, label: string, pct: number, rank: number, seed: number): string {
  const fill = (s: string) => s.replace("{pct}", String(pct)).replace("{label}", label);
  if (rank === 1) return fill(SASSY_TOP);
  const variants = SASSY_INSIGHTS[slug] ?? SASSY_FALLBACK;
  return fill(variants[seed % variants.length]);
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
    .filter((e) => Number(e.amount) > 0 && !e.from_reward && expenseSlug(e) === slug && isThisWeek(e.created_at, now))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const total = rows.reduce((s, e) => s + Number(e.amount), 0);
  const pct = stats.spent > 0 ? Math.round((total / stats.spent) * 100) : 0;
  const rank = stats.byCategory.findIndex((c) => c.slug === slug) + 1;
  const insight = sassyInsight(slug, label, pct, rank, rows.length + pct);

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
  onRewards,
}: {
  slug: string;
  expenses: Expense[];
  loading: boolean;
  now: Date;
  onBack: () => void;
  onHome: () => void;
  onGoals: () => void;
  onRewards: () => void;
}) {
  const label = CATEGORY_LABEL[slug] ?? slug;
  const rows = expenses.filter((e) => Number(e.amount) > 0 && !e.from_reward && expenseSlug(e) === slug);
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
                        <img src={categoryIcon(e.category)} alt="" loading="lazy" decoding="async" className="h-5 w-5 object-contain" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <BottomNav tab="analytics" onHome={onHome} onGoals={onGoals} onAnalytics={onBack} onRewards={onRewards} />
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

/* ------------------------------------------------------------------ */
/*  Rewards screen                                                    */
/* ------------------------------------------------------------------ */

// Visual treatment per reward state — the pill on cards and the accent ring.
const REWARD_STATUS_META: Record<RewardStatus, { label: string; bg: string; fg: string }> = {
  locked: { label: "Locked", bg: "#f1f2f6", fg: "#8d8d93" },
  ready: { label: "Ready to claim", bg: "#e6f7ef", fg: "#1f9d63" },
  claimed: { label: "Claimed", bg: "#eef3fb", fg: "#2f63e6" },
};

// "$5" for a cash reward, otherwise the title carries the meaning on its own.
function rewardAmountLabel(r: Reward): string | null {
  if (r.kind !== "cash") return null;
  const n = Number(r.amount);
  return Number.isFinite(n) && n > 0 ? money(n) : null;
}

function StatusPill({ status }: { status: RewardStatus }) {
  const m = REWARD_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-none"
      style={{ backgroundColor: m.bg, color: m.fg }}
    >
      {status === "locked" && <LockIcon className="w-3" color={m.fg} />}
      {status === "ready" && <span aria-hidden>✨</span>}
      {status === "claimed" && <CheckIcon className="w-3" color={m.fg} />}
      {m.label}
    </span>
  );
}

// "+ New reward" pill, mirrors NewGoalButton.
function NewRewardButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full border border-[#cdd9f0] bg-white px-3 py-1.5 text-[13px] text-[#2f63e6] transition active:scale-95"
    >
      <PlusIcon className="w-3.5" />
      New reward
    </button>
  );
}

// One reward card: photo · reward + task · status, with the cash value (if any)
// as a badge. Tapping anywhere opens the detail sheet.
function RewardCard({ reward, onDetails }: { reward: Reward; onDetails: (r: Reward) => void }) {
  const status = rewardStatus(reward);
  const amount = rewardAmountLabel(reward);
  return (
    <button
      type="button"
      onClick={() => onDetails(reward)}
      className={`flex w-full items-center gap-3 rounded-[18px] bg-white px-3.5 py-3 text-left shadow-[0_6px_16px_rgba(120,150,200,0.12)] transition active:scale-[0.99] ${
        status === "claimed" ? "opacity-75" : ""
      }`}
    >
      <RewardImage url={reward.image_url} size={52} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[15px] leading-tight text-[#2b2b2b] ${status === "claimed" ? "line-through decoration-[#c2c2c8]" : ""}`}>
            {reward.title}
          </span>
          {amount && (
            <span className="shrink-0 rounded-full bg-[#e7f1fd] px-2 py-[2px] text-[13px] text-[#2f63e6]">
              {amount}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12px] text-[#a9a9b0]">
          <FlagIcon className="w-3 shrink-0" color="#bcbfc7" />
          <span className="min-w-0 truncate">{reward.task}</span>
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <StatusPill status={status} />
          {reward.person && (
            <span className="flex items-center gap-1 text-[11px] text-[#a9a9b0]">
              <Avatar person={reward.person} size={16} />
              {NAME[reward.person]}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function RewardsScreen({
  rewards,
  expenses,
  loading,
  error,
  onHome,
  onGoals,
  onAnalytics,
  onNewReward,
  onDetails,
}: {
  rewards: Reward[];
  expenses: Expense[];
  loading: boolean;
  error: string | null;
  onHome: () => void;
  onGoals: () => void;
  onAnalytics: () => void;
  onNewReward: () => void;
  onDetails: (r: Reward) => void;
}) {
  // Active = anything not yet claimed, with ready-to-claim floated to the top so
  // the thing you've earned is the first thing you see. Claimed sits below.
  const active = rewards
    .filter((r) => rewardStatus(r) !== "claimed")
    .sort((a, b) => Number(rewardStatus(b) === "ready") - Number(rewardStatus(a) === "ready"));
  const claimed = rewards.filter((r) => rewardStatus(r) === "claimed");
  const readyCount = rewards.filter((r) => rewardStatus(r) === "ready").length;

  // Spendable reward money per person = earned (claimed cash) − spent through
  // reward-funded transactions. "Anyone" rewards don't land in either card.
  const { available, spent } = computeRewardMoney(rewards, expenses);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-3 px-4 pb-20 pt-[max(env(safe-area-inset-top),14px)]">
        <GoalsHeader title="Rewards" />

        {error && <p className="text-center text-[12px] text-[#d4453e]">{error}</p>}

        {/* ---- reward money — each person has their own card ---- */}
        {!loading && (
          <div className="grid grid-cols-2 gap-3">
            {([
              { person: "luca" as Person, bg: "#e7f1fd" },
              { person: "irish" as Person, bg: "#fbeef6" },
            ]).map(({ person, bg }) => (
              <section
                key={person}
                className="rounded-[20px] px-3 pt-4 pb-3.5 text-center shadow-[0_8px_24px_rgba(120,150,200,0.16)]"
                style={{ backgroundColor: bg }}
              >
                <div className="flex justify-center">
                  <Avatar person={person} size={40} />
                </div>
                <p className="mt-1 text-[13px] text-[#3a3a3a]">{NAME[person]}</p>
                <p className="font-daruma mt-1 text-[34px] leading-none text-[#2b2b2b]">
                  {money(Math.max(0, available[person]))}
                </p>
                <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-[#8d8d93]">
                  <GiftIcon className="w-3" color="#b9a0b3" />
                  {spent[person] > 0 ? `reward money · ${money(spent[person])} spent` : "reward money"}
                </p>
              </section>
            ))}
          </div>
        )}

        {loading ? null : rewards.length === 0 ? (
          /* ---- empty state ---- */
          <section className="rounded-[22px] bg-white px-5 py-8 text-center shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#fbeef6]">
              <GiftIcon className="w-7" color="#d98bbd" />
            </span>
            <p className="text-[15px] text-[#2b2b2b]">No rewards yet</p>
            <p className="mt-1 text-[12px] text-[#a9a9b0]">
              Pick a treat, then set the task to unlock it.
            </p>
            <button
              type="button"
              onClick={onNewReward}
              className="mx-auto mt-4 flex items-center gap-1.5 rounded-full border border-[#cdd9f0] bg-white px-4 py-2 text-[14px] text-[#2f63e6] transition active:scale-95"
            >
              <PlusIcon className="w-4" />
              New reward
            </button>
          </section>
        ) : (
          <>
            {/* ---- the gating concept, stated once ---- */}
            <section className="flex items-center gap-3 rounded-[22px] bg-[#e7f1fd] px-4 py-3 shadow-[0_8px_24px_rgba(120,150,200,0.16)]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/70">
                <GiftIcon className="w-5" color="#5181d4" />
              </span>
              <p className="text-[12px] leading-snug text-[#3a3a3a]">
                {readyCount > 0
                  ? `You’ve earned ${readyCount} reward${readyCount === 1 ? "" : "s"} — go claim ${readyCount === 1 ? "it" : "them"}! 🎉`
                  : "Do the task, then claim your reward. No task, no treat."}
              </p>
            </section>

            {/* ---- active rewards ---- */}
            <section className="rounded-[24px] bg-[#eaf2fd]/85 px-3.5 pb-3 pt-3 shadow-[0_10px_30px_rgba(120,150,200,0.18)] backdrop-blur-sm">
              <div className="mb-2.5 flex items-center justify-between px-1">
                <h2 className="text-[16px] text-[#2b2b2b]">To earn</h2>
                <NewRewardButton onClick={onNewReward} />
              </div>

              {active.length === 0 ? (
                <div className="rounded-[18px] bg-white px-4 py-5 text-center shadow-[0_6px_16px_rgba(120,150,200,0.12)]">
                  <p className="text-[12px] text-[#a9a9b0]">All caught up — every reward is claimed. Tap “New reward” to add one.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {active.map((r) => (
                    <RewardCard key={r.id} reward={r} onDetails={onDetails} />
                  ))}
                </div>
              )}
            </section>

            {/* ---- claimed ---- */}
            {claimed.length > 0 && (
              <section className="rounded-[24px] bg-[#eaf2fd]/85 px-3.5 pb-3 pt-3 shadow-[0_10px_30px_rgba(120,150,200,0.18)] backdrop-blur-sm">
                <h2 className="mb-2.5 px-1 text-[16px] text-[#2b2b2b]">Claimed 🎉</h2>
                <div className="flex flex-col gap-2">
                  {claimed.map((r) => (
                    <RewardCard key={r.id} reward={r} onDetails={onDetails} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <BottomNav tab="rewards" onHome={onHome} onGoals={onGoals} onAnalytics={onAnalytics} onRewards={() => {}} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reward modals                                                     */
/* ------------------------------------------------------------------ */

// Read-only detail sheet for one reward. The primary action follows the state:
// locked → mark the task done; ready → claim the reward; claimed → celebrate
// (with an escape hatch to un-claim). Edit / remove always available.
function RewardDetailModal({
  reward,
  onClose,
  onToggleDone,
  onToggleClaim,
  onEdit,
  onDelete,
}: {
  reward: Reward;
  onClose: () => void;
  onToggleDone: (done: boolean) => Promise<void> | void;
  onToggleClaim: (claimed: boolean) => Promise<void> | void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const status = rewardStatus(reward);
  const amount = rewardAmountLabel(reward);

  async function run(fn: () => Promise<void> | void) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
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
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">Reward</h2>

        {/* photo + title */}
        <div className="flex items-center gap-3">
          <RewardImage url={reward.image_url} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] leading-tight text-[#2b2b2b]">{reward.title}</p>
            <div className="mt-1 flex items-center gap-2">
              <StatusPill status={status} />
              {reward.person && (
                <span className="flex items-center gap-1 text-[11px] text-[#a9a9b0]">
                  <Avatar person={reward.person} size={16} />
                  {NAME[reward.person]}
                </span>
              )}
            </div>
          </div>
          {amount && <span className="shrink-0 text-[22px] text-[#2f63e6]">{amount}</span>}
        </div>

        {/* the task that gates it */}
        <div className="mt-3 rounded-[14px] bg-[#f7f8fb] px-3.5 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[#a9a9b0]">Task to unlock</p>
          <p className="mt-1 flex items-start gap-1.5 text-[14px] leading-snug text-[#2b2b2b]">
            <FlagIcon className="mt-0.5 w-4 shrink-0" color="#5181d4" />
            <span>{reward.task}</span>
          </p>
          {reward.done_at && (
            <p className="mt-2 text-[12px] text-[#1f9d63]">✓ Task done · {shortDate(reward.done_at)}</p>
          )}
        </div>

        {/* state-driven primary action */}
        {status === "locked" && (
          <button
            type="button"
            onClick={() => run(() => onToggleDone(true))}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[14px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[15px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99] disabled:opacity-50"
          >
            <CheckIcon className="w-[18px]" color="#ffffff" />
            Mark task complete
          </button>
        )}

        {status === "ready" && (
          <>
            <button
              type="button"
              onClick={() => run(() => onToggleClaim(true))}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[14px] bg-gradient-to-b from-[#46c088] to-[#23a86f] py-3 text-[16px] text-white shadow-[0_6px_14px_rgba(34,168,111,0.35)] transition active:scale-[0.99] disabled:opacity-50"
            >
              <GiftIcon className="w-5" color="#ffffff" />
              Claim reward 🎉
            </button>
            <button
              type="button"
              onClick={() => run(() => onToggleDone(false))}
              disabled={busy}
              className="mt-2 w-full rounded-[14px] bg-[#f1f2f6] py-2 text-[13px] text-[#8d8d93] transition active:scale-[0.99] disabled:opacity-50"
            >
              Task not done yet
            </button>
          </>
        )}

        {status === "claimed" && (
          <>
            <div className="mt-3 flex items-center justify-center gap-2 rounded-[14px] bg-[#e6f7ef] py-3 text-[15px] text-[#1f9d63]">
              <CheckIcon className="w-5" color="#1f9d63" />
              Claimed{reward.claimed_at ? ` on ${shortDate(reward.claimed_at)}` : ""} 🎉
            </div>
            <button
              type="button"
              onClick={() => run(() => onToggleClaim(false))}
              disabled={busy}
              className="mt-2 w-full rounded-[14px] bg-[#f1f2f6] py-2 text-[13px] text-[#8d8d93] transition active:scale-[0.99] disabled:opacity-50"
            >
              Un-claim
            </button>
          </>
        )}

        {/* edit / remove */}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-[#fdecec] py-2.5 text-[15px] text-[#d4453e] transition active:scale-[0.99]"
          >
            <TrashIcon className="w-[18px]" color="#d4453e" />
            Remove
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-[#f1f2f6] py-2.5 text-[15px] text-[#2b2b2b] transition active:scale-[0.99]"
          >
            <PencilIcon className="w-[18px]" color="#2b2b2b" />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

// New / edit reward sheet. Reward name + the task that gates it, a treat/cash
// toggle (cash reveals a dollar field), an optional photo, and who it's for.
function RewardFormModal({
  reward,
  onClose,
  onSave,
}: {
  reward?: Reward;
  onClose: () => void;
  onSave: (next: {
    title: string;
    task: string;
    kind: "treat" | "cash";
    amount: number | null;
    person: Person | null;
    image_url: string | null;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(reward?.title ?? "");
  const [task, setTask] = useState(reward?.task ?? "");
  const [kind, setKind] = useState<"treat" | "cash">(reward?.kind ?? "treat");
  const initialAmount = reward?.amount != null ? Number(reward.amount) : NaN;
  const [amount, setAmount] = useState(
    Number.isFinite(initialAmount) ? (Number.isInteger(initialAmount) ? String(initialAmount) : initialAmount.toFixed(2)) : "",
  );
  // "anyone" maps to a null person (a shared reward).
  const [who, setWho] = useState<"anyone" | Person>(reward?.person ?? "anyone");
  const [imageUrl, setImageUrl] = useState<string | null>(reward?.image_url ?? null);
  const [preview, setPreview] = useState<string | null>(reward?.image_url ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const amountValue = Number(amount);
  const amountOk = kind === "treat" || (Number.isFinite(amountValue) && amountValue > 0);
  const valid = title.trim() !== "" && task.trim() !== "" && amountOk;

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
      url = await uploadGoalImage(file); // reuses the public `goals` bucket
      if (!url) {
        setImgError("Couldn't upload that photo. Try another one.");
        setBusy(false);
        return;
      }
      setImageUrl(url);
    }

    const ok = await onSave({
      title: title.trim(),
      task: task.trim(),
      kind,
      amount: kind === "cash" ? amountValue : null,
      person: who === "anyone" ? null : who,
      image_url: url,
    });
    if (!ok) setBusy(false); // on success the modal unmounts; on failure, re-enable
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">
          {reward ? "Edit reward" : "New reward"}
        </h2>

        {/* photo picker */}
        <label className="mb-3 flex cursor-pointer items-center gap-3">
          <span className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[#fbeef6] ring-1 ring-[#f0d9e8]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <CameraIcon className="w-7" color="#d98bbd" />
            )}
          </span>
          <span className="text-[13px] text-[#2f63e6]">
            {preview ? "Change photo" : "Add a photo of the reward (optional)"}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {imgError && <p className="mb-2 text-[12px] text-[#d4453e]">{imgError}</p>}

        {/* reward name */}
        <div className="mb-2.5 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <GiftIcon className="w-4 shrink-0" color="#9a9aa0" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The reward (e.g. Lash extensions)"
            className="w-full bg-transparent text-[15px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
          />
        </div>

        {/* treat / cash toggle */}
        <div className="mb-2.5 flex overflow-hidden rounded-[14px] border border-[#e7e9ef]">
          {(["treat", "cash"] as const).map((k) => {
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
                {k === "treat" ? "A treat" : "Cash"}
              </button>
            );
          })}
        </div>

        {/* cash amount, only when kind === cash */}
        {kind === "cash" && (
          <div className="mb-2.5 flex items-center gap-1.5 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
            <span className="text-[18px] text-[#2b2b2b]">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="How much? (e.g. 5)"
              className="w-full bg-transparent text-[16px] text-[#2b2b2b] outline-none placeholder:text-[#c3c6ce]"
            />
          </div>
        )}

        {/* the gating task */}
        <div className="mb-2.5 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-[#e7e9ef]">
          <FlagIcon className="w-4 shrink-0" color="#9a9aa0" />
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What do you have to do for it?"
            className="w-full bg-transparent text-[14px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
          />
        </div>

        {/* who it's for */}
        <p className="mb-1.5 text-[12px] text-[#8d8d93]">Who&apos;s it for?</p>
        <div className="mb-3 flex gap-2">
          {(["anyone", "luca", "irish"] as const).map((opt) => {
            const active = who === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setWho(opt)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[14px] py-2 text-[14px] transition ${
                  active ? "border border-[#a3b8e6] bg-[#dbe3f6] text-[#2b2b2b]" : "border border-[#e7e9ef] text-[#8d8d93]"
                }`}
              >
                {opt !== "anyone" && <Avatar person={opt} size={22} />}
                {opt === "anyone" ? "Anyone" : NAME[opt]}
              </button>
            );
          })}
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
            {busy ? "Saving…" : reward ? "Save" : "Create reward"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteRewardModal({
  reward,
  onCancel,
  onConfirm,
}: {
  reward: Reward;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
        <h2 className="text-[16px] text-[#2b2b2b]">Remove reward?</h2>
        <p className="mt-1 text-[13px] text-[#8d8d93]">“{reward.title}”</p>
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
