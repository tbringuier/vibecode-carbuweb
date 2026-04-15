# Carbu'Web — Guide Claude Code

Comparateur de prix carburants en France. Site statique genere toutes les 5 min par CI (GitHub Actions → GitHub Pages). Domaine : `carbuweb.folf.fr`.

**Deux parties independantes :**
- `pipeline/` : Python, telecharge les donnees, construit `build/data.json` et `build/index.html`
- `templates/` : Source frontend (JS/CSS/HTML), jamais servi directement — copie + minification dans `build/`

---

## 1. Decider quoi modifier

| Tache | Fichiers a toucher |
|-------|--------------------|
| Nouvelle fonctionnalite UI | `templates/js/[module].js` + `templates/index.html` si nouveaux IDs + `templates/css/[vue].css` |
| Nouvelle vue / onglet | `templates/js/navigation.js` + `templates/index.html` + CSS dedie |
| Modifier le pipeline de donnees | `pipeline/[phase].py` + `pipeline/config.py` si nouvelles constantes |
| Changer la structure de data.json | `pipeline/aggregates.py` ou `stations.py` **ET** tous les modules JS qui lisent ce champ |
| Modifier les styles | `templates/css/[fichier].css` uniquement — jamais de `style=` inline |
| Ajouter une classe utilitaire generique | `templates/css/utilities.css` (prefixe `.u-*`) |
| Mettre a jour le PWA manifest | `templates/manifest.webmanifest` + `pipeline/generate.py` (copie) |
| Modifier la generation du site | `pipeline/generate.py` + verifier placeholders dans `templates/index.html` |
| Ajouter un carburant | `pipeline/config.py` (FUELS) **ET** `templates/js/state.js` (FUELS) — les deux **doivent** etre synchronises |
| Modifier les seuils de fraicheur des prix | `templates/js/freshness.js` |
| Modifier les seuils de classification prix (cheap/mid/dear) | `templates/js/state.js` (PRICE_EPS, PRICE_NEAR) |
| Modifier le rayon de recherche proximite | `templates/js/state.js` (LS.RADIUS, defaut) + `templates/js/helpers.js` (nearKm) |
| Modifier les placeholders HTML | `pipeline/generate.py` (liste exhaustive) + `templates/index.html` |

**Modules JS — responsabilites :**

| Module | Role |
|--------|------|
| `state.js` | Etat global, constantes, localStorage |
| `helpers.js` | E(), norm(), hav(), toast(), fmtKm() |
| `navigation.js` | Onglets, historique, back, favori header |
| `settings.js` | Modal parametres, rayon, refresh, syncFooter |
| `search.js` | Recherche texte + geocodage Nominatim |
| `geolocation.js` | GPS + liste stations proches + tri |
| `geo-zones.js` | Recherche par region/departement |
| `station.js` | Vue detail station |
| `explore.js` | Classement, Chart.js, tableau regional |
| `favorites.js` | Favoris adresses + stations, drag-drop |
| `vehicles.js` | Profils vehicules CRUD |
| `prices.js` | Classification prix, cache proximite, estimation plein |
| `freshness.js` | Badges fraicheur, libelles textuels |
| `map.js` | Leaflet : mkMap, mkIcon, initMap |
| `drag-drop.js` | TouchDragReorder (favoris + vehicules) |

---

## 2. Mise a jour de ce fichier (obligatoire)

**Ce fichier doit etre mis a jour a chaque modification qui change l'architecture, les conventions ou les flux de donnees.**

Cas qui declenchent une mise a jour obligatoire :
- Ajout ou suppression d'un module JS → mettre a jour le tableau des modules section 1
- Ajout d'un nouveau type de tache recurrente → ajouter une ligne dans le tableau "Decider quoi modifier"
- Nouvelle convention ou regle etablie → section 2
- Nouveau piege decouvert → section 5
- Changement de structure de `data.json` → section 3
- Nouvelle commande utile → section 6
- Nouveau placeholder HTML → section 2 (liste placeholders) + section 6

