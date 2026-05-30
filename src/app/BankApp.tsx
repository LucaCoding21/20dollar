"use client";

import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Data (matches the reference mockup 1:1)                            */
/* ------------------------------------------------------------------ */

type Person = "luca" | "irish";

const AVATAR: Record<Person, string> = {
  luca: "/assetsforai(renameme)/luca.png",
  irish: "/assetsforai(renameme)/irish.png",
};

// Both faces are tight head-only crops in the same style, so they read
// at the same size with no per-person correction.
const AVATAR_SCALE: Record<Person, number> = { luca: 1, irish: 1 };

const NAME: Record<Person, string> = { luca: "Luca", irish: "Irish" };

type Txn = {
  person: Person;
  label: string;
  when: string;
  amount: number; // negative = spent, positive = added back
  icon: string; // /categories/*.png  OR  "heart"
};

const RECENT: Txn[] = [
  { person: "luca", label: "Coffee", when: "Today · 9:12 AM", amount: -6, icon: "/categories/coffee.png" },
  { person: "irish", label: "Snacks", when: "Yesterday · 6:47 PM", amount: -12, icon: "/categories/food.png" },
  { person: "irish", label: "Paid back", when: "Yesterday · 2:15 PM", amount: 10, icon: "heart" },
  { person: "luca", label: "Bus fare", when: "May 10 · 8:21 AM", amount: -3, icon: "/categories/transport.png" },
];

const BALANCE = 184;

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

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
      <div className="flex flex-1 flex-col gap-3.5 px-4 pb-28 pt-[max(env(safe-area-inset-top),20px)]">
        {/* ---- Shared Bank card ---- */}
        <section className="relative overflow-hidden rounded-[26px] bg-[#e7f1fd] px-6 pt-5 pb-6 shadow-[0_8px_24px_rgba(120,150,200,0.18)]">
          <CloudIcon className="absolute left-5 top-5 w-9" />
          <SparkleIcon className="absolute right-5 top-4 w-8" />
          <p className="text-center text-[19px] text-[#3a3a3a]">Shared Bank</p>
          <p className="mt-1 text-center text-[68px] leading-none text-black">${BALANCE}</p>
          <p className="mt-3 text-center text-[13px] text-[#8d8d93]">
            <span className="text-[#2f63e6]">+ ${20}</span> every midnight (Vancouver time)
          </p>
          <BankBuildingIcon className="absolute bottom-4 right-5 w-12" />
        </section>

        {/* ---- person chips ---- */}
        <div className="flex justify-center gap-5">
          <PersonChip person="luca" heartColor="#2f63e6" />
          <PersonChip person="irish" heartColor="#f3a6c9" />
        </div>

        {/* ---- Add a transaction ---- */}
        <section className="relative rounded-[26px] bg-white px-5 pt-5 pb-5 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[19px] text-[#2b2b2b]">Add a transaction</h2>
            <PenDoodle className="w-11 opacity-90" />
          </div>

          <div className="mb-3 flex items-stretch gap-2.5">
            {/* amount */}
            <div className="flex flex-1 items-center gap-2 rounded-[16px] bg-white px-4 py-3 ring-1 ring-[#e7e9ef]">
              <span className="text-[22px] text-[#2b2b2b]">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-[22px] text-[#2b2b2b] outline-none placeholder:text-[#c3c6ce]"
              />
            </div>
            {/* person toggle */}
            <div className="flex items-stretch overflow-hidden rounded-[16px] border border-[#e7e9ef]">
              {(["luca", "irish"] as Person[]).map((p) => {
                const active = who === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setWho(p)}
                    className={`flex items-center gap-1 rounded-[16px] py-1.5 pl-1.5 pr-3 transition ${
                      active ? "border border-[#a3b8e6] bg-[#dbe3f6]" : "border border-transparent"
                    }`}
                  >
                    <Avatar person={p} size={30} />
                    <span className="text-[15px] text-[#2b2b2b]">{NAME[p]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* note */}
          <div className="mb-4 flex items-center gap-2.5 rounded-[16px] bg-white px-4 py-3 ring-1 ring-[#e7e9ef]">
            <ChatIcon className="w-5 shrink-0" />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was it for?"
              className="w-full bg-transparent text-[15px] text-[#2b2b2b] outline-none placeholder:text-[#aeb1b9]"
            />
          </div>

          {/* submit */}
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-gradient-to-b from-[#6790dc] to-[#5181d4] py-2.5 text-[17px] text-white shadow-[0_6px_14px_rgba(88,136,216,0.35)] transition active:scale-[0.99]"
          >
            Add transaction
            <SpinnerIcon className="w-4" />
          </button>
        </section>

        {/* ---- Recent activity ---- */}
        <section className="rounded-[26px] bg-white px-5 pt-4 pb-2 shadow-[0_8px_24px_rgba(120,150,200,0.14)]">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[19px] text-[#2b2b2b]">Recent activity</h2>
            <button type="button" className="text-[14px] text-[#2f63e6]">
              View all
            </button>
          </div>
          <ul>
            {RECENT.map((t, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 py-3 ${
                  i !== RECENT.length - 1 ? "border-b border-[#f0f0f2]" : ""
                }`}
              >
                <Avatar person={t.person} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] leading-tight text-[#2b2b2b]">
                    {NAME[t.person]} <span className="mx-1 text-[#c2c2c8]">·</span> {t.label}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[#a9a9b0]">{t.when}</p>
                </div>
                <span
                  className={`text-[16px] ${t.amount < 0 ? "text-[#2b2b2b]" : "text-[#18953f]"}`}
                >
                  {t.amount < 0 ? "-" : "+"}${Math.abs(t.amount)}
                </span>
                <span className="flex w-7 shrink-0 justify-center">
                  {t.icon === "heart" ? (
                    <HeartIcon className="w-6" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.icon} alt="" className="h-6 w-6 object-contain" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ---- bottom nav ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto max-w-[440px] px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-1">
          <div className="flex items-center justify-around rounded-[26px] bg-white/95 py-2.5 shadow-[0_-2px_20px_rgba(120,150,200,0.18)] backdrop-blur">
            <NavItem label="Home" active icon={<HomeIcon className="w-6" color="#2f63e6" />} />
            <NavItem label="Analytics" icon={<BarsIcon className="w-6" />} />
            <NavItem label="Goals" icon={<StarIcon className="w-6" />} />
            <NavItem label="Settings" icon={<GearIcon className="w-6" />} />
          </div>
        </div>
      </nav>
    </div>
  );
}

function PersonChip({ person, heartColor }: { person: Person; heartColor: string }) {
  return (
    <div className="flex flex-1 max-w-[180px] items-center justify-center gap-2.5 rounded-[30px] bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(120,150,200,0.14)]">
      <Avatar person={person} size={62} />
      <div className="flex flex-col items-start">
        <span className="text-[20px] leading-none text-[#2b2b2b]">{NAME[person]}</span>
        <HeartIcon className="mt-2 w-5" color={heartColor} />
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
