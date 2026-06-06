// One-off: snapshot the OLD Supabase project to ./migration-snapshot/.
// Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local.
// The anon role can read both tables (RLS) and the `goals` bucket is public,
// so no service-role key is needed for export.
//
//   node migrate-export.mjs
//
// Produces:
//   migration-snapshot/expenses.json
//   migration-snapshot/goals.json
//   migration-snapshot/goals-bucket/<files...>   (downloaded photos)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL(".env.local", import.meta.url), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();
const anonKey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();

if (!url || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, anonKey);
const outDir = new URL("migration-snapshot/", import.meta.url);
mkdirSync(outDir, { recursive: true });

// --- tables ---
for (const table of ["expenses", "goals"]) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    console.error(`Read ${table} failed:`, error.message);
    process.exit(1);
  }
  writeFileSync(new URL(`${table}.json`, outDir), JSON.stringify(data, null, 2));
  console.log(`Exported ${data.length} row(s) from ${table}`);
}

// --- storage: goals bucket ---
const bucketDir = new URL("goals-bucket/", outDir);
mkdirSync(bucketDir, { recursive: true });

const { data: files, error: listError } = await supabase.storage
  .from("goals")
  .list("", { limit: 1000 });

if (listError) {
  console.error("List bucket failed:", listError.message);
  process.exit(1);
}

let count = 0;
for (const f of files ?? []) {
  if (f.id === null) continue; // skip folders
  const { data: blob, error: dlError } = await supabase.storage
    .from("goals")
    .download(f.name);
  if (dlError) {
    console.error(`Download ${f.name} failed:`, dlError.message);
    continue;
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(new URL(f.name, bucketDir), buf);
  count++;
}
console.log(`Downloaded ${count} photo(s) from the goals bucket`);
console.log("\nSnapshot written to ./migration-snapshot/");
