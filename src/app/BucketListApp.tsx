"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, type BucketItem } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  Categories                                                        */
/* ------------------------------------------------------------------ */

// The shared set of life areas a bucket-list item can belong to. Each has an
// accent `color` (used for the active pill, the check ring/fill and chips) and
// a `soft` tint for chip/tile backgrounds. Order here is the order they appear.
type Category = {
  slug: string;
  label: string;
  emoji: string;
  color: string;
  soft: string;
};

const CATEGORIES: Category[] = [
  { slug: "travel", label: "Travel", emoji: "✈️", color: "#3b9ae1", soft: "#e7f2fc" },
  { slug: "movies", label: "Movies", emoji: "🎬", color: "#7c6cf0", soft: "#ecebfd" },
  { slug: "food", label: "Food", emoji: "🍜", color: "#f0883e", soft: "#fdeede" },
  { slug: "outdoor", label: "Outdoor", emoji: "🏔️", color: "#33a06c", soft: "#e3f5ec" },
  { slug: "sidequests", label: "Sidequests", emoji: "⚡", color: "#e0a528", soft: "#fbf2da" },
  { slug: "sports", label: "Sports", emoji: "🏀", color: "#e9605a", soft: "#fce9e8" },
  { slug: "music", label: "Music", emoji: "🎵", color: "#e060a8", soft: "#fce8f3" },
  { slug: "learn", label: "Learn", emoji: "📚", color: "#2baf9f", soft: "#ddf4f1" },
  { slug: "create", label: "Create", emoji: "🎨", color: "#b06bd6", soft: "#f5e9fb" },
];

const CAT_BY_SLUG: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
);
const FALLBACK_CAT = CATEGORIES.find((c) => c.slug === "sidequests")!;

function catOf(slug: string): Category {
  return CAT_BY_SLUG[slug] ?? FALLBACK_CAT;
}

/* ------------------------------------------------------------------ */
/*  Icons                                                             */
/* ------------------------------------------------------------------ */

function GridIcon({ className = "", color = "#2b2b2b" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {[
        [4, 4], [14, 4], [4, 14], [14, 14],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="6" height="6" rx="1.8" stroke={color} strokeWidth="2" />
      ))}
    </svg>
  );
}

function PlusIcon({ className = "", color = "#2f63e6" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className = "", color = "#fff" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5 12.5l4.3 4.3L19 7"
        stroke={color}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Confetti (pure CSS keyframes, see globals.css)                    */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = [
  "#6790dc", "#5181d4", "#5e8be8", "#f4abce", "#f3a6c9", "#d98bbd", "#22a86f", "#ffd166",
];
function Confetti({ count = 90, seed = 1 }: { count?: number; seed?: number }) {
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

/* ------------------------------------------------------------------ */
/*  Helpers + small building blocks                                   */
/* ------------------------------------------------------------------ */

// A featherweight haptic tap on supported devices (Android/Chrome). iOS Safari
// ignores it silently, so it's safe to fire on every toggle.
function haptic(ms = 8) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  }
}

// Upload a photo to the public `goals` bucket (reused for all uploads) and
// return its public URL, or null on failure.
async function uploadBucketImage(file: File): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `bucket-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("goals")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) return null;
  return supabase.storage.from("goals").getPublicUrl(path).data.publicUrl;
}

// A square visual for an item: its photo, or a category-tinted emoji tile so
// every item still reads as something at a glance.
function Thumb({ item, size, className = "" }: { item: BucketItem; size: number; className?: string }) {
  const cat = catOf(item.category);
  if (item.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.image_url}
        alt=""
        className={`shrink-0 rounded-[14px] object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[14px] ${className}`}
      style={{ width: size, height: size, backgroundColor: cat.soft, fontSize: size * 0.42 }}
    >
      {cat.emoji}
    </span>
  );
}

// The animated ring around the headline progress number.
function ProgressRing({
  pct,
  size = 84,
  stroke = 9,
  color = "#5181d4",
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f7" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1), stroke 0.4s ease" }}
      />
    </svg>
  );
}

// The round tap-target that checks an item off, with a springy pop on complete.
function CheckCircle({
  done,
  color,
  onToggle,
}: {
  done: boolean;
  color: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={done}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-90"
      style={done ? { backgroundColor: color } : { boxShadow: `inset 0 0 0 2px ${color}66` }}
    >
      {/* key flips on toggle so the pop animation replays each completion */}
      <span key={done ? "on" : "off"} className={done ? "animate-check-pop" : ""}>
        {done ? <CheckIcon className="w-[18px]" color="#fff" /> : null}
      </span>
    </button>
  );
}

// One bucket-list row.
function BucketCard({
  item,
  index,
  onTap,
  onToggle,
}: {
  item: BucketItem;
  index: number;
  onTap: (i: BucketItem) => void;
  onToggle: (i: BucketItem) => void;
}) {
  const cat = catOf(item.category);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTap(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap(item);
        }
      }}
      className={`animate-fade-up flex cursor-pointer items-start gap-3 rounded-[18px] bg-white p-3 shadow-[0_8px_22px_rgba(120,150,200,0.14)] transition active:scale-[0.99] ${
        item.done ? "opacity-75" : ""
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <CheckCircle done={item.done} color={cat.color} onToggle={() => onToggle(item)} />

      <div className="min-w-0 flex-1">
        <p
          className={`text-[15px] leading-snug ${
            item.done ? "text-[#a9b0bd] line-through" : "text-[#2b2b2b]"
          }`}
        >
          {item.title}
        </p>
        {item.note && (
          <p
            className={`mt-0.5 truncate text-[12px] ${
              item.done ? "text-[#bcc2cd]" : "text-[#8d8d93]"
            }`}
          >
            {item.note}
          </p>
        )}
        <span
          className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
          style={{ backgroundColor: cat.soft, color: cat.color }}
        >
          <span>{cat.emoji}</span>
          {cat.label}
        </span>
      </div>

      <Thumb item={item} size={52} />
    </div>
  );
}

