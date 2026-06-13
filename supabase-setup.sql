-- $20 a Day — shared allowance bank. No auth: the anon role can read, insert,
-- update and delete on both tables. RLS is on (required for any table reachable
-- by the Data API) with permissive policies, since this is a private two-person
-- gimmick. This is the full from-scratch setup; for an existing project see
-- supabase-migrate-goals-and-gifs.sql.

------------------------------------------------------------------------
-- expenses: each transaction (spend is positive, refund is negative)
------------------------------------------------------------------------

create table if not exists public.expenses (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null    default now(),
  person     text        not null    check (person in ('luca', 'irish')),
  amount     numeric     not null,   -- dollars spent; negative adds money back
  note       text,
  category   text,                   -- category slug, e.g. 'food', 'transport'
  gif_url    text,                   -- optional GIPHY gif attached to the txn
  from_reward boolean not null default false  -- paid from reward money, not bank
);

alter table public.expenses enable row level security;

-- SQL-created tables aren't auto-exposed to the Data API; grant the anon role.
grant select, insert, update, delete on public.expenses to anon;

drop policy if exists "anon can read expenses"   on public.expenses;
drop policy if exists "anon can insert expenses" on public.expenses;
drop policy if exists "anon can update expenses" on public.expenses;
drop policy if exists "anon can delete expenses" on public.expenses;

create policy "anon can read expenses"
  on public.expenses for select to anon using (true);
create policy "anon can insert expenses"
  on public.expenses for insert to anon with check (true);
create policy "anon can update expenses"
  on public.expenses for update to anon using (true) with check (true);
create policy "anon can delete expenses"
  on public.expenses for delete to anon using (true);

------------------------------------------------------------------------
-- goals: shared savings goals funded out of the bank balance
------------------------------------------------------------------------

create table if not exists public.goals (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null    default now(),
  title      text        not null,
  subtitle   text,
  target     numeric     not null,                 -- price tag
  saved      numeric     not null default 0,       -- running total moved in
  image_url  text,                                 -- public URL in `goals` bucket
  is_current boolean     not null default false    -- the featured goal
);

alter table public.goals enable row level security;

grant select, insert, update, delete on public.goals to anon;

drop policy if exists "anon can read goals"   on public.goals;
drop policy if exists "anon can insert goals" on public.goals;
drop policy if exists "anon can update goals" on public.goals;
drop policy if exists "anon can delete goals" on public.goals;

create policy "anon can read goals"
  on public.goals for select to anon using (true);
create policy "anon can insert goals"
  on public.goals for insert to anon with check (true);
create policy "anon can update goals"
  on public.goals for update to anon using (true) with check (true);
create policy "anon can delete goals"
  on public.goals for delete to anon using (true);

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

------------------------------------------------------------------------
-- food_items: shared S/A/B/C/D tier list of foods (the Food Tiers app)
------------------------------------------------------------------------

create table if not exists public.food_items (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null    default now(),
  name       text        not null,
  image_url  text,                                  -- optional photo (goals bucket)
  tier       text        check (tier is null or tier in ('S', 'A', 'B', 'C', 'D'))
);

alter table public.food_items enable row level security;

grant select, insert, update, delete on public.food_items to anon;

drop policy if exists "anon can read food_items"   on public.food_items;
drop policy if exists "anon can insert food_items" on public.food_items;
drop policy if exists "anon can update food_items" on public.food_items;
drop policy if exists "anon can delete food_items" on public.food_items;

create policy "anon can read food_items"
  on public.food_items for select to anon using (true);
create policy "anon can insert food_items"
  on public.food_items for insert to anon with check (true);
create policy "anon can update food_items"
  on public.food_items for update to anon using (true) with check (true);
create policy "anon can delete food_items"
  on public.food_items for delete to anon using (true);

------------------------------------------------------------------------
-- storage: public `goals` bucket for uploaded goal + reward + food photos
------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('goals', 'goals', true)
on conflict (id) do update set public = true;

drop policy if exists "anon can read goal images"   on storage.objects;
drop policy if exists "anon can upload goal images" on storage.objects;

create policy "anon can read goal images"
  on storage.objects for select to anon
  using (bucket_id = 'goals');
create policy "anon can upload goal images"
  on storage.objects for insert to anon
  with check (bucket_id = 'goals');

notify pgrst, 'reload schema';