**Ne jamais laisser ce fichier desynchronise du code.** Un CLAUDE.md obsolete est pire qu'un CLAUDE.md absent.

---

## 3. Conventions strictes (jamais devier)


**Ne jamais modifier `build/`** — genere automatiquement, ecrase au prochain build.

**Pas de styles inline** — ni dans `templates/index.html`, ni dans les template strings JS (`style="..."`), ni via `el.style.x` (sauf cas exceptionnels documentes comme `drag-drop.js` qui doit positionner dynamiquement le ghost). Tout CSS doit vivre dans `templates/css/`. Pour les besoins ponctuels, utiliser les classes utilitaires de `utilities.css` (`.u-grow`, `.u-mt-05`, etc.) plutot que d'introduire un style inline.

**Pas de `var`** — uniquement `const` et `let`.

**Synchronisation FUELS obligatoire** — `pipeline/config.py` et `templates/js/state.js` doivent lister exactement les memes carburants dans le meme ordre : `["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]`.

**`innerHTML` → toujours `E()` sur contenu externe** — `E()` est dans `helpers.js`, obligatoire sur tout contenu venant de l'utilisateur, des donnees de l'API ou des noms de stations/villes.

**Pas de framework, pas de bundler, pas de npm** — vanilla JS ES modules uniquement. Pas de React, Vue, Tailwind, TypeScript, Vite, Webpack.

**Placeholders HTML** — format `{{NOM_MAJUSCULES}}` uniquement. Liste complete actuelle : `{{BUILD_DATE}}`, `{{BUILD_DATETIME_PARIS}}`, `{{BUILD_DATETIME_ISO}}`, `{{STATION_COUNT}}`, `{{FUEL_DATA_UPDATE_FOOTER_HTML}}`, `{{GIT_COMMIT_HTML}}`, `{{APP_JS}}`, `{{ICON_SVG}}`, `{{STYLES_CSS}}`. Ne pas en inventer sans les implementer dans `pipeline/generate.py`.

**Ordre CSS fixe** — `pipeline/generate.py` concatene dans cet ordre : variables → base → layout → nav → search → station → explore → favorites → vehicles → components → map → utilities. `variables.css` doit rester en tete (tokens utilises partout) et `utilities.css` en queue (overrides possibles a specificite egale). Ne pas changer cet ordre.

**Timestamps toujours Europe/Paris** — `maj_iso` en ISO 8601 avec offset Paris (`+01:00` ou `+02:00`), jamais UTC brut.

**IDs HTML ↔ JS coherents** — tout ID utilise dans JS doit exister dans `templates/index.html`. Exceptions dynamiques connues : `station-map`, `sort-fuel`, `geo-sort`.

**Settings modal = `<div role="dialog">`** — pas de balise HTML native `<dialog>`. L'ouverture/fermeture passe par toggle de la classe `.hidden`, le backdrop est un `<div class="dialog-backdrop">`. Le HTML native `<dialog>` force `display:none` en CSS et casse le toggle actuel.

**Toutes les fonctions onclick inline doivent etre exposees sur `window`** — liste maintenue dans `templates/app.js` via `Object.assign(window, {...})`. Toute nouvelle fonction appelee depuis HTML inline (`onclick="..."`) doit etre ajoutee a cette liste, sinon runtime `ReferenceError`.

---

## 4. Architecture & flux de donnees

**Flux build Python :**
```
download.py
  └── dedup.py (phase 1 : dedoublonnage quotidien)
        └── stations.py (phases 2-3 : creation + fusion flux instantane)
              └── purge.py (phase 4 : stations sans prix)
                    └── aggregates.py (phase 5 : agregats + index)
                          └── generate.py → build/
```

**Flux runtime JS :**
```
app.js (DOMContentLoaded)
  → fetch data.json → state.db
  → renderVBar() + renderFavs() + populateRegions() + populateFuels()
  → syncFooter() + initPopstate()
  → interval 20 min → refreshData()
  → interactions utilisateur → modules specialises
```

