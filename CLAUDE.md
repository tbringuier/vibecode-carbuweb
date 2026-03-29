# Carbu'Web

Application web de comparaison des prix de carburants en France.
Site statique genere par CI (GitHub Actions), deploye sur GitHub Pages.

Domaine : `carbuweb.folf.fr`

## Architecture

```
main.py                  # Shim → pipeline.main()
pipeline/                # Package Python (build pipeline)
  __init__.py            # Expose main()
  __main__.py            # python -m pipeline
  config.py              # Constantes, chemins, URLs
  helpers.py             # Fonctions utilitaires partagees
  download.py            # Telechargement donnees (quotidien, flux, OSM)
  dedup.py               # Phase 1 : dedoublonnage
  stations.py            # Phases 2-3 : creation stations + fusion flux
  purge.py               # Phase 4 : purge stations sans prix
  aggregates.py          # Phase 5 : agregats + index
  generate.py            # Generation site (CSS concat, JS copy, HTML placeholders)
  cleanup.py             # Nettoyage fichiers anciens
  main.py                # Orchestration (build_database + main)
templates/
  index.html             # Template HTML (~120 lignes)
  app.js                 # Entry point ES module (imports ./js/*.js)
  js/                    # Modules JS (15 fichiers)
    state.js             # Etat global + persistence localStorage
    helpers.js           # Utilitaires (HTML escape, normalisation, distance)
    freshness.js         # Badges fraicheur (jours, pills, labels)
    prices.js            # Classification prix, nearby, tank
    map.js               # Leaflet (mkMap, mkIcon, initMap)
    navigation.js        # Onglets, historique, popstate
    search.js            # Recherche texte + geocodage OSM
    geolocation.js       # GPS + recherche proximite
    geo-zones.js         # Recherche par region/departement
    station.js           # Vue detail station
    explore.js           # Classement, graphiques, tableau regional
    favorites.js         # Gestion favoris (stations + lieux)
    vehicles.js          # Profils vehicules CRUD
    settings.js          # Parametres, refresh, rayon
    drag-drop.js         # Classe TouchDragReorder
  css/                   # Fichiers CSS (11 fichiers, concatenes au build)
    variables.css        # Custom properties + dark mode
    base.css             # Reset, typographie
    layout.css           # Grille, responsive
    nav.css              # Navigation top/bottom
    search.css           # Recherche
    station.css          # Detail station, prix, horaires
    explore.css          # Palmares, tableaux, graphiques
    favorites.css        # Favoris
    vehicles.css         # Vehicules
    components.css       # Composants transversaux (cards, modals, toast)
    map.css              # Overrides Leaflet
  sw.js                  # Service worker (nettoyage legacy)
  icon.svg               # Icone PWA
  CNAME                  # Domaine custom
datasets/                # Fichiers de donnees (telecharges, pas versionnes)
build/                   # Site genere (pas versionne)
  data.json              # Base de donnees complete (~11 Mo)
  index.html             # HTML minifie
  app.{ts}.js            # Entry point JS (cache-bust timestamp)
  js/                    # Modules JS minifies
  styles.{ts}.css        # CSS concatene (cache-bust timestamp)
.github/workflows/build.yml  # CI/CD : build toutes les 5 min + deploy
```

## Stack technique

- **Backend** : Python 3.14 (pandas, openpyxl, requests)
- **Frontend** : Vanilla JS (pas de framework, pas de bundler, pas de Tailwind)
- **Cartes** : Leaflet 1.9.4 (tuiles OpenStreetMap France)
- **Graphiques** : Chart.js 4.4.8
- **CSS** : Custom properties uniquement. Dark mode via `prefers-color-scheme`.
- **Icones** : SVG inline + emojis (aucune dependance externe pour les icones)
- **Deploiement** : GitHub Actions -> GitHub Pages (branche `pages`)

## Sources de donnees

1. **Prix quotidiens** : `data.economie.gouv.fr/.../prix-carburants-quotidien/exports/xlsx`
   - Un fichier Excel avec une ligne par station/carburant (contient des doublons)
   - Colonnes cles : id, Code postal, ville, adresse, geom, Prix, Carburant, Mise a jour
2. **Flux instantane** : `data.economie.gouv.fr/.../prix-des-carburants-en-france-flux-instantane-v2/exports/xlsx`
   - Un fichier Excel avec une ligne par station, une colonne par carburant
   - Toujours plus recent que le quotidien quand les prix different
3. **Noms de stations** : OpenStreetMap via Overpass API (`ref:FR:prix-carburants`)

## Pipeline de donnees (pipeline/)

Orchestration dans `pipeline/main.py` :

