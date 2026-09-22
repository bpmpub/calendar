-- Run this once in the Supabase SQL Editor to apply the "hide pending
-- shows from the public calendar" change to an already-running project.
-- (New projects get this automatically from schema.sql.)

drop policy if exists "public read shows" on shows;
drop policy if exists "read shows" on shows;

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
