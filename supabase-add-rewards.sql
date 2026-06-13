-- $20 a Day — Rewards. A reward (a treat like "lashes" or a cash amount like
-- $5) stays locked until you complete the task tied to it. Run this once on an
-- existing project; the from-scratch setup in supabase-setup.sql does not yet
-- include it. Same no-auth model as the other tables: anon can do everything,
-- RLS on with permissive policies (private two-person app).

------------------------------------------------------------------------
-- rewards: a treat/cash reward gated behind completing a task
------------------------------------------------------------------------

create table if not exists public.rewards (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null    default now(),
  title      text        not null,                  -- the reward, e.g. "Lashes"
  task       text        not null,                  -- task to finish to unlock it
  kind       text        not null default 'treat'   -- 'treat' (a thing) or 'cash'
             check (kind in ('treat', 'cash')),
  amount     numeric,                               -- dollar value when kind='cash'
  person     text        check (person is null or person in ('luca', 'irish')),
  image_url  text,                                  -- optional photo (goals bucket)
  done_at    timestamptz,                           -- when the task was completed
  claimed_at timestamptz                            -- when the reward was redeemed
);

alter table public.rewards enable row level security;

-- SQL-created tables aren't auto-exposed to the Data API; grant the anon role.
grant select, insert, update, delete on public.rewards to anon;

drop policy if exists "anon can read rewards"   on public.rewards;
drop policy if exists "anon can insert rewards" on public.rewards;
drop policy if exists "anon can update rewards" on public.rewards;
drop policy if exists "anon can delete rewards" on public.rewards;

create policy "anon can read rewards"
  on public.rewards for select to anon using (true);
create policy "anon can insert rewards"
  on public.rewards for insert to anon with check (true);
create policy "anon can update rewards"
  on public.rewards for update to anon using (true) with check (true);
create policy "anon can delete rewards"
  on public.rewards for delete to anon using (true);

notify pgrst, 'reload schema';
