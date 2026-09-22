# BPM Show Calendar

Static site (no build step) plus a Supabase backend for publicist auth/editing.

## Dev server

```bash
python3 -m http.server 8080
```

Open http://localhost:8080. Kill with `pkill -f "http.server 8080"`.

## File map

- `index.html`, `app.js`, `styles.css` — public calendar (read-only, no login)
- `login/`, `dashboard/` — publicist auth + edit UI (Supabase-gated)
- `lib/config.js` — Supabase URL + anon key (fill in per [SETUP.md](SETUP.md))
- `lib/supabase-client.js` — shared client; app falls back to `data/*.json`
  when Supabase isn't configured yet
- `data/artists.json`, `data/shows.json` — fallback data source, and the
  source `supabase/seed-data.sql` was generated from
- `supabase/schema.sql`, `supabase/seed-data.sql` — run once in the
  Supabase SQL editor, see [SETUP.md](SETUP.md)
- `supabase/functions/passkey-*/` — passkey login, written but not deployed (see SETUP.md §5)
- `tokens/*.css` — Big Picture Media design system tokens, imported by `styles.css`
- `assets/` — brand logo, Impact font (decor marks are pure CSS, not raster)

## Deploy

GitHub Pages, deploy from `main` branch root. See [README.md](README.md)
and [SETUP.md](SETUP.md) for the Supabase side.
