# BPM Show Calendar

Static site, no build step. Reads `data/artists.json` + `data/shows.json` at load time.

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Update shows

Edit `data/shows.json` (and `data/artists.json` for new artists/publicists) directly, following the schema in the spec. Push to `main` — GitHub Pages redeploys automatically.

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. Repo Settings → Pages → Source: deploy from `main` branch, root.
3. Site publishes at `https://<user>.github.io/<repo>/`.

## Design system

Built on the real Big Picture Media design system (`tokens/*.css`, `assets/` — badge logo, Impact font, decorative marks). All tokens are imported via `styles.css`; component styling in that file follows the system's Button/Tag/Card/FilterBar/NavBar/Footer/Dialog patterns. Body font (Poppins) is a documented substitute in the source system — see its own readme if you get the real typeface later.

## Open questions (from spec, unresolved)

- Public-facing or internal-only?
- Include past shows at launch, or start fresh from today?
- Any artists with more than one publicist?