// Horizontal filter chips. Only categories that actually have items show up, so
// the bar stays relevant and grows with the list.
function Pill({
  active,
  label,
  emoji,
  color,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  emoji: string;
  color: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] backdrop-blur transition active:scale-95"
      style={
        active
          ? { backgroundColor: color, color: "#fff", boxShadow: `0 6px 16px ${color}55` }
          : { backgroundColor: "rgba(255,255,255,0.82)", color: "#5a6678" }
      }
    >
      <span>{emoji}</span>
      <span className="whitespace-nowrap">{label}</span>
      {typeof count === "number" && count > 0 && (
        <span
          className="rounded-full px-1.5 text-[11px] leading-[18px]"
          style={
            active
              ? { backgroundColor: "rgba(255,255,255,0.28)", color: "#fff" }
              : { backgroundColor: "#eef1f7", color: "#7c879a" }
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-[18px] bg-white/70 p-3">
          <span className="h-8 w-8 shrink-0 rounded-full bg-[#e9edf4]" />
          <div className="flex-1">
            <span className="block h-3.5 w-1/2 rounded-full bg-[#e9edf4]" />
            <span className="mt-2 block h-3 w-1/4 rounded-full bg-[#eef1f7]" />
          </div>
          <span className="h-[52px] w-[52px] shrink-0 rounded-[14px] bg-[#eef1f7]" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="animate-fade-up mt-8 flex flex-col items-center px-6 text-center">
      <span className="grid h-[120px] w-[120px] place-items-center rounded-[28px] bg-white shadow-[0_14px_34px_rgba(120,150,200,0.22)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bucket.webp" alt="" className="h-[92px] w-[92px] object-contain" />
      </span>
      <h2 className="mt-5 font-daruma text-[22px] text-[#3a4a63]">Your bucket is empty</h2>
      <p className="mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-[#6b7688]">
        Add the first thing you two want to do — a movie, a trip, a little sidequest.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 flex items-center gap-2 rounded-full bg-gradient-to-b from-[#6790dc] to-[#5181d4] px-6 py-3 text-[15px] text-white shadow-[0_10px_24px_rgba(81,129,212,0.4)] transition active:scale-95"
      >
        <PlusIcon className="w-5" color="#fff" />
        Add your first dream
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen                                                            */
/* ------------------------------------------------------------------ */

export default function BucketListApp({ onExit }: { onExit: () => void }) {
  const [items, setItems] = useState<BucketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<string>("all"); // "all" | category slug
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BucketItem | null>(null);
  const [selected, setSelected] = useState<BucketItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BucketItem | null>(null);

  // Confetti burst: bumping the key forces a fresh fall even on rapid re-fire.
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [burstBig, setBurstBig] = useState(false);
  const confettiTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("bucket_items")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else {
      setError(null);
      setItems((data ?? []) as BucketItem[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // It's a shared two-person list, so re-sync whenever the app comes back into
  // focus — the other person may have ticked something off in the meantime.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    return () => {
      if (confettiTimer.current) window.clearTimeout(confettiTimer.current);
    };
  }, []);

  function fireConfetti(big: boolean) {
    setBurstBig(big);
    setCelebrateKey((k) => k + 1);
    setCelebrate(true);
    if (confettiTimer.current) window.clearTimeout(confettiTimer.current);
    confettiTimer.current = window.setTimeout(() => setCelebrate(false), big ? 5200 : 3600);
  }

  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((i) => i.done).length;
    return { total, done, pct: total ? done / total : 0 };
  }, [items]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.category] = (m[it.category] ?? 0) + 1;
    return m;
  }, [items]);

  // Categories present in the list, in canonical order.
  const presentCats = useMemo(
    () => CATEGORIES.filter((c) => counts[c.slug] > 0),
    [counts],
  );

  // The active filter, defended against pointing at a category that no longer
  // has any items (so the view never strands on an empty, pill-less category).
  const activeFilter = filter !== "all" && !counts[filter] ? "all" : filter;

  // The filtered list, split into to-do (newest first) and done (recently
  // completed first) so finished dreams settle to the bottom.
  const visible = useMemo(() => {
    const f = activeFilter === "all" ? items : items.filter((i) => i.category === activeFilter);
    const todo = f
      .filter((i) => !i.done)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const done = f
      .filter((i) => i.done)
      .sort((a, b) => ((a.done_at ?? "") < (b.done_at ?? "") ? 1 : -1));
    return { todo, done };
  }, [items, activeFilter]);

  const encouragement = useMemo(() => {
    const { total, done, pct } = stats;
    if (total === 0) return "Start your list below";
    if (pct >= 1) return "Every dream checked off! 🎉";
    if (done === 0) return "Tap a circle to check one off";
    const left = total - done;
    if (pct >= 0.5) return `Over halfway — ${left} to go!`;
    return `${left} ${left === 1 ? "dream" : "dreams"} to go`;
  }, [stats]);

  async function toggleDone(item: BucketItem) {
    const next = !item.done;
    const done_at = next ? new Date().toISOString() : null;
    haptic(next ? 11 : 6);

    // Optimistic: reflect instantly, then persist.
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, done: next, done_at } : it)),
    );
    setSelected(null);

    if (next) {
      const doneAfter = items.filter((i) => i.done).length + 1;
      fireConfetti(doneAfter === items.length); // bigger burst when the list is fully done
    }

    const { error } = await supabase
      .from("bucket_items")
      .update({ done: next, done_at })
      .eq("id", item.id);
    if (error) {
      setError(error.message);
      load(); // resync on failure
    }
  }

  async function createItem(next: {
    title: string;
    note: string | null;
    category: string;
    image_url: string | null;
  }): Promise<boolean> {
    const { error } = await supabase.from("bucket_items").insert({
      title: next.title,
      note: next.note,
      category: next.category,
      image_url: next.image_url,
      done: false,
    });
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    setFormOpen(false);
    // Surface the new item even if it lands in a hidden category.
    if (filter !== "all" && filter !== next.category) setFilter("all");
    load();
    return true;
  }

  async function saveEdit(
    item: BucketItem,
    next: { title: string; note: string | null; category: string; image_url: string | null },
  ): Promise<boolean> {
    const { error } = await supabase
      .from("bucket_items")
      .update({
        title: next.title,
        note: next.note,
        category: next.category,
        image_url: next.image_url,
      })
      .eq("id", item.id);
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    setEditing(null);
    load();
    return true;
  }

  async function remove(item: BucketItem) {
    const { error } = await supabase.from("bucket_items").delete().eq("id", item.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setPendingDelete(null);
    load();
  }

  const ringColor = stats.pct >= 1 ? "#33a06c" : "#5181d4";
  const empty = !loading && items.length === 0;

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-3.5 px-4 pb-32 pt-[max(env(safe-area-inset-top),14px)]">
        {/* ---- header ---- */}
        <div className="relative flex items-center justify-center py-1.5">
          <button
            type="button"
            onClick={onExit}
            aria-label="Back to apps"
            className="absolute left-0 flex items-center gap-1 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-[#2b2b2b] shadow-[0_4px_12px_rgba(120,150,200,0.18)] backdrop-blur transition active:scale-95"
          >
            <GridIcon className="w-4" />
            Apps
          </button>
          <div className="text-center">
            <h1 className="font-daruma text-[26px] leading-none text-[#3a4a63] drop-shadow-[0_2px_3px_rgba(255,255,255,0.7)]">
              Bucket List
            </h1>
          </div>
        </div>

        {error && <p className="text-center text-[12px] text-[#d4453e]">{error}</p>}

        {/* ---- progress hero ---- */}
        {!empty && (
          <section className="animate-fade-up flex items-center gap-4 rounded-[24px] bg-white p-4 shadow-[0_12px_34px_rgba(120,150,200,0.2)]">
            <div className="relative grid place-items-center">
              <ProgressRing pct={loading ? 0 : stats.pct} color={ringColor} />
              <div className="absolute text-center leading-none">
                <div className="font-daruma text-[22px] text-[#3a4a63]">
                  {Math.round(stats.pct * 100)}
                  <span className="text-[13px]">%</span>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-daruma text-[28px] leading-none text-[#3a4a63]">
                {stats.done}
                <span className="text-[18px] text-[#9aa6b8]"> / {stats.total}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-[#6b7688]">{encouragement}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bucket.webp"
              alt=""
              className="h-12 w-12 shrink-0 object-contain opacity-90 drop-shadow-[0_4px_8px_rgba(120,150,200,0.25)]"
            />
          </section>
        )}

        {/* ---- category filter ---- */}
        {!empty && presentCats.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Pill
              active={activeFilter === "all"}
              label="All"
              emoji="✨"
              color="#5181d4"
              count={stats.total}
              onClick={() => setFilter("all")}
            />
            {presentCats.map((c) => (
              <Pill
                key={c.slug}
                active={activeFilter === c.slug}
                label={c.label}
                emoji={c.emoji}
                color={c.color}
                count={counts[c.slug]}
                onClick={() => setFilter(c.slug)}
              />
            ))}
          </div>
        )}

        {/* ---- list ---- */}
        {loading ? (
          <Skeletons />
        ) : empty ? (
          <EmptyState onAdd={() => setFormOpen(true)} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {visible.todo.map((it, i) => (
              <BucketCard key={it.id} item={it} index={i} onTap={setSelected} onToggle={toggleDone} />
            ))}

            {visible.done.length > 0 && (
              <div className="mt-1 mb-0.5 flex items-center gap-2 px-1">
                <span className="h-px flex-1 bg-[#cfd9ea]" />
                <span className="text-[11px] text-[#8a96a9]">
                  Done · {visible.done.length}
                </span>
                <span className="h-px flex-1 bg-[#cfd9ea]" />
              </div>
            )}

            {visible.done.map((it, i) => (
              <BucketCard
                key={it.id}
                item={it}
                index={visible.todo.length + i}
                onTap={setSelected}
                onToggle={toggleDone}
              />
            ))}

            {visible.todo.length === 0 && visible.done.length === 0 && (
              <p className="py-8 text-center text-[12px] text-[#8a96a9]">
                Nothing here yet in this category.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---- floating add button (centered within the column) ---- */}
      {!empty && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[420px] justify-center px-4 pb-[max(env(safe-area-inset-bottom),18px)]">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-gradient-to-b from-[#6790dc] to-[#5181d4] px-6 py-3.5 text-[15px] text-white shadow-[0_12px_28px_rgba(81,129,212,0.45)] transition active:scale-95"
          >
            <PlusIcon className="w-5" color="#fff" />
            Add to bucket
          </button>
        </div>
      )}

      {/* ---- modals ---- */}
      {selected && (
        <ActionSheet
          item={selected}
          onClose={() => setSelected(null)}
          onToggle={() => toggleDone(selected)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onDelete={() => {
            setPendingDelete(selected);
            setSelected(null);
          }}
        />
      )}
      {formOpen && <ItemFormModal onClose={() => setFormOpen(false)} onSave={createItem} />}
      {editing && (
        <ItemFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => saveEdit(editing, next)}
        />
      )}
      {pendingDelete && (
        <ConfirmDeleteModal
          item={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove(pendingDelete)}
        />
      )}

      {celebrate && <Confetti key={celebrateKey} count={burstBig ? 150 : 80} seed={celebrateKey} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modals                                                            */
/* ------------------------------------------------------------------ */

// Tap an item → check it off, edit it, or remove it; the full note shows here.
function ActionSheet({
  item,
  onClose,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: BucketItem;
  onClose: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const cat = catOf(item.category);
  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-sheet-up w-full max-w-[420px] rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <Thumb item={item} size={52} />
          <div className="min-w-0 flex-1">
            <p
              className={`text-[16px] leading-snug ${
                item.done ? "text-[#a9b0bd] line-through" : "text-[#2b2b2b]"
              }`}
            >
              {item.title}
            </p>
            <span
              className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              style={{ backgroundColor: cat.soft, color: cat.color }}
            >
              <span>{cat.emoji}</span>
              {cat.label}
            </span>
          </div>
        </div>

        {item.note && (
          <p className="mb-3 rounded-[14px] bg-[#f6f7fa] px-3 py-2.5 text-[13px] leading-relaxed text-[#5a6678]">
            {item.note}
          </p>
        )}

        <button
          type="button"
          onClick={onToggle}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-[16px] py-3 text-[15px] transition active:scale-[0.99]"
          style={
            item.done
              ? { backgroundColor: "#f1f2f6", color: "#5a6678" }
              : { backgroundColor: cat.color, color: "#fff", boxShadow: `0 8px 20px ${cat.color}55` }
          }
        >
          {item.done ? (
            "Move back to to-do"
          ) : (
            <>
              <CheckIcon className="w-[18px]" color="#fff" />
              Mark as done
            </>
          )}
        </button>

        <div className="flex gap-2">
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

// New / edit an item: a title, optional note + photo, and a category.
function ItemFormModal({
  item,
  onClose,
  onSave,
}: {
  item?: BucketItem;
  onClose: () => void;
  onSave: (next: {
    title: string;
    note: string | null;
    category: string;
    image_url: string | null;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [category, setCategory] = useState(item?.category ?? "sidequests");
  const [imageUrl, setImageUrl] = useState<string | null>(item?.image_url ?? null);
  const [preview, setPreview] = useState<string | null>(item?.image_url ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const valid = title.trim() !== "";
  const activeCat = catOf(category);

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
      url = await uploadBucketImage(file);
      if (!url) {
        setImgError("Couldn't upload that photo. Try another one.");
        setBusy(false);
        return;
      }
      setImageUrl(url);
    }

    const ok = await onSave({
      title: title.trim(),
      note: note.trim() || null,
      category,
      image_url: url,
    });
    if (!ok) setBusy(false);
  }

  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-4 pb-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-sheet-up max-h-[88vh] w-full max-w-[420px] overflow-y-auto rounded-[22px] bg-white p-4 shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">
          {item ? "Edit dream" : "Add to bucket"}
        </h2>

        <label className="mb-3 flex cursor-pointer items-center gap-3">
          <span
            className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[16px]"
            style={{ backgroundColor: activeCat.soft }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <CameraIcon className="w-7" color={activeCat.color} />
            )}
          </span>
          <span className="text-[13px] text-[#2f63e6]">
            {preview ? "Change photo" : "Add a photo (optional)"}
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
          placeholder="What do you want to do?"
          className="mb-2.5 w-full rounded-[14px] bg-white px-3 py-2.5 text-[15px] text-[#2b2b2b] outline-none ring-1 ring-[#e7e9ef] placeholder:text-[#aeb1b9]"
        />

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          rows={2}
          className="mb-3 w-full resize-none rounded-[14px] bg-white px-3 py-2.5 text-[14px] text-[#2b2b2b] outline-none ring-1 ring-[#e7e9ef] placeholder:text-[#aeb1b9]"
        />

        <p className="mb-1.5 text-[12px] text-[#8d8d93]">Category</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const active = category === c.slug;
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => setCategory(c.slug)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition active:scale-95"
                style={
                  active
                    ? { backgroundColor: c.color, color: "#fff", boxShadow: `0 5px 14px ${c.color}55` }
                    : { backgroundColor: c.soft, color: c.color }
                }
              >
                <span>{c.emoji}</span>
                {c.label}
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
            {busy ? "Saving…" : item ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  item,
  onCancel,
  onConfirm,
}: {
  item: BucketItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-6 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="animate-pop-in w-full max-w-[320px] rounded-[22px] bg-white p-5 text-center shadow-[0_12px_40px_rgba(60,90,150,0.3)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#fdecec]">
          <TrashIcon className="w-6" color="#d4453e" />
        </span>
        <h2 className="text-[16px] text-[#2b2b2b]">Remove this?</h2>
        <p className="mt-1 text-[13px] text-[#8d8d93]">“{item.title}”</p>
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
