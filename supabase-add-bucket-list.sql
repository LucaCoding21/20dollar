-- Bucket List — shared "things we want to do together" list for the Bucket List
-- app. Same no-auth model as the rest of the suite: the anon role can read,
-- insert, update and delete; RLS is on with permissive policies. Run this on an
-- existing project; it's also folded into supabase-setup.sql for from-scratch
-- installs. Photos reuse the public `goals` storage bucket.

create table if not exists public.bucket_items (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null    default now(),
  title      text        not null,                       -- the thing to do
  note       text,                                       -- optional details
  category   text        not null default 'movies',       -- category slug
  image_url  text,                                       -- optional photo (goals bucket)
  done       boolean     not null default false,
  done_at    timestamptz                                 -- when it was checked off
);

alter table public.bucket_items enable row level security;

-- SQL-created tables aren't auto-exposed to the Data API; grant the anon role.
grant select, insert, update, delete on public.bucket_items to anon;

drop policy if exists "anon can read bucket_items"   on public.bucket_items;
drop policy if exists "anon can insert bucket_items" on public.bucket_items;
drop policy if exists "anon can update bucket_items" on public.bucket_items;
drop policy if exists "anon can delete bucket_items" on public.bucket_items;

create policy "anon can read bucket_items"
  on public.bucket_items for select to anon using (true);
create policy "anon can insert bucket_items"
  on public.bucket_items for insert to anon with check (true);
create policy "anon can update bucket_items"
  on public.bucket_items for update to anon using (true) with check (true);
create policy "anon can delete bucket_items"
  on public.bucket_items for delete to anon using (true);

notify pgrst, 'reload schema';
