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

-- Publicists exist independently of owning any artists — this is what
-- lets someone be added to the login allowlist and given a profile
-- before any artists are assigned to them. artists.publicist_email /
-- publicist_name stay as-is (denormalized, no FK) so this table is
-- additive, not a breaking change to the artists table.
create table if not exists publicists (
  email text primary key,
  name text not null
);

alter table artists enable row level security;
alter table shows enable row level security;
alter table admin_emails enable row level security;
alter table publicists enable row level security;

-- ---------- Public (anon key) read access ----------

create policy "public read artists" on artists
  for select using (true);

-- shows.status = 'pending' means the show hasn't been announced yet —
-- the read policy below (after is_admin exists) keeps those hidden from
-- the public calendar while still showing them to the publicist who
-- owns the artist (or an admin) when logged into the dashboard.

-- admin_emails is read only by the login page's client-side allowlist
-- check. Emails aren't sensitive, so a public select is fine here.
create policy "public read admin_emails" on admin_emails
  for select using (true);

-- Public so the login page's allowlist check and the dashboard's
-- publicist picker can both read it without a session.
create policy "public read publicists" on publicists
  for select using (true);

-- ---------- Authenticated write access ----------

create or replace function is_admin(user_email text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from admin_emails where email = user_email);
$$;

-- Everyone sees non-pending shows; a publicist additionally sees their
-- own pending shows (and an admin sees all pending shows) when signed in.
create policy "read shows" on shows
  for select
  using (
    status <> 'pending'
    or (
      auth.role() = 'authenticated'
      and (
        is_admin(auth.jwt() ->> 'email')
        or exists (
          select 1 from artists
          where artists.artist_id = shows.artist_id
            and artists.publicist_email = auth.jwt() ->> 'email'
        )
      )
    )
  );

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

-- ---------- Passkeys (fast-follow, not required for magic-link launch) ----------

create table if not exists passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,  -- denormalized for the login Edge Function's lookup-by-email
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

-- Short-lived WebAuthn challenges, one per in-progress registration or
-- login ceremony. Written and read only by the Edge Functions (service
-- role, which bypasses RLS) — no policy here grants anon/authenticated
-- access on purpose, since a readable challenge would let anyone forge
-- a response to it.
create table if not exists webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  challenge text not null,
  purpose text not null check (purpose in ('register', 'login')),
  created_at timestamptz not null default now()
);
alter table webauthn_challenges enable row level security;

-- ---------- Seed the admin allowlist ----------
insert into admin_emails (email) values
  ('becky@bpmpublicity.com'),
  ('internash@bigpicturemediaonline.com')
  on conflict (email) do nothing;

-- ---------- Seed the BPM team as publicists ----------
insert into publicists (email, name) values
  ('becky@bpmpublicity.com', 'Becky Kovach'),
  ('natalie@bpmpublicity.com', 'Natalie Schaffer'),
  ('dayna@bpmpublicity.com', 'Dayna Ghiraldi-Travers'),
  ('kerriann@bpmpublicity.com', 'Kerri-Ann Seredinsky'),
  ('liz@bpmpublicity.com', 'Liz Wiltshire')
  on conflict (email) do nothing;
