-- $20 a Day — let earned reward money be spent through a normal transaction.
-- A reward-funded spend is recorded in `expenses` like any other, but flagged
-- so it draws down the person's reward pot instead of the shared $20 bank (and
-- is excluded from the weekly budget analytics). Run once on an existing
-- project; the from-scratch setup in supabase-setup.sql already includes it.

alter table public.expenses
  add column if not exists from_reward boolean not null default false;

notify pgrst, 'reload schema';
