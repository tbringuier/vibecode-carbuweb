# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Carbu'Web — French fuel price comparison static site. Python build pipeline downloads government data (data.gouv.fr) and OpenStreetMap station names, merges daily + real-time prices, computes geo-spatial indexes and statistics, then generates a minified static site deployed to GitHub Pages.

## Commands

```bash
# Install dependencies
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# Run full build pipeline (downloads data, builds database, generates site)
python3 main.py

# Output goes to build/ directory
```

There are no tests, no linter, and no separate dev server. The CI workflow (`.github/workflows/build.yml`) runs `python3 main.py` on every push and on a 5-minute cron schedule.

## Architecture

### Build Pipeline (`main.py`)

Sequential phases:
1. **Download** — Daily prices (Excel from data.gouv.fr), real-time flux (Excel), OSM station names (Overpass API with mirror rotation, up to 100 retries)
2. **Build database** — Parse Excel → station records with prices, addresses, geo coords; enrich with OSM names; build indexes (`geo_tree`, `cp_index`, `dept_index`, `region_index`, `recherche_texte`)
3. **Merge flux** — Correlate real-time stream into daily data via ID match → geometry match (5dp) → geometry+address match (3dp); newer prices replace older ones; data >7 days is stale
4. **Aggregate** — National/regional/departmental min/avg statistics, build `dashboard` metadata
5. **Generate site** — Minify HTML/JS/JSON, inject build metadata (date, git SHA, station count, timestamps), output to `build/`

### Frontend (`templates/app.js`, `templates/index.html`)

Vanilla JS (no framework), Tailwind CSS (CDN), Leaflet maps, Chart.js. All data loaded from a single `data.json` (~11MB).

Key search modes: proximity (geolocation + Haversine), postal code (index lookup), geographic zone (region/dept/city), full-text.

User state persisted in localStorage: `carbuRadius`, `carbuFuels`, `carbuFavorites`, `carbuVehicles`, `carbuActiveVehicle`, `carbuWelcomeDismissed`.

Vehicle system: 8 icon types, tank size in liters, per-vehicle fuel filters, full tank cost estimation.

### Data

- `datasets/` — Downloaded Excel files and built JSON database (git-ignored)
- `build/` — Generated static site (git-ignored)
- `templates/` — Source HTML, JS, service worker, assets
- Fuel types: `["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]`

## Key Conventions

- All user-facing text is in French
- Timezone: Europe/Paris (forced via `ZoneInfo`)
- Currency formatting: EUR with French locale (narrow space separator)
- Asset filenames are timestamped for cache-busting (e.g., `app.1234567890.js`)
- Theme color: Indigo (`#4f46e5`)
- PWA: service worker + manifest for offline support
