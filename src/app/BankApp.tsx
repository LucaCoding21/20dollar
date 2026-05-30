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

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  coffee: ["coffee", "latte", "espresso", "cafe", "café", "tea", "starbucks"],
  food: ["food", "snack", "snacks", "lunch", "dinner", "breakfast", "eat", "restaurant", "meal", "pizza", "burger", "sushi"],
  groceries: ["grocer", "groceries", "market", "supermarket", "safeway"],
  transport: ["bus", "train", "uber", "lyft", "taxi", "transit", "fare", "gas", "fuel", "skytrain", "parking"],
  fun: ["movie", "game", "fun", "party", "concert", "netflix", "spotify"],
  clothes: ["clothes", "clothing", "shirt", "shoes", "jacket", "pants", "dress"],
  gifts: ["gift", "present", "birthday"],
  bills: ["bill", "rent", "subscription", "phone", "internet", "hydro"],
  health: ["health", "doctor", "pharmacy", "medicine", "gym", "dentist"],
  shopping: ["shop", "shopping", "store", "amazon"],
};

function inferCategory(note: string): string | null {
  const text = note.toLowerCase();
  for (const slug of CATEGORY_SLUGS) {
    if (CATEGORY_KEYWORDS[slug].some((kw) => text.includes(kw))) return slug;
  }
  return null;
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

function CloudIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" fill="none" className={className}>
      <path
        d="M13 26h21c5 0 8-3.4 8-7.6 0-4-3-7.2-7.2-7.4C33.6 6.2 29.6 3 24.6 3c-4.4 0-8.1 2.6-9.6 6.4-.5-.1-1-.2-1.6-.2C8.3 9.2 5 12.6 5 17s3.6 9 8 9Z"
        stroke="#9bb7da"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <path
        d="M27 6c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z"
        fill="#7da4e8"
      />
      <path
        d="M13 19c.4 3.6 1.7 4.9 5.3 5.3-3.6.4-4.9 1.7-5.3 5.3-.4-3.6-1.7-4.9-5.3-5.3C11.3 23.9 12.6 22.6 13 19Z"
        fill="#9cbcf0"
      />
    </svg>
  );
}

function BankBuildingIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 56" fill="none" className={className}>
      <path d="M30 4l1 5" stroke="#4a4a4a" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M30 8.5c1.8-1.6 4.6-1.6 6.4 0 1.7 1.6 1.7 4.2 0 5.8L33 17.5 29.6 14.3c-1.7-1.6-1.7-4.2 0-5.8.1 0 .3-.1.4 0Z"
        stroke="#4a4a4a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 24 32 13l24 11" stroke="#4a4a4a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M12 24v18M22 24v18M42 24v18M52 24v18M32 24v18" stroke="#4a4a4a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7 44h50" stroke="#4a4a4a" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M4 50h56" stroke="#4a4a4a" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

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

function SpinnerIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3.5 13h4.5" stroke="rgba(255,255,255,0.92)" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M5 7l3.3 2.6" stroke="rgba(255,255,255,0.92)" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M6 19l3-3.4" stroke="rgba(255,255,255,0.92)" strokeWidth="2.1" strokeLinecap="round" />
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

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-20 pt-[max(env(safe-area-inset-top),14px)]">
        {/* ---- Shared Bank card ---- */}
        <section className="relative overflow-hidden rounded-[22px] bg-[#e7f1fd] px-5 pt-3.5 pb-4 shadow-[0_8px_24px_rgba(120,150,200,0.18)]">
          <CloudIcon className="absolute left-4 top-3.5 w-7" />
          <SparkleIcon className="absolute right-4 top-3 w-6" />
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
          <BankBuildingIcon className="absolute bottom-3 right-4 w-9" />
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
            <SpinnerIcon className={`w-4 ${saving ? "animate-spin" : ""}`} />
          </button>
          {error && (
            <p className="mt-2.5 text-center text-[12px] text-[#d4453e]">{error}</p>
          )}
        </section>

        {/* ---- Recent activity ---- */}
        <section className="rounded-[22px] bg-white px-4 pt-3 pb-1.5 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-0.5 flex items-center justify-between">
            <h2 className="text-[16px] text-[#2b2b2b]">Recent activity</h2>
            <button type="button" className="text-[13px] text-[#2f63e6]">
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