1. `cleanup_old_files()` (cleanup.py) : supprime les fichiers dataset des jours precedents
2. `download_daily_prices()` (download.py) : telecharge l'export quotidien (xlsx ~9 Mo)
3. `download_flux_prices()` (download.py) : telecharge le flux instantane (xlsx ~2.5 Mo)
4. `download_osm()` (download.py) : requete Overpass (miroir FR + fallback)
5. `build_database()` (main.py) :
   - **Phase 1** (dedup.py) : Dedoublonne le quotidien (garde le plus recent par station+carburant)
   - **Phase 2** (stations.py) : Cree les stations et injecte les prix quotidiens
   - **Phase 3** (stations.py) : Fusionne le flux instantane (cree les stations absentes du quotidien)
   - **Phase 4** (purge.py) : Purge les stations sans aucun prix (supprimees de tous les index)
   - **Phase 5** (aggregates.py) : Calcule les agregats (moyennes/min nationales/regionales/departementales)
   - Valide les prix (plage 0.01-10.0 EUR/L, arrondi 3 decimales)
6. `generate_site()` (generate.py) :
   - Concatene les CSS en `styles.{ts}.css`
   - Copie et minifie les modules JS dans `build/js/`
   - Minifie HTML, cache-bust avec timestamp
   - Genere data.json unique (pas de chunks)
   - Remplace les placeholders : `{{BUILD_DATE}}`, `{{STATION_COUNT}}`, `{{APP_JS}}`, `{{STYLES_CSS}}`, etc.

## Carburants

`["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]`

## Design system

- Police systeme (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
- Palette sobre : fond gris tres clair, surface blanche, accent bleu (`#2563eb`)
- Couleurs semantiques : vert (bon prix), ambre (moyen), rouge (cher/rupture)
- Dark mode automatique via CSS custom properties
- Pas de gradients, pas d'ombres lourdes, pas de decorations superflues
- Mobile-first : bottom nav 3 onglets sur mobile, tabs desktop en haut
- Accessibilite : skip link, aria-labels, contrast eleve, `prefers-reduced-motion`

## Fonctionnalites frontend (3 onglets)

- **Recherche** : texte (villes, adresses, CP) + geocodage OSM + geolocalisation GPS
- **Explorer** : classement par carburant/region/departement + stats nationales (Chart.js) + tableau regional triable
- **Favoris** : stations et lieux avec rayon personnalisable, drag-and-drop, meilleurs prix par lieu
- **Vehicules** : profils avec emoji, carburants, reservoir, estimation plein
- **Detail station** : carte, prix colores avec badges fraicheur (7j/15j/1mois), horaires, ruptures, alternatives, bouton favori inline
- **Refresh auto** : rechargement data.json toutes les 20 min
- **Onboarding** : carte de bienvenue avec guide des fonctionnalites

## Badges de fraicheur des prix

- Pas de badge : mis a jour depuis moins de 7 jours
- Badge ambre : mis a jour entre 7 et 14 jours
- Badge rouge : mis a jour depuis plus de 15 jours
- Badge rouge "1 mois" : mis a jour depuis plus de 30 jours
- Libelle textuel en detail station (ex: "Il y a 3 jours", "Hier", etc.)

## Conventions

- Les prix sont en EUR/L, stockes en float arrondi a 3 decimales
- Les coordonnees sont en format "lat, lon" (WGS84)
- Tous les horodatages sont en Europe/Paris
- Les IDs de station sont des chaines numeriques (ex: "78760004")
- Le texte normalise retire accents, tirets, apostrophes, met en minuscules
- Les distances affichees sont estimees route (haversine * 1.25)

## CI/CD

- Cron toutes les 5 min (`*/5 * * * *`)
- Cache OSM journalier
- Cache venv Python
- Force push sur branche `pages`
- Deploy GitHub Pages via `actions/deploy-pages@v5`

## Tests obligatoires apres modification

```bash
# 1. Validation syntaxe JS (OBLIGATOIRE avant tout commit)
for f in templates/js/*.js templates/app.js; do node -c "$f"; done

# 2. Verification concordance IDs HTML<->JS
python3 << 'EOF'
import re, glob
js = open('templates/app.js').read()
for f in glob.glob('templates/js/*.js'):
    js += open(f).read()
html = open('templates/index.html').read()
js_ids = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
html_ids = set(re.findall(r'id="([^"]+)"', html))
dynamic = {'station-map', 'sort-fuel', 'geo-sort'}
missing = js_ids - html_ids - dynamic
print(f'Missing: {missing}' if missing else 'IDs OK')
EOF

# 3. Build complet + validation
python main.py && for f in build/js/*.js; do node -c "$f"; done && node -c build/app.*.js
```

## Commandes utiles

```bash
python main.py                    # Build complet (telecharge si absent)
python -m pipeline                # Equivalent
cd build && python -m http.server 8000  # Servir localement
rm datasets/database-*.json       # Forcer re-telechargement
```
