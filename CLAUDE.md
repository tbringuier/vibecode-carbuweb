# Carbu'Web — Guide Claude Code

Comparateur de prix carburants en France. Site statique regenere par CI (cron `*/5` demande, mais GitHub n'execute en pratique que ~3 runs/jour) (GitHub Actions → GitHub Pages). Domaine : `carbuweb.folf.fr`.

**Deux parties independantes :**
- `pipeline/` : Python, telecharge les donnees, construit `build/data.json` et `build/index.html`
- `templates/` : Source frontend (JS/CSS/HTML), jamais servi directement — copie + minification dans `build/`

**Historique des prix** : branche git orpheline `history` (donnees seulement), mise a jour par `pipeline/history.py` a chaque build et servie sous `build/history/`. Sources : archives annuelles officielles (2007→aujourd'hui, import retroactif progressif) + prix du build courant.

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
| Modifier le workflow CI / deploiement | `.github/workflows/build.yml` (jobs `build` puis `deploy` separes) |
| Modifier les placeholders HTML | `pipeline/generate.py` (liste exhaustive) + `templates/index.html` |
| Modifier l'historique (sources, fusion, zones, garde-fous) | `pipeline/history.py` + constantes `HISTORY_*` de `pipeline/config.py` + `tests/test_history.py` |
| Changer le format des fichiers d'historique | `pipeline/history.py` (incrementer `HISTORY_SCHEMA`, `README_TEXT`) **ET** decodeurs de `templates/js/history.js` |
| Modifier l'affichage de l'historique (graphiques, periodes, tableaux) | `templates/js/history.js` + `templates/css/history.css` |
| Modifier le format d'affichage des prix | `templates/js/helpers.js` (`fmtP`, `fmtEur`, `fmtCts`) + `templates/js/prices.js` (`ptag`) — jamais de `toFixed` sur un prix affiche |

**Modules JS — responsabilites :**

| Module | Role |
|--------|------|
| `state.js` | Etat global, constantes, localStorage (parse JSON tolerant aux donnees corrompues) |
| `helpers.js` | E(), jsStr(), norm(), hav(), toast(), fmtKm() |
| `navigation.js` | Onglets, pile navStack (types home/prox/geo/station), back, favori header |
| `settings.js` | Modal parametres, rayon, refresh, syncFooter |
| `search.js` | Recherche texte + geocodage Nominatim |
| `geolocation.js` | GPS + liste stations proches + tri |
| `geo-zones.js` | Recherche par region/departement |
| `station.js` | Vue detail station |
| `explore.js` | Classement, Chart.js, tableau regional |
| `favorites.js` | Favoris adresses + stations, drag-drop |
| `vehicles.js` | Profils vehicules CRUD |
| `prices.js` | Classification prix, cache proximite, estimation plein, `ptag()` (etiquette prix des listes) |
| `history.js` | Historique : fiche station (courbe, indicateurs, comparaison departement), evolution par zone (Explorer), tendance 7 j (teaser) |
| `freshness.js` | Badges fraicheur, libelles textuels, isExpired(), hasActiveFuel() |
| `map.js` | Leaflet : mkMap, mkIcon (pins SVG inline, zero requete externe), initMap |
| `drag-drop.js` | TouchDragReorder (favoris + vehicules) |

---

## 2. Mise a jour de ce fichier (obligatoire)

**Ce fichier doit etre mis a jour a chaque modification qui change l'architecture, les conventions ou les flux de donnees.**

Cas qui declenchent une mise a jour obligatoire :
- Ajout ou suppression d'un module JS → mettre a jour le tableau des modules section 1
- Ajout d'un nouveau type de tache recurrente → ajouter une ligne dans le tableau "Decider quoi modifier"
- Nouvelle convention ou regle etablie → section 3
- Nouveau piege decouvert → section 6
- Changement de structure de `data.json` ou de la branche `history` → section 4
- Nouvelle commande utile → section 7
- Nouveau placeholder HTML → section 3 (liste placeholders) + section 7

**Ne jamais laisser ce fichier desynchronise du code.** Un CLAUDE.md obsolete est pire qu'un CLAUDE.md absent.

---

## 3. Conventions strictes (jamais devier)


**Ne jamais modifier `build/`** — genere automatiquement, ecrase au prochain build.

**Pas de styles inline** — ni dans `templates/index.html`, ni dans les template strings JS (`style="..."`), ni via `el.style.x` (sauf cas exceptionnels documentes comme `drag-drop.js` qui doit positionner dynamiquement le ghost). Tout CSS doit vivre dans `templates/css/`. Pour les besoins ponctuels, utiliser les classes utilitaires de `utilities.css` (`.u-grow`, `.u-mt-05`, etc.) plutot que d'introduire un style inline.

**Pas de `var`** — uniquement `const` et `let`.

**Synchronisation FUELS obligatoire** — `pipeline/config.py` et `templates/js/state.js` doivent lister exactement les memes carburants dans le meme ordre : `["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]`. Chaque carburant a aussi un jeton couleur `--fuel-<nom en minuscules>` (clair + sombre, `variables.css`) et une classe `.sw-<nom>` (`history.css`).

**Prix affiches au format francais** — toujours via `fmtP()` / `fmtEur()` (3 decimales, virgule : `1,789 €`) et `fmtCts()` pour les ecarts (`+1,2 ct`). Les etiquettes prix des listes passent par `ptag()` (`prices.js`). Ne pas afficher `entry.prix` brut (`2.04` au lieu de `2,040`).

**Couleurs des graphiques** — une teinte fixe par carburant (`fuelColor()` lit `--fuel-*`), identique dans tous les graphiques ; la palette est validee daltonisme dans l'ordre FUELS, ne pas la permuter. Pas de camembert, pas de double axe ; tout graphique a une alternative tableau.

**`innerHTML` → toujours `E()` sur contenu externe** — `E()` est dans `helpers.js`, obligatoire sur tout contenu venant de l'utilisateur, des donnees de l'API ou des noms de stations/villes.

**Attributs `onclick` inline → toujours `jsStr()` sur texte externe** — `jsStr()` est dans `helpers.js`. Tout nom/label externe (Nominatim, favoris, noms de zones) interpole dans un litteral JS a l'interieur d'un attribut `onclick="..."` doit passer par `jsStr()` (echappe `\`, `'`, `"`, `<`, `>`). Un simple `replace(/'/g, "\\'")` est insuffisant : un `"` dans le nom casse l'attribut HTML (XSS).

**Pas de framework, pas de bundler, pas de npm** — vanilla JS ES modules uniquement. Pas de React, Vue, Tailwind, TypeScript, Vite, Webpack.

**Placeholders HTML** — format `{{NOM_MAJUSCULES}}` uniquement. Liste complete actuelle : `{{BUILD_DATE}}`, `{{BUILD_DATETIME_PARIS}}`, `{{BUILD_DATETIME_ISO}}`, `{{STATION_COUNT}}`, `{{FUEL_DATA_UPDATE_FOOTER_HTML}}`, `{{GIT_COMMIT_HTML}}`, `{{APP_JS}}`, `{{ICON_SVG}}`, `{{STYLES_CSS}}`. Ne pas en inventer sans les implementer dans `pipeline/generate.py`.

**Ordre CSS fixe** — `pipeline/generate.py` concatene dans cet ordre : variables → base → layout → nav → search → station → explore → favorites → vehicles → history → components → map → utilities. `variables.css` doit rester en tete (tokens utilises partout) et `utilities.css` en queue (overrides possibles a specificite egale). Ne pas changer cet ordre.

**Timestamps toujours Europe/Paris** — `maj_iso` en ISO 8601 avec offset Paris (`+01:00` ou `+02:00`), jamais UTC brut.

**IDs HTML ↔ JS coherents** — tout ID utilise dans JS doit exister dans `templates/index.html`. Exceptions dynamiques connues : `station-map`, `sort-fuel`, `geo-sort`, `osm-slot`, `hist-body`, `hist-chart`, `zone-chart`.

**Historique : la branche `history` n'est ecrite que par la CI** — jamais de commit manuel dessus ; la reconstruire si besoin avec `python -m pipeline.history backfill …` puis laisser la CI publier.

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
                                └── history.py (phase 6 : branche history → build/history/, jamais bloquante)
```

**Phase historique (`pipeline/history.py`) :**
```
archives annuelles (annee courante + precedente si Last-Modified a change,
                    puis HISTORY_BACKFILL_PER_RUN annees manquantes, de la plus recente a 2007)
  → remplacent les releves des jours qu'elles couvrent (elles font foi)
prix du build (database du jour)
  → completent la fin de serie (jour = date UTC de maj_iso, convention des archives)
garde-fou : stations jamais supprimees, releves −1 % max, sinon rien n'est ecrit
moyennes de zone recalculees sur les seules plages modifiees (tableaux de differences)
  → fichiers station modifies + zones + index.json, puis copie dans build/history/
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

**Branche `history` (servie sous `build/history/`) :**
```
index.json                         manifeste : v, fuels, ttl_days, keepalive_days, first_day, last_day,
                                   zones_until, stations, records, annual{annee: last_modified…},
                                   regions{nom: slug}, depts{code: {nom, region}}
stations/<2 derniers chiffres>/<id>.json
    {"v":1,"id":…,"m":{"n","a","cp","c"},"f":{"Gazole":[j0,p0,dj1,dp1,…]}}
    j = jours depuis 1970-01-01, p = prix en millimes, deltas apres le premier couple ;
    resolution journaliere (prix de cloture), entree seulement si le prix change
    ou reconfirmation apres 30 j ; un releve vaut au plus 45 j
zones/fr.json | zones/region/<slug>.json | zones/dept/<code>.json
    {"d0":jour,"len":n,"f":{"Gazole":{"a":[moyenne millimes, deltas],"n":[nb stations, deltas]}}}
README.md, .gitattributes          documentation du format (non publies sur le site)
```
CI : un commit par build qui change des donnees ; au-dela de `HISTORY_KEEP_COMMITS` (30) commits, les plus anciens sont fusionnes en un commit racine (memes arbres) puis `push --force-with-lease`. La branche reste a la taille des donnees (~12 Mo bruts/an) ; tout est reconstructible depuis les archives officielles.

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

# Etape 2 — Tests pipeline + historique (OBLIGATOIRE)
python3 -m unittest tests.test_pipeline_freshness tests.test_history -v

# Etape 3 — Coherence IDs HTML<->JS (OBLIGATOIRE)
python3 << 'EOF'
import re, glob
js = open('templates/app.js').read()
for f in glob.glob('templates/js/*.js'):
    js += open(f).read()
html = open('templates/index.html').read()
js_ids = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
html_ids = set(re.findall(r'id="([^"]+)"', html))
dynamic = {'station-map', 'sort-fuel', 'geo-sort', 'osm-slot', 'hist-body', 'hist-chart', 'zone-chart'}
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
- **Pile de navigation (`state.navStack`)** : chaque entree decrit l'ecran QUITTE (`{type:'home'}`, `{type:'prox',lat,lon,label,customR}`, `{type:'geo',gType,name}`, `{type:'station',sid}`). `pushNav` est ignore pendant une restauration (`state.isRestoring`). Si tu ajoutes un ecran, empile son contexte au depart ET gere son type dans `initPopstate`.
- **Zones geo plafonnees** : `searchGeo` n'affiche que les `GEO_MAX` (200) stations les moins cheres d'une region/departement (DOM + Leaflet s'ecroulent au-dela sur mobile). Le widget « Meilleurs prix » et le compteur utilisent la liste complete.
- **Favoris stations absentes** : un favori station absent de `data.json` n'est PAS supprime (la station peut reapparaitre au prochain build) — il est rendu inerte avec une note. Ne pas reintroduire de filtre destructif dans `renderFavs`.
- **`LS.fl` (carbuFuels)** : cle heritee d'un ancien filtre carburants manuel, sans UI. `applyV()` la purge systematiquement — ne pas la relire.
- **Recherche en deux temps** : `doSearch` rend les resultats locaux immediatement et remplit `#osm-slot` quand Nominatim repond. Toute retouche doit preserver le controle `sig.aborted` avant d'ecrire dans le DOM.
- **Historique asynchrone** : `renderStationHistory` / `renderZoneHistory` chargent des fichiers statiques puis ecrivent dans le DOM. Garder les jetons `state.histReq` / `state.zoneReq` et le controle `data-sid` : l'utilisateur peut avoir change de station entre-temps. Les reponses sont en cache (`state.histCache`), vide par `refreshData()`.
- **Jours de l'historique** : numeros de jour UTC (`Date.UTC(...) / 86400000`), formates avec `timeZone: 'UTC'`. Le prix live de `data.json` prolonge la courbe jusqu'a aujourd'hui (`stationDaily(..., live)`), avec la meme convention de date que le pipeline (date UTC de `maj_iso`).
- **Moyennes de zone** : les jours trop peu couverts (< 25 % du nombre median de stations) sont masques (`zoneDaily`) — evite des moyennes sur 3 stations en bord d'import.

**Python — zones de vigilance :**

- **Correlation flux↔quotidien** dans `stations.py` : utilise 2 niveaux de precision lat/lon (5 et 3 decimales). Ne jamais changer la cle de correlation sans adapter les deux niveaux.
- **`parse_price_cell()`** dans `helpers.py` : parseur canonique pour les prix quotidiens et le flux instantane. Ne pas reintroduire de `float(...)` direct sur une cellule Excel brute.
- **`purge_infinity()`** dans `helpers.py` : appeler avant toute serialisation JSON. Les prix non renseignes sont `float('inf')` en interne — pas serialisable directement.
- **Validation prix** : 0.01–10.0 EUR/L. Les stations hors plage sont ignorees silencieusement. Ne pas elargir sans raison.
- **`price_entry_should_replace()`** dans `helpers.py` : comparateur unique de fraicheur. Une entree avec horodatage complet prime sur une date seule le meme jour ; a egalite stricte, le flux peut primer si `prefer_incoming_on_tie=True`.
- **`flux_replaces_daily_entry()`** : wrapper de compatibilite pour le cas flux-vs-quotidien. Garder la regle "le flux fait foi a egalite de timestamp".
- **Mapping OSM avec secours** : `resolve_osm_mapping()` (`download.py`) prend le mapping du jour s'il existe, sinon interroge Overpass (`OVERPASS_ENDPOINTS`, `OVERPASS_MAX_ATTEMPTS`), sinon retombe sur le mapping precedent le plus recent. `cleanup_old_files()` conserve volontairement ce dernier mapping precedent. Ne jamais copier le secours sous le nom du jour (le build suivant doit retenter Overpass). `overpass.openstreetmap.fr` est exclu : 403 systematique depuis les runners GitHub.
- **DST** : les comparaisons de timestamps utilisent l'offset Europe/Paris — prendre garde aux transitions heure ete/hiver si on modifie la logique de comparaison.
- **Horodatages des exports XLSX decales** : data.economie.gouv.fr ajoute `+01:00`/`+02:00` a des heures deja locales (00:01 dans les archives devient 01:01+01:00). L'historique prend donc la **date UTC** de `maj_iso` (`snapshot_day`) pour retomber sur le jour des archives. Ne pas « corriger » vers la date locale.
- **Archives annuelles** : prix en euros (`"1.789"`) depuis ~2022, en millimes (`"1789"`) avant, et `maj` avec espace + microsecondes en 2007 — `parse_annual_price()` gere les deux. Fichier courant republie chaque nuit vers 23:40 UTC : sa date Last-Modified (UTC) borne la plage qu'il fait foi.
- **Memoire de l'historique** : les series restent encodees en memoire (`HistoryStore`), decodees seulement pour les paires modifiees (`decode_series` via `itertools.accumulate`). Ne pas tout decoder en tuples au chargement (x7 en memoire).
- **Phase historique non bloquante** : `run_history_phase()` attrape tout. Une erreur laisse la branche intacte (rien n'est ecrit avant la fin des calculs et du garde-fou) et le site sort avec l'historique precedent.

**CSS/Build — zones de vigilance :**

- **Ordre CSS fixe** : `variables.css` doit etre en premier (custom properties utilisees partout), `utilities.css` en dernier pour permettre les overrides a specificite egale. Changer l'ordre casse le design.
- **Cache-bust** : `generate.py` nettoie les anciens fichiers timestamps automatiquement. Ne pas supprimer manuellement des fichiers `build/app.*.js` ou `build/styles.*.css`.
- **Minification JS** : `generate.py` retire les commentaires `//` et lignes vides. Ne pas mettre de code fonctionnel apres `//` sur la meme ligne.
- **Assets statiques copies** : `sw.js`, `CNAME`, `manifest.webmanifest`, `icon.svg` (le manifest reference `icon.svg` sans cache-bust — ne pas retirer cette copie). Ajouter un nouveau asset non-template ? L'ajouter dans la boucle `for extra in (...)` de `generate.py`.
- **`build/history/` hors miroir `pages`** : le step CI du miroir exclut `history/` (sinon tout l'historique serait re-televerse a chaque build). Il reste dans l'artefact GitHub Pages.
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
CARBUWEB_HISTORY=0 python main.py    # Build sans la phase historique (rapide, hors ligne cote archives)
python -m pipeline.history           # Mettre a jour l'historique depuis la database du jour (+ archives a jour)
python -m pipeline.history backfill 2019 2020 [--zip 2020=chemin.zip]   # Importer des annees precises
python -m pipeline.history rebuild-zones   # Recalculer toutes les moyennes de zone
```

**Variables d'environnement historique :** `CARBUWEB_HISTORY_DIR` (depot, defaut `.history/`, checkout de la branche en CI), `CARBUWEB_HISTORY` (`0` desactive), `CARBUWEB_HISTORY_BACKFILL` (annees passees importees par build, defaut 2).

**Sources de donnees :**
- Prix quotidiens : XLSX ~9 Mo, une ligne par station/carburant (avec doublons) — dernier prix seulement, pas l'historique de la journee
- Archives annuelles : `donnees.roulez-eco.fr/opendata/annee/AAAA`, zip 10–35 Mo (XML ISO-8859-1 ~380 Mo), tous les changements de prix de l'annee ; annee en cours republiee chaque nuit
- Flux instantane : XLSX ~2.5 Mo, une ligne par station (toujours plus recent)
- OSM : Overpass API (3 instances en rotation), cache local journalier si `datasets/osm_mapping-{TODAY}.json` existe deja, repli sur le mapping precedent si Overpass est injoignable

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
- Cron `*/5 * * * *` mais GitHub throttle fortement les crons : ~1 run toutes les 5-9 h en pratique. Pour forcer une mise a jour : `gh workflow run "Build & Deploy"`
- Job `build` : telechargements + `main.py` + force push branche `pages` + `upload-pages-artifact`. Job `deploy` (separe, `needs: build`) : `deploy-pages` avec une seconde tentative apres 60 s — ne pas refusionner les deux jobs (erreurs intermittentes « No artifacts named github-pages were found »)
- Cache GitHub Actions uniquement pour le mapping OSM (`actions/cache/restore` + `restore-keys` pour recuperer celui de la veille, puis `actions/cache/save` explicite seulement si le mapping du jour existe). Pas de cache sur les exports carburants
- Concurrence : les runs precedents sont annules automatiquement (sans risque pour l'historique : le push est atomique et le run suivant reimporte les memes sources)
- Historique : step « Recuperer la branche d'historique » (clone `--depth 35` dans `.history/`, ou `git init` au premier run) → `CARBUWEB_HISTORY_DIR=.history` pour le build → step « Publier l'historique » (commit, consolidation glissante, `push --force-with-lease`, `continue-on-error`)
