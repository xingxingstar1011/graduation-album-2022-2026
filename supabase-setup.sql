-- Run this in Supabase SQL Editor.
-- It stores shared album edits in Postgres and inserted images in public Storage.

create table if not exists public.album_states (
  album_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.album_states enable row level security;

drop policy if exists "album states are public readable" on public.album_states;
drop policy if exists "authenticated users can insert album states" on public.album_states;
drop policy if exists "authenticated users can update album states" on public.album_states;

create policy "album states are public readable"
on public.album_states
for select
using (true);

create policy "authenticated users can insert album states"
on public.album_states
for insert
to authenticated
with check (true);

create policy "authenticated users can update album states"
on public.album_states
for update
to authenticated
using (true)
with check (true);

insert into storage.buckets (id, name, public)
values ('album-inserts', 'album-inserts', true)
on conflict (id) do update set public = true;

drop policy if exists "album inserted images are public readable" on storage.objects;
drop policy if exists "authenticated users can upload album images" on storage.objects;
drop policy if exists "authenticated users can update album images" on storage.objects;
drop policy if exists "authenticated users can delete album images" on storage.objects;

create policy "album inserted images are public readable"
on storage.objects
for select
using (bucket_id = 'album-inserts');

create policy "authenticated users can upload album images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'album-inserts');

create policy "authenticated users can update album images"
on storage.objects
for update
to authenticated
using (bucket_id = 'album-inserts')
with check (bucket_id = 'album-inserts');

create policy "authenticated users can delete album images"
on storage.objects
for delete
to authenticated
using (bucket_id = 'album-inserts');
