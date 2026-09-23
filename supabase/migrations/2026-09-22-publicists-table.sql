-- Run this once in the Supabase SQL Editor. Adds a standalone
-- publicists table so someone can be a recognized publicist (and log
-- in) before they own any artists — previously "publicist" only
-- existed as a field on artists rows, so a brand-new publicist with
-- zero artists assigned couldn't be added at all.

create table if not exists publicists (
  email text primary key,
  name text not null
);
alter table publicists enable row level security;

create policy "public read publicists" on publicists
  for select using (true);

create policy "admin insert publicists" on publicists
  for insert to authenticated
  with check (is_admin(auth.jwt() ->> 'email'));

create policy "admin update publicists" on publicists
  for update to authenticated
  using (is_admin(auth.jwt() ->> 'email'))
  with check (is_admin(auth.jwt() ->> 'email'));

create policy "admin delete publicists" on publicists
  for delete to authenticated
  using (is_admin(auth.jwt() ->> 'email'));

-- Backfill from whoever's already a publicist on an existing artist,
-- then add the BPM team.
insert into publicists (email, name)
  select distinct publicist_email, publicist_name from artists
  on conflict (email) do nothing;

insert into publicists (email, name) values
  ('becky@bpmpublicity.com', 'Becky Kovach'),
  ('natalie@bpmpublicity.com', 'Natalie Schaffer'),
  ('dayna@bpmpublicity.com', 'Dayna Ghiraldi-Travers'),
  ('kerriann@bpmpublicity.com', 'Kerri-Ann Seredinsky'),
  ('liz@bpmpublicity.com', 'Liz Wiltshire')
  on conflict (email) do nothing;
