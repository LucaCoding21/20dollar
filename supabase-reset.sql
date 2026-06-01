-- RESET: wipe all test data and start fresh.
-- Removes every expense, every goal, and every uploaded goal photo.
-- Run in Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- After this runs, with LAUNCH set to 2026-06-01 in src/lib/bank.ts, the bank
-- reads exactly $20.00 for today (day 1, nothing spent).
--
-- WARNING: this is destructive and cannot be undone. Only run it because the
-- current data is throwaway test data.

-- Transactions (spends/refunds).
delete from public.expenses;

-- Savings goals.
delete from public.goals;

-- NOTE: uploaded goal photos can't be cleared from SQL — Supabase blocks direct
-- deletes on storage.objects. They're harmless orphans (nothing references them
-- once goals are gone), but to actually empty the bucket use ONE of:
--   * Dashboard -> Storage -> goals bucket -> select all -> Delete, or
--   * the Storage API: see clear-goals-bucket.mjs in the repo root.
