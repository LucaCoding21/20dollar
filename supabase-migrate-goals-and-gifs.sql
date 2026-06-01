-- Migration: bring Supabase in line with Irish's changes (commit 4d6ea1b).
-- Adds: expenses.gif_url, expenses UPDATE/DELETE access, the whole `goals`
-- table, and a public `goals` storage bucket for goal photos.
-- Safe to re-run: every statement is idempotent.
-- Run in Supabase dashboard -> SQL Editor -> New query -> paste -> Run.

------------------------------------------------------------------------
-- 1. expenses: new gif_url column + edit/delete access
------------------------------------------------------------------------

alter table public.expenses add column if not exists gif_url text;

-- The app now edits and deletes transactions, not just read/insert.
grant update, delete on public.expenses to anon;

drop policy if exists "anon can update expenses" on public.expenses;
drop policy if exists "anon can delete expenses" on public.expenses;

create policy "anon can update expenses"
  on public.expenses for update to anon using (true) with check (true);

create policy "anon can delete expenses"
  on public.expenses for delete to anon using (true);

------------------------------------------------------------------------
-- 2. goals: shared savings goals funded out of the bank balance
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

-- SQL-created tables aren't auto-exposed to the Data API; grant the anon role.
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
-- 3. storage: public `goals` bucket for uploaded goal photos
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

------------------------------------------------------------------------
-- 4. tell Supabase's API layer to pick up the schema changes immediately
------------------------------------------------------------------------

notify pgrst, 'reload schema';
