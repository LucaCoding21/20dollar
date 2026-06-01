// One-off: empty the `goals` storage bucket via the Storage API.
// SQL can't delete storage.objects, so this is the supported path for clearing
// uploaded goal photos during a reset.
//
// Needs the SERVICE ROLE key (bypasses RLS) — grab it from the Supabase
// dashboard -> Settings -> API -> service_role. Do NOT commit it.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node clear-goals-bucket.mjs
//
// (Reads NEXT_PUBLIC_SUPABASE_URL from .env.local automatically.)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Pull the project URL out of .env.local without extra deps.
const env = readFileSync(new URL(".env.local", import.meta.url), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing config. Need NEXT_PUBLIC_SUPABASE_URL in .env.local and " +
      "SUPABASE_SERVICE_ROLE_KEY in the environment.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: files, error: listError } = await supabase.storage
  .from("goals")
  .list("", { limit: 1000 });

if (listError) {
  console.error("List failed:", listError.message);
  process.exit(1);
}

if (!files?.length) {
  console.log("Bucket already empty — nothing to do.");
  process.exit(0);
}

const paths = files.map((f) => f.name);
const { error: removeError } = await supabase.storage.from("goals").remove(paths);

if (removeError) {
  console.error("Delete failed:", removeError.message);
  process.exit(1);
}

console.log(`Deleted ${paths.length} object(s) from the goals bucket.`);
