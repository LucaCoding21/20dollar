-- $20 a Day — shared allowance bank. No auth: the anon role can read and
-- insert expenses. RLS is on (required for any table reachable by the Data
-- API) with permissive policies, since this is a private two-person gimmick.

create table if not exists public.expenses (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null    default now(),
  person     text        not null    check (person in ('luca', 'irish')),
  amount     numeric     not null,   -- dollars spent; negative adds money back
  note       text,
  category   text                    -- category slug, e.g. 'food', 'transport'
);

alter table public.expenses enable row level security;

-- SQL-created tables aren't auto-exposed to the Data API; grant the anon role.
grant select, insert on public.expenses to anon;

drop policy if exists "anon can read expenses"   on public.expenses;
drop policy if exists "anon can insert expenses" on public.expenses;

create policy "anon can read expenses"
  on public.expenses for select to anon using (true);

create policy "anon can insert expenses"
  on public.expenses for insert to anon with check (true);
