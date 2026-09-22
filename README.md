# BPM Show Calendar

Static site, no build step. Public calendar (`index.html`) is read-only and
un-gated. `login/` + `dashboard/` add publicist authentication and editing,
backed by Supabase.

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Update shows

**With the dashboard set up (see [SETUP.md](SETUP.md)):** publicists log in
at `/login/` and edit their own artists' shows at `/dashboard/`. Admins see
everyone's. Changes go live on the public calendar immediately.

**Without it (or before it's set up):** edit `data/shows.json` (and
`data/artists.json` for new artists/publicists) directly — the site falls
back to these files whenever `lib/config.js` isn't filled in. Push to
`main` — GitHub Pages redeploys automatically.

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. Repo Settings → Pages → Source: deploy from `main` branch, root.
3. Site publishes at `https://<user>.github.io/<repo>/`.

## Design system

Built on the real Big Picture Media design system (`tokens/*.css`, `assets/` — badge logo, Impact font, decorative marks). All tokens are imported via `styles.css`; component styling in that file follows the system's Button/Tag/Card/FilterBar/NavBar/Footer/Dialog patterns. Body font (Poppins) is a documented substitute in the source system — see its own readme if you get the real typeface later.

## Publicist auth + dashboard

See [SETUP.md](SETUP.md) for the one-time Supabase setup (create project,
run `supabase/schema.sql` + `supabase/seed-data.sql`, fill in `lib/config.js`).
Magic-link login ships first; passkey login is scaffolded but not wired up
(see `supabase/functions/passkey-verify/`).

## Open questions (from spec, unresolved)

- Public-facing or internal-only?
- Include past shows at launch, or start fresh from today?
- Any artists with more than one publicist?
