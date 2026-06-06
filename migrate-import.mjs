// One-off: load ./migration-snapshot/ into the NEW Supabase project.
// Run AFTER you've created the new project and run supabase-setup.sql there
// (so the tables, policies, and `goals` bucket exist).
//
//   NEW_SUPABASE_URL=https://xxxx.supabase.co \
//   NEW_SUPABASE_ANON_KEY=eyJ... \
//   node migrate-import.mjs
//
// Idempotent-ish: rows are upserted by id; photos are upserted by name.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";

const url = process.env.NEW_SUPABASE_URL?.trim();
const anonKey = process.env.NEW_SUPABASE_ANON_KEY?.trim();
if (!url || !anonKey) {
  console.error("Need NEW_SUPABASE_URL and NEW_SUPABASE_ANON_KEY in the environment.");
  process.exit(1);
}

const newRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const supabase = createClient(url, anonKey);
const snap = new URL("migration-snapshot/", import.meta.url);

const CONTENT_TYPES = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

// --- 1. photos: upload to the new goals bucket (same filenames) ---
const bucketDir = new URL("goals-bucket/", snap);
let uploaded = 0;
for (const name of readdirSync(bucketDir)) {
  const buf = readFileSync(new URL(name, bucketDir));
  const { error } = await supabase.storage.from("goals").upload(name, buf, {
    contentType: CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream",
    upsert: true,
  });
  if (error) { console.error(`Upload ${name} failed:`, error.message); continue; }
  uploaded++;
}
console.log(`Uploaded ${uploaded} photo(s)`);

// --- 2. expenses: insert as-is (ids + timestamps preserved) ---
const expenses = JSON.parse(readFileSync(new URL("expenses.json", snap), "utf8"));
if (expenses.length) {
  const { error } = await supabase.from("expenses").upsert(expenses, { onConflict: "id" });
  if (error) { console.error("Insert expenses failed:", error.message); process.exit(1); }
}
console.log(`Imported ${expenses.length} expense(s)`);

// --- 3. goals: rewrite image_url to the new project ref ---
const goals = JSON.parse(readFileSync(new URL("goals.json", snap), "utf8")).map((g) => ({
  ...g,
  image_url: g.image_url
    ? g.image_url.replace(/https:\/\/[^.]+\.supabase\.co/, `https://${newRef}.supabase.co`)
    : g.image_url,
}));
if (goals.length) {
  const { error } = await supabase.from("goals").upsert(goals, { onConflict: "id" });
  if (error) { console.error("Insert goals failed:", error.message); process.exit(1); }
}
console.log(`Imported ${goals.length} goal(s)`);

console.log("\nImport complete.");