**Etat global (`state.js`) :**
- Tout l'etat passe par `state` — jamais de variable globale dans d'autres modules
- Lecture : `state.db`, `state.proxSearch`, `state.geoZone`, `state.navStack`
- Ecriture : via setters (`setFavs()`, `setVehicles()`, `setRadius()`, `setUFuels()`)
- Persistence localStorage : cles dans `LS` (constante dans state.js)

**Structure `data.json` (cles racine) :**
```
stations          {id → objet station}
region_index      {nom_region → {nom_norm, stations: [ids]}}
dept_index        {code_dept → {nom, nom_norm, region, stations: [ids]}}
cp_index          {code_postal → [ids]}
recherche_texte   {id → {texte_norm, label_affichage}}
dashboard         agregats nationaux + regionaux + departementaux (Chart.js)
meta              timestamps build, stats fusion flux
stats             prix min par carburant (national/regional/departemental)
```

**Objet station :**
```json
{
  "nom_osm": "Shell",
  "adresse": "123 Rue Main",
  "ville": "Paris",
  "code_postal": "75001",
  "region": "Ile-de-France",
  "departement": "75",
  "lat": 48.85,
  "lon": 2.35,
  "horaires": {"automate_24_24": false, "jours": {"Lundi": "08:00-22:00"}},
  "carburants_disponibles": {
    "Gazole": {"prix": "1.450", "date_maj": "2026-04-08", "maj_iso": "2026-04-08T12:00:00+02:00"}
  },
  "carburants_en_rupture": {"E85": {"debut": "2026-04-01", "motif": "..."}}
}
```

---

## 5. Workflow de validation (obligatoire avant tout commit)

Executer dans l'ordre. Stopper et corriger si une etape echoue.

```bash
# Etape 1 — Syntaxe JS (OBLIGATOIRE)
for f in templates/js/*.js templates/app.js; do node -c "$f" && echo "OK: $f"; done

# Etape 2 — Tests pipeline (OBLIGATOIRE)
python3 -m unittest tests.test_pipeline_freshness -v

# Etape 3 — Coherence IDs HTML<->JS (OBLIGATOIRE)
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
print(f'ERREUR IDs manquants: {missing}' if missing else 'IDs OK')
EOF

# Etape 4 — Build complet + syntaxe JS genere (OBLIGATOIRE)
python main.py && for f in build/js/*.js; do node -c "$f"; done && node -c build/app.*.js

# Etape 5 — Smoke test local (recommande pour changements UI)
cd build && python -m http.server 8000
```

---

## 6. Pieges connus & anti-patterns

**JS — zones de vigilance :**

- **`state.chartsInit`** : les charts Chart.js s'initialisent une seule fois (flag dans `explore.js`). Si tu changes la structure de `renderDash()`, verifier que le flag est reset si necessaire.
- **`nearCache`** dans `prices.js` : cache des stations proches par rayon. Invalider avec `clearNearCache()` si le rayon ou les donnees changent.
- **`TouchDragReorder`** : s'attache au DOM au moment du rendu des listes. Si tu re-renders la liste des favoris ou vehicules, reconstruire l'instance via `state.favDnD` / `state.vehicleDnD`.
- **Nominatim (geocodage)** : API externe rate-limited. Ne pas appeler en boucle. La recherche est deja debouncee (400ms) et utilise AbortController.
- **`window.*`** : toutes les fonctions appelees depuis HTML inline (`onclick="..."`) sont exposees sur `window` dans `app.js`. Toute nouvelle fonction appelee depuis HTML doit etre ajoutee la.

**Python — zones de vigilance :**

