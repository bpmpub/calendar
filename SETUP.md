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

## 5. Passkey login (optional, but built)

Registration/login flows are fully written — 4 Edge Functions in
`supabase/functions/passkey-*`, plus a `webauthn_challenges` table for
the two-step handshake. What's left is deploying them, which needs the
Supabase CLI signed into your account — that's an interactive login I
can't do from here.

1. Run the migration: SQL Editor → paste and run
   [`supabase/migrations/2026-09-22-passkey-challenges-table.sql`](supabase/migrations/2026-09-22-passkey-challenges-table.sql).
   (Skip if you ran the full `schema.sql` fresh after this was added —
   it's already in there.)
2. Install the CLI if you don't have it: `brew install supabase/tap/supabase`
3. `supabase login` (opens a browser, you approve it — this is the
   account-linking step only you can do)
4. From the repo root: `supabase link --project-ref cwanxmvbuoogxrmbnppk`
5. Set the two secrets the functions need (your actual site origin and
   domain — no trailing slash on either):
   ```bash
   supabase secrets set SITE_ORIGIN=https://ash-development.github.io RP_ID=ash-development.github.io
   ```
6. Deploy all four:
   ```bash
   supabase functions deploy passkey-register-options
   supabase functions deploy passkey-register-verify
   supabase functions deploy passkey-login-options
   supabase functions deploy passkey-login-verify
   ```
7. Test: log into `/dashboard/` with magic link once, click **+ Add a
   passkey** in the header, approve the Face ID / Touch ID / Windows
   Hello / security key prompt. Log out, go back to `/login/`, enter the
   same email, click **Sign in with a passkey**.

**Heads up — this hasn't been tested against a live deployment** (I have
no way to deploy or trigger a real WebAuthn ceremony from here). The
`@simplewebauthn` library's API shape has shifted between major versions
before; if a function throws after deploying, check its logs
(`supabase functions logs <name>`) against the comments in
`passkey-register-verify/index.ts` and `passkey-login-verify/index.ts` —
those flag the two spots most likely to need a small adjustment.
