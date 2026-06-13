"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type FoodItem, type FoodTier } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  Tiers                                                             */
/* ------------------------------------------------------------------ */

// S/A/B/C/D with softened, pastel-leaning versions of the classic tier colors
// so they sit comfortably next to the rest of the suite's look.
const TIERS: { key: FoodTier; bg: string }[] = [
  { key: "S", bg: "#ef8f8f" },
  { key: "A", bg: "#f4b27a" },
  { key: "B", bg: "#efd47a" },
  { key: "C", bg: "#a9d98e" },
  { key: "D", bg: "#8fb8e8" },
];

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
/*  Helpers + small building blocks                                   */
/* ------------------------------------------------------------------ */

// Upload a food photo to the public `goals` bucket (reused for all uploads) and
// return its public URL, or null on failure.
async function uploadFoodImage(file: File): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `food-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("goals")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) return null;
  return supabase.storage.from("goals").getPublicUrl(path).data.publicUrl;
}

// A food's photo (square crop), falling back to a plate emoji tile.
function FoodImage({ url, size, className = "" }: { url: string | null; size: number; className?: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className={`shrink-0 rounded-[12px] object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[12px] bg-[#fff1e6] ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      🍽️
    </span>
  );
}

// A draggable-feeling food tile: photo + name, tap to open its action sheet.
function FoodChip({ item, onTap }: { item: FoodItem; onTap: (i: FoodItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTap(item)}
      className="flex w-[60px] flex-col items-center gap-1 transition active:scale-95"
    >
      <FoodImage url={item.image_url} size={54} />
      <span className="w-full truncate text-center text-[10px] leading-tight text-[#2b2b2b]">
        {item.name}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen                                                            */
/* ------------------------------------------------------------------ */

export default function FoodTierApp({ onExit }: { onExit: () => void }) {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FoodItem | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("food_items")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else {
      setError(null);
      setItems((data ?? []) as FoodItem[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byTier = useMemo(() => {
    const map: Record<string, FoodItem[]> = { S: [], A: [], B: [], C: [], D: [], unranked: [] };
    for (const it of items) map[it.tier ?? "unranked"].push(it);
    return map;
  }, [items]);

  async function createFood(next: { name: string; image_url: string | null }): Promise<boolean> {
    const { error } = await supabase
      .from("food_items")
      .insert({ name: next.name, image_url: next.image_url, tier: null });
    if (error) {
      setError(error.message);
      return false;
    }
    setError(null);
    setFormOpen(false);
    load();
    return true;
  }

  async function saveEdit(item: FoodItem, next: { name: string; image_url: string | null }): Promise<boolean> {
    const { error } = await supabase
      .from("food_items")
      .update({ name: next.name, image_url: next.image_url })
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

  // Move a food into a tier (or back to unranked when tier is null).
  async function move(item: FoodItem, tier: FoodTier | null) {
    // Optimistic: reflect the move immediately, then persist.
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, tier } : it)));
    setSelected(null);
    const { error } = await supabase.from("food_items").update({ tier }).eq("id", item.id);
    if (error) {
      setError(error.message);
      load(); // resync on failure
    }
  }

  async function remove(item: FoodItem) {
    const { error } = await supabase.from("food_items").delete().eq("id", item.id);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setPendingDelete(null);
    load();
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col">
      <div className="flex flex-1 flex-col gap-3 px-4 pb-10 pt-[max(env(safe-area-inset-top),14px)]">
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
          <h1 className="font-daruma text-[26px] leading-none text-[#3a4a63] drop-shadow-[0_2px_3px_rgba(255,255,255,0.7)]">
            Food Tiers
          </h1>
        </div>

        {error && <p className="text-center text-[12px] text-[#d4453e]">{error}</p>}

        {/* ---- tier rows ---- */}
        <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_10px_30px_rgba(120,150,200,0.18)]">
          {TIERS.map((t) => (
            <div key={t.key} className="flex items-stretch border-b border-[#f0f0f2] last:border-b-0">
              <div
                className="flex w-14 shrink-0 items-center justify-center"
                style={{ backgroundColor: t.bg }}
              >
                <span className="font-daruma text-[26px] leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
                  {t.key}
                </span>
              </div>
              <div className="flex min-h-[72px] flex-1 flex-wrap content-start gap-2 p-2.5">
                {byTier[t.key].length === 0 ? (
                  <span className="self-center text-[11px] text-[#c2c2c8]">—</span>
                ) : (
                  byTier[t.key].map((it) => <FoodChip key={it.id} item={it} onTap={setSelected} />)
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ---- unranked tray ---- */}
        <section className="rounded-[20px] bg-[#eaf2fd]/85 px-3.5 pb-3 pt-3 shadow-[0_10px_30px_rgba(120,150,200,0.18)] backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[15px] text-[#2b2b2b]">Not ranked yet</h2>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-1 rounded-full border border-[#cdd9f0] bg-white px-3 py-1.5 text-[13px] text-[#2f63e6] transition active:scale-95"
            >
              <PlusIcon className="w-3.5" />
              Add food
            </button>
          </div>

          <div className="min-h-[70px] rounded-[16px] bg-white p-2.5 shadow-[0_6px_16px_rgba(120,150,200,0.12)]">
            {loading ? null : byTier.unranked.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-[#a9a9b0]">
                {items.length === 0
                  ? "Add a food, then sort it into a tier."
                  : "Everything's been ranked! 🎉"}
              </p>
            ) : (
              <div className="flex flex-wrap content-start gap-2">
                {byTier.unranked.map((it) => (
                  <FoodChip key={it.id} item={it} onTap={setSelected} />
                ))}
              </div>
            )}
          </div>
        </section>

        <p className="px-2 text-center text-[11px] text-[#5a6678] drop-shadow-[0_1px_2px_rgba(255,255,255,0.6)]">
          Tap a food to give it a tier, edit, or remove it.
        </p>
      </div>

      {/* ---- modals ---- */}
      {selected && (
        <FoodActionSheet
          item={selected}
          onClose={() => setSelected(null)}
          onMove={(tier) => move(selected, tier)}
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
      {formOpen && <FoodFormModal onClose={() => setFormOpen(false)} onSave={createFood} />}
      {editing && (
        <FoodFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => saveEdit(editing, next)}
        />
      )}
      {pendingDelete && (
        <ConfirmDeleteFoodModal
          item={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove(pendingDelete)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modals                                                            */
/* ------------------------------------------------------------------ */

// Tap a food → pick its tier (instant), or edit / remove it.
function FoodActionSheet({
  item,
  onClose,
  onMove,
  onEdit,
  onDelete,
}: {
  item: FoodItem;
  onClose: () => void;
  onMove: (tier: FoodTier | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
          <FoodImage url={item.image_url} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] text-[#2b2b2b]">{item.name}</p>
            <p className="text-[12px] text-[#8d8d93]">
              {item.tier ? `Currently in ${item.tier} tier` : "Not ranked yet"}
            </p>
          </div>
        </div>

        <p className="mb-1.5 text-[12px] text-[#8d8d93]">Move to</p>
        <div className="flex gap-2">
          {TIERS.map((t) => {
            const active = item.tier === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onMove(t.key)}
                className={`flex h-11 flex-1 items-center justify-center rounded-[14px] font-daruma text-[22px] leading-none text-white transition active:scale-95 ${
                  active ? "ring-2 ring-[#2b2b2b] ring-offset-1" : ""
                }`}
                style={{ backgroundColor: t.bg }}
              >
                {t.key}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onMove(null)}
          disabled={item.tier === null}
          className="mt-2 w-full rounded-[14px] bg-[#f1f2f6] py-2 text-[13px] text-[#8d8d93] transition active:scale-[0.99] disabled:opacity-50"
        >
          Back to unranked
        </button>

        <div className="mt-3 flex gap-2">
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

// New / edit a food: a name and an optional photo.
function FoodFormModal({
  item,
  onClose,
  onSave,
}: {
  item?: FoodItem;
  onClose: () => void;
  onSave: (next: { name: string; image_url: string | null }) => Promise<boolean>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(item?.image_url ?? null);
  const [preview, setPreview] = useState<string | null>(item?.image_url ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const valid = name.trim() !== "";

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
      url = await uploadFoodImage(file);
      if (!url) {
        setImgError("Couldn't upload that photo. Try another one.");
        setBusy(false);
        return;
      }
      setImageUrl(url);
    }

    const ok = await onSave({ name: name.trim(), image_url: url });
    if (!ok) setBusy(false);
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
        <h2 className="mb-3 text-center text-[16px] text-[#2b2b2b]">{item ? "Edit food" : "Add food"}</h2>

        <label className="mb-3 flex cursor-pointer items-center gap-3">
          <span className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[#fff1e6] ring-1 ring-[#f0dccb]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <CameraIcon className="w-7" color="#e0a06b" />
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Food name (e.g. Sushi)"
          className="mb-3 w-full rounded-[14px] bg-white px-3 py-2.5 text-[15px] text-[#2b2b2b] outline-none ring-1 ring-[#e7e9ef] placeholder:text-[#aeb1b9]"
        />

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
            {busy ? "Saving…" : item ? "Save" : "Add food"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteFoodModal({
  item,
  onCancel,
  onConfirm,
}: {
  item: FoodItem;
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
        <h2 className="text-[16px] text-[#2b2b2b]">Remove food?</h2>
        <p className="mt-1 text-[13px] text-[#8d8d93]">“{item.name}”</p>
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
