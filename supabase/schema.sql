-- BPM Show Calendar — Supabase schema
-- Run this once in the Supabase SQL Editor after creating the project.

create table if not exists artists (
  artist_id text primary key,
  name text not null,
  publicist_name text not null,   -- display name shown on the public calendar
  publicist_email text not null,  -- matches the publicist's login email; used by RLS
  genre text,
  active boolean not null default true
);

create table if not exists shows (
  show_id uuid primary key default gen_random_uuid(),
  artist_id text not null references artists(artist_id),
  date date not null,
  time text,
  venue text not null,
  city text not null,
  state_region text,
  country text default 'USA',
  tour_name text,
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'cancelled')),
  ticket_link text,
  notes text
);

-- Admin allowlist: emails in here bypass the artist-match restriction
-- (publicist_email) and can edit any show, plus manage the artists table.
create table if not exists admin_emails (
  email text primary key
);

alter table artists enable row level security;
alter table shows enable row level security;
alter table admin_emails enable row level security;

-- ---------- Public (anon key) read access ----------

create policy "public read artists" on artists
  for select using (true);

create policy "public read shows" on shows
  for select using (true);

-- admin_emails is read only by the login page's client-side allowlist
-- check. Emails aren't sensitive, so a public select is fine here.
create policy "public read admin_emails" on admin_emails
  for select using (true);

-- ---------- Authenticated write access ----------

create or replace function is_admin(user_email text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from admin_emails where email = user_email);
$$;

-- Publicists can write shows for artists they own; admins can write any.
create policy "publicist or admin insert shows" on shows
  for insert to authenticated
  with check (
    is_admin(auth.jwt() ->> 'email')
    or exists (
      select 1 from artists
      where artists.artist_id = shows.artist_id
        and artists.publicist_email = auth.jwt() ->> 'email'
    )
  );

create policy "publicist or admin update shows" on shows
  for update to authenticated
  using (
    is_admin(auth.jwt() ->> 'email')
    or exists (
      select 1 from artists
      where artists.artist_id = shows.artist_id
        and artists.publicist_email = auth.jwt() ->> 'email'
    )
  )
  with check (
    is_admin(auth.jwt() ->> 'email')
    or exists (
      select 1 from artists
      where artists.artist_id = shows.artist_id
        and artists.publicist_email = auth.jwt() ->> 'email'
    )
  );

create policy "publicist or admin delete shows" on shows
  for delete to authenticated
  using (
    is_admin(auth.jwt() ->> 'email')
    or exists (
      select 1 from artists
      where artists.artist_id = shows.artist_id
        and artists.publicist_email = auth.jwt() ->> 'email'
    )
  );

-- Only admins manage the artists table.
create policy "admin insert artists" on artists
  for insert to authenticated
  with check (is_admin(auth.jwt() ->> 'email'));

create policy "admin update artists" on artists
  for update to authenticated
  using (is_admin(auth.jwt() ->> 'email'))
  with check (is_admin(auth.jwt() ->> 'email'));

create policy "admin delete artists" on artists
  for delete to authenticated
  using (is_admin(auth.jwt() ->> 'email'));

-- ---------- Passkeys (fast-follow, not required for magic-link launch) ----------

create table if not exists passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table passkeys enable row level security;

create policy "user manages own passkeys" on passkeys
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Seed the admin allowlist ----------
-- Replace with Becky's real login email before running.
insert into admin_emails (email) values ('becky@bpmpublicity.com')
  on conflict (email) do nothing;
