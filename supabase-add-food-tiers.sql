-- Food Tiers — a shared S/A/B/C/D tier list of foods, the second "app" in the
-- launcher. Photos reuse the public `goals` storage bucket. Same no-auth model
-- as the other tables. Run once on an existing project; the from-scratch setup
-- in supabase-setup.sql already includes it.

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

notify pgrst, 'reload schema';
