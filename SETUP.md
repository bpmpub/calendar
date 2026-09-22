# Publicist auth + dashboard — setup checklist

Everything code-side is built. These steps are yours — they need account
access I don't have.

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → new project (free tier is fine).
2. SQL Editor → paste and run [`supabase/schema.sql`](supabase/schema.sql).
   - Before running, edit the last line to Becky's real login email
     (currently a placeholder: `becky@bpmpublicity.com`).
3. SQL Editor → paste and run [`supabase/seed-data.sql`](supabase/seed-data.sql)
   to import the current 30 artists / 404 shows.
   - This file uses **placeholder emails** derived from each publicist's
     name (e.g. `becky.kovach@bpmpublicity.com`) — the mapping is printed
     as comments at the top of the file. Replace with real addresses
     before running, or `update artists set publicist_email = '...' where
     artist_id = '...'` afterwards.

## 2. Configure auth

In Supabase → Authentication → URL Configuration:
- **Site URL**: `https://ash-development.github.io/bpm-cal/dashboard/`
- **Redirect URLs**: add `https://ash-development.github.io/bpm-cal/dashboard/`
  (and `http://localhost:8080/dashboard/` if you want local testing to work)

Authentication → Providers → Email: magic link is on by default. Turn off
"Confirm email" under Email if you don't want the extra double-click step
for new publicist logins.

## 3. Wire the frontend to your project

Supabase → Project Settings → API. Copy two values into
[`lib/config.js`](lib/config.js):

```js
export const SUPABASE_URL = "https://xxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

Both are safe to commit — Row Level Security (already set up by
`schema.sql`) is what protects the data, not secrecy of these values.
**Never** put the service-role key here or anywhere in this repo.

Commit and push. The public calendar, login page, and dashboard all read
this same file, so one edit wires up all three.

## 4. Test it

1. Visit `/login/`, enter a publicist email that's in `artists.publicist_email`
   or `admin_emails`.
2. Check email, click the link → lands on `/dashboard/`.
3. Confirm you only see your own artists (or everyone's, if you used the
   admin email).
4. Add/edit/cancel a show, confirm it shows up on the public calendar.

## What's NOT done yet (by design)

- **Passkey login** — the brief flags this as a fast-follow, not a launch
  blocker. Scaffolding is in [`supabase/functions/passkey-verify/index.ts`](supabase/functions/passkey-verify/index.ts)
  with the full flow commented out and explained. It needs: a WebAuthn
  library, two more Edge Functions (registration), a challenge-storage
  table, and `supabase functions deploy` (needs `supabase login`, so
  that's on you too). The login page's "Sign in with a passkey" button
  currently just explains it's not ready yet, rather than failing silently.