- **Correlation flux↔quotidien** dans `stations.py` : utilise 2 niveaux de precision lat/lon (5 et 3 decimales). Ne jamais changer la cle de correlation sans adapter les deux niveaux.
- **`parse_price_cell()`** dans `helpers.py` : parseur canonique pour les prix quotidiens et le flux instantane. Ne pas reintroduire de `float(...)` direct sur une cellule Excel brute.
- **`purge_infinity()`** dans `helpers.py` : appeler avant toute serialisation JSON. Les prix non renseignes sont `float('inf')` en interne — pas serialisable directement.
- **Validation prix** : 0.01–10.0 EUR/L. Les stations hors plage sont ignorees silencieusement. Ne pas elargir sans raison.
- **`price_entry_should_replace()`** dans `helpers.py` : comparateur unique de fraicheur. Une entree avec horodatage complet prime sur une date seule le meme jour ; a egalite stricte, le flux peut primer si `prefer_incoming_on_tie=True`.
- **`flux_replaces_daily_entry()`** : wrapper de compatibilite pour le cas flux-vs-quotidien. Garder la regle "le flux fait foi a egalite de timestamp".
- **DST** : les comparaisons de timestamps utilisent l'offset Europe/Paris — prendre garde aux transitions heure ete/hiver si on modifie la logique de comparaison.

**CSS/Build — zones de vigilance :**

- **Ordre CSS fixe** : `variables.css` doit etre en premier (custom properties utilisees partout), `utilities.css` en dernier pour permettre les overrides a specificite egale. Changer l'ordre casse le design.
- **Cache-bust** : `generate.py` nettoie les anciens fichiers timestamps automatiquement. Ne pas supprimer manuellement des fichiers `build/app.*.js` ou `build/styles.*.css`.
- **Minification JS** : `generate.py` retire les commentaires `//` et lignes vides. Ne pas mettre de code fonctionnel apres `//` sur la meme ligne.
- **Assets statiques copies** : `sw.js`, `CNAME`, `manifest.webmanifest`. Ajouter un nouveau asset non-template ? L'ajouter dans la boucle `for extra in (...)` de `generate.py`.
- **`color-mix(in oklab, ...)`** : utilise dans le design system 2026. Support navigateurs modernes uniquement (Safari 16.2+, Chrome 111+, Firefox 113+). Ne pas l'utiliser dans des cas critiques hors ces navigateurs.

---

## 7. Reference rapide

**Commandes courantes :**
```bash
python main.py                       # Build complet (retelecharge quotidien + flux, reconstruit la base)
python -m pipeline                   # Equivalent
cd build && python -m http.server 8000  # Servir localement
rm datasets/prix-carburant-*.xlsx    # Forcer re-telechargement donnees
rm datasets/osm_mapping-*.json       # Forcer reconstruction mapping OSM local
```

**Sources de donnees :**
- Prix quotidiens : XLSX ~9 Mo, une ligne par station/carburant (avec doublons)
- Flux instantane : XLSX ~2.5 Mo, une ligne par station (toujours plus recent)
- OSM : Overpass API, cache local journalier si `datasets/osm_mapping-{TODAY}.json` existe deja

**Design system :**
- Accent : `#2563eb` (bleu)
- Semantique : vert (bon prix), ambre (moyen/avertissement), rouge (cher/rupture)
- Dark mode : `prefers-color-scheme` via custom properties dans `variables.css`
- Mobile-first : bottom nav sur mobile, tabs en haut sur desktop

**Badges fraicheur :**
- < 7 jours : aucun badge
- 7–14 jours : badge ambre
- 15–29 jours : badge rouge
- 30+ jours : badge rouge "1 mois"

**Prix :**
- Unite : EUR/L, float arrondi 3 decimales
- Cheap : ≤ min_local + 0.0005 EUR
- Mid : ≤ min_local + 0.030 EUR
- Dear : au-dela

**CI/CD :**
- Cron toutes les 5 min, cache OSM journalier uniquement (pas de cache GitHub Actions sur les exports carburants), force push branche `pages`
- Concurrence : les runs precedents sont annules automatiquement
