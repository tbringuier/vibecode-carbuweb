# Carbu'Web — Guide Claude Code

Comparateur de prix carburants en France. Site statique regenere par CI (cron `*/5` demande, mais GitHub n'execute en pratique que ~3 runs/jour) (GitHub Actions → GitHub Pages). Domaine : `carbuweb.folf.fr`.

**Deux parties independantes :**
- `pipeline/` : Python, telecharge les donnees, construit la base du jour puis `build/` (donnees navigateur compactes + site)
- `templates/` : Source frontend (JS/CSS/HTML), jamais servi directement — copie + minification dans `build/`

**Historique des prix** : branche git orpheline `history` (donnees seulement), mise a jour par `pipeline/history.py` a chaque build et servie sous `build/history/`. Sources : archives annuelles officielles **depuis 2007** (toutes les annees manquantes importees au build suivant, dans un budget de temps) + prix du build courant.

**Objectifs produit** : interface evidente pour n'importe qui (libelles en clair, pas de jargon, etat visible sans couleur seule), economie de donnees mobiles, aucun traceur ni cookie.

---

## 1. Decider quoi modifier

| Tache | Fichiers a toucher |
|-------|--------------------|
| Nouvelle fonctionnalite UI | `templates/js/[module].js` + `templates/index.html` si nouveaux IDs + `templates/css/[vue].css` + action dans `templates/app.js` (tables `CLICK`/`CHANGE`/`INPUT`) |
| Nouvel ecran (route) | `templates/js/navigation.js` (`parseHash` + constructeur de hash) + vue enregistree dans `app.js` (`registerViews`) |
| Modifier le pipeline de donnees | `pipeline/[phase].py` + `pipeline/config.py` si nouvelles constantes |
| Changer les donnees servies au navigateur | `pipeline/export.py` (format v3) **ET** `templates/js/data.js` (hydratation) + `tests/test_export.py` + `tests/front.test.mjs` |
| Changer la base complete (database-*.json) | `pipeline/aggregates.py` ou `stations.py` ; verifier `export.py` et `history.py` qui la lisent |
| Modifier les styles | `templates/css/[fichier].css` uniquement — jamais de `style=` inline |
| Ajouter une classe utilitaire generique | `templates/css/utilities.css` (prefixe `.u-*`) |
| Mettre a jour le PWA manifest | `templates/manifest.webmanifest` + `pipeline/generate.py` (copie) |
| Modifier la generation du site | `pipeline/generate.py` + verifier placeholders dans `templates/index.html` |
| Ajouter un carburant | `pipeline/config.py` (ALL_FUELS) **ET** `templates/js/state.js` (FUELS) — les deux **doivent** etre synchronises (+ jeton `--fuel-*`, classe `.sw-*`) |
| Modifier les seuils de fraicheur des prix | `templates/js/freshness.js` |
| Modifier les seuils de classification prix (cheap/mid/dear) | `templates/js/state.js` (PRICE_EPS, PRICE_NEAR) + `templates/js/helpers.js` (`NEAR_KM`, voisinage) |
| Modifier le rayon de recherche | `templates/js/state.js` (RADIUS_*) ; curseur inline : `filters.js` (`radiusControl`) + `near.js` |
| Modifier le selecteur de carburants / vehicule | `templates/js/filters.js` (`fuelChips()`, **unique** composant de choix des carburants, utilise partout) |
| Modifier « Y aller » (applications de navigation) | `templates/js/directions.js` (+ reglage dans `settings.js`) |
| Modifier les cartes (fonds plan / satellite) | `templates/js/map.js` |
| Modifier le workflow CI / deploiement | `.github/workflows/build.yml` (jobs `build` puis `deploy` separes) |
| Modifier les placeholders HTML | `pipeline/generate.py` (liste exhaustive) + `templates/index.html` |
| Modifier l'historique (sources, fusion, zones, garde-fous, import retroactif) | `pipeline/history.py` + constantes `HISTORY_*` de `pipeline/config.py` + `tests/test_history.py` |
| Changer le format des fichiers d'historique | `pipeline/history.py` (incrementer `HISTORY_SCHEMA`, `README_TEXT`) **ET** decodeurs de `templates/js/history.js` |
| Modifier l'affichage de l'historique (graphiques, periodes, tableaux) | `templates/js/history.js` + `templates/css/history.css` |
| Modifier le format d'affichage des prix | `templates/js/helpers.js` (`fmtP`, `fmtEur`, `fmtCts`) + `templates/js/prices.js` (`ptag`) — jamais de `toFixed` sur un prix affiche |
| Ajouter une preference persistee | `templates/js/state.js` (cle `LS`, lecture validee, setter, `exportPrefs`/`importPrefs`) |

**Modules JS — responsabilites :**

| Module | Role |
|--------|------|
| `app.js` | Point d'entree : demarrage, tables d'actions (delegation d'evenements), vue d'accueil, fenetres (Echap, fond), raccourcis clavier, rafraichissement au retour |
| `state.js` | Constantes, preferences persistees (lecture validee, ecriture tolerante aux erreurs, sauvegarde/restauration), etat d'execution |
| `data.js` | Chargement econome (`data.json` + `stations.<hash>.json`, requetes conditionnelles), hydratation, index derives (recherche, codes postaux, zones), statistiques par zone |
| `helpers.js` | `E()`, `norm()`, formats FR (prix, centimes, km, dates relatives), `hav()`, `titleCase()`, `toast()` (avec action « Annuler »), icones SVG |
| `navigation.js` | Routeur par fragment d'URL (`#s/…`, `#p/…`, `#z/…`, `#explorer`, `#favoris`), retour + restauration du defilement, en-tete des ecrans de detail, partage |
| `filters.js` | Selecteur unique de carburants (puces, selection multiple) + puces vehicules, curseur de rayon |
| `lists.js` | Lignes de liste partagees, tri, pagination « Voir plus », bandeau « Meilleurs prix », marqueurs de carte |
| `search.js` | Recherche accueil (zones + stations locales, puis Nominatim), recents |
| `near.js` | Geolocalisation + ecran « autour d'un point » (rayon inline, tri) |
| `zone.js` | Ecran region / departement (navigation entre departements) |
| `station.js` | Fiche station : « Y aller », prix + rang local + ecart a la moyenne, alternatives, carte, historique |
| `explore.js` | Explorer : prix moyens nationaux, filtres (carburants + zone), classement, tableau regional |
| `favorites.js` | Favoris lieux + stations (avec « Y aller »), reordonnancement (glisser ou fleches), suppression annulable |
| `vehicles.js` | Profils vehicules (CRUD) dans les reglages |
| `settings.js` | Reglages : application de navigation, theme, fond de carte, economie de donnees, sauvegarde/restauration/effacement, rafraichissement des prix, pied de page |
| `dialog.js` | Fenetres modales : ouverture/fermeture, pile, focus piege, retour du focus |
| `directions.js` | « Y aller » : liens Waze / Google Maps / Plans (Apple) / geo: (Android), choix memorise, fenetre de choix |
| `prices.js` | Voisinage (cache), rang local, classe de prix, meilleur prix, plein estime, `ptag()` |
| `history.js` | Historique : une courbe par carburant choisi (station + moyenne du departement en pointilles), evolution par zone (Explorer), tableaux de synthese, tendance 7 j |
| `freshness.js` | Anciennete des prix : `isExpired()`, `visiblePrice()`, badges, libelles |
| `map.js` | Cartes Leaflet (chargees a la demande), bouton Plan / Satellite (photos IGN), pins SVG inline, « Y aller » dans les bulles, carte differee en economie de donnees |
| `vendor.js` | Chargement a la demande de Leaflet et Chart.js (SRI) |
| `drag-drop.js` | TouchDragReorder (favoris + vehicules) |

---

## 2. Mise a jour de ce fichier (obligatoire)

**Ce fichier doit etre mis a jour a chaque modification qui change l'architecture, les conventions ou les flux de donnees.**

Cas qui declenchent une mise a jour obligatoire :
- Ajout ou suppression d'un module JS → mettre a jour le tableau des modules section 1
- Ajout d'un nouveau type de tache recurrente → ajouter une ligne dans le tableau "Decider quoi modifier"
- Nouvelle convention ou regle etablie → section 3
- Nouveau piege decouvert → section 6
- Changement du format des donnees navigateur ou de la branche `history` → section 4
- Nouvelle commande utile → section 7
- Nouveau placeholder HTML → section 3 (liste placeholders) + section 7

**Ne jamais laisser ce fichier desynchronise du code.** Un CLAUDE.md obsolete est pire qu'un CLAUDE.md absent.

---

## 3. Conventions strictes (jamais devier)

**Ne jamais modifier `build/`** — genere automatiquement, ecrase au prochain build.

**Pas de styles inline** — ni dans `templates/index.html`, ni dans les template strings JS (`style="..."`), ni via `el.style.x` (seule exception documentee : `drag-drop.js` positionne le fantome). Tout CSS vit dans `templates/css/`. Besoins ponctuels : classes `.u-*` de `utilities.css`.

**Pas de gestionnaire inline, rien sur `window`** — toutes les interactions passent par delegation (`app.js`) : un element porte `data-act="nom"` (clic), `data-change="nom"` (evenement change) ou `data-input="nom"` (saisie), et `nom` est resolu dans les tables `CLICK` / `CHANGE` / `INPUT`. Les parametres passent par `data-*` (lus via `dataset`, donc jamais interpretes comme du code). Ne jamais reintroduire `onclick="..."`.

**Navigation = liens `<a href="#…">`** — toute destination (station, lieu, zone, onglet) est un vrai lien construit avec `stationHash()`, `nearHash()`, `zoneHash()` ; `app.js` intercepte le clic gauche simple et appelle `go()`. Clic molette / Ctrl+clic ouvrent un nouvel onglet (lien profond).

**Pas de `var`** — uniquement `const` et `let`.

**Synchronisation FUELS obligatoire** — `pipeline/config.py` (ALL_FUELS) et `templates/js/state.js` (FUELS) listent exactement les memes carburants dans le meme ordre : `["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]`. Chaque carburant a un jeton couleur `--fuel-<nom en minuscules>` (clair + sombre + `[data-theme="dark"]`, `variables.css`) et une classe `.sw-<nom>` (`history.css`). Le format v3 transmet les carburants par index dans cet ordre.

**Prix affiches au format francais** — toujours via `fmtP()` / `fmtEur()` (3 decimales, virgule : `1,789 €`) et `fmtCts()` pour les ecarts (`+1,2 ct`). Les etiquettes prix des listes passent par `ptag()` (`prices.js`).

**Texte externe → toujours `E()`** — `E()` (`helpers.js`) echappe `& < > " '` ; obligatoire sur tout contenu venant de l'utilisateur, des donnees, de Nominatim ou des noms de stations/villes, y compris dans les attributs `data-*` et `aria-label`.

**Etat jamais porte par la seule couleur** — prix : couleur + rang / ecart ecrit ; puces : `aria-pressed` + coche ✓ ; variations : fleche ▲▼ + signe.

**Couleurs des graphiques** — une teinte fixe par carburant (`fuelColor()` lit `--fuel-*`), identique dans tous les graphiques ; palette validee daltonisme dans l'ordre FUELS, ne pas la permuter. Pas de camembert, pas de double axe ; tout graphique est accompagne d'un tableau de synthese chiffre (pas de tableau brut par periode).

**Un seul selecteur de carburants** — le composant `fuelChips()` (`filters.js`) est le seul moyen de choisir des carburants, partout (accueil, listes, fiche station, Explorer, favoris, formulaire vehicule avec la meme apparence). Toutes les vues (listes, prix, historique, classement, tableaux) affichent `prefs.fuels`. Quand un seul carburant est necessaire (tri, classement), on le choisit parmi la selection avec `sortSelect()`. Ne pas ajouter de selecteur de carburant propre a une vue.

**Noms de carburants** — jamais de `text-transform: uppercase` (« GPLc » deviendrait « GPLC »).

**Pas de framework, pas de bundler, pas de npm** — vanilla JS ES modules uniquement. Bibliotheques externes (Leaflet, Chart.js) chargees a la demande par `vendor.js`, versions figees + SRI.

**Placeholders HTML** — format `{{NOM_MAJUSCULES}}` uniquement. Liste complete actuelle : `{{BUILD_DATE}}`, `{{BUILD_DATETIME_PARIS}}`, `{{BUILD_DATETIME_ISO}}`, `{{STATION_COUNT}}`, `{{FUEL_DATA_UPDATE_FOOTER_HTML}}`, `{{GIT_COMMIT_HTML}}`, `{{APP_JS}}`, `{{ICON_SVG}}`, `{{STYLES_CSS}}`. Ne pas en inventer sans les implementer dans `pipeline/generate.py`.

**Ordre CSS fixe** — `pipeline/generate.py` concatene : variables → base → layout → nav → search → station → explore → favorites → vehicles → history → components → map → utilities. `variables.css` en tete, `utilities.css` en queue.

**Theme** — tokens dans `variables.css` : clair par defaut, sombre sous `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` **et** `:root[data-theme="dark"]` (meme bloc duplique : le garder synchronise). Reglages > Theme pose `data-theme` sur `<html>`.

**Timestamps** — base complete : `maj_iso` en ISO 8601 avec offset Paris, jamais UTC brut. Donnees navigateur : minutes depuis l'epoch (`t0` + delta), hydratees en millisecondes (`entry.t`).

**IDs HTML ↔ JS coherents** — tout ID utilise dans JS doit exister dans `templates/index.html`. Exceptions dynamiques connues : `footer-fuel-data-datetime` (injecte par `{{FUEL_DATA_UPDATE_FOOTER_HTML}}`), `near-r`, `near-sort`, `near-results`, `near-best`, `near-map`, `zone-sort`, `zone-map`, `station-map`, `explore-map`, `exp-rank`, `hist-body`, `hist-chart`, `zone-chart`, `osm-slot`, `go-remember`.

**Historique : la branche `history` n'est ecrite que par la CI** — jamais de commit manuel dessus ; la reconstruire si besoin avec `python -m pipeline.history backfill …` puis laisser la CI publier.

**Fenetres = `<div role="dialog">`** (`#settings-modal`, `#go-sheet`) — pas de balise `<dialog>`. Ouverture/fermeture via `dialog.js` (`openDialog` / `closeDialog`, classe `.hidden`), focus piege, Echap et clic sur le fond ferment la fenetre du dessus.

**Liens externes dans la delegation** — un `<a href="https://…">` portant `data-act` (ex. « Y aller ») n'est pas bloque : `app.js` n'appelle `preventDefault()` que pour les autres elements.

**Pas d'horaires d'ouverture** — retires (donnees source trop souvent absentes ou fausses) : ni exportes, ni affiches. Ne pas les reintroduire sans source fiable.

**Preferences persistees** — uniquement via `state.js` : chaque lecture est validee (`cleanFav`, `cleanVehicle`, bornes numeriques), chaque ecriture passe par `write()` (try/catch : navigation privee, quota). Toute nouvelle preference doit aussi etre couverte par `exportPrefs()` / `importPrefs()`.

**Suppression = annulable** — retirer un favori ou un vehicule affiche un toast « Annuler » (`toast(msg, {label, fn})`) plutot qu'une confirmation bloquante. Seul « Tout effacer » demande confirmation.

---

## 4. Architecture & flux de donnees

**Flux build Python :**
```
download.py
  └── dedup.py (phase 1 : dedoublonnage quotidien)
        └── stations.py (phases 2-3 : creation + fusion flux instantane)
              └── purge.py (phase 4 : stations sans prix)
                    └── aggregates.py (phase 5 : agregats + index) → datasets/database-<date>.json
                          └── generate.py → build/ (export.py : data.json + stations.<hash>.json ; HTML/CSS/JS)
                                └── history.py (phase 6 : branche history → build/history/, jamais bloquante)
```

**Phase historique (`pipeline/history.py`) :**
```
archives annuelles : annee courante + precedente (si Last-Modified a change),
                     puis toutes les annees manquantes jusqu'a 2007 (HISTORY_BACKFILL_PER_RUN, defaut 30)
                     tant que HISTORY_BACKFILL_BUDGET_S (defaut 900 s) n'est pas depasse
                     (~15 s/an, ~1,2 Go de RAM pour 2007→aujourd'hui)
  → remplacent les releves des jours qu'elles couvrent (elles font foi)
prix du build (database du jour)
  → completent la fin de serie (jour = date UTC de maj_iso, convention des archives)
garde-fou : stations jamais supprimees, releves −1 % max, sinon rien n'est ecrit
moyennes de zone recalculees sur les seules plages modifiees (tableaux de differences)
  → fichiers station modifies + zones + index.json, puis copie dans build/history/
```

**Flux runtime JS :**
```
app.js (module)
  → applyTheme() ; initRouter()
  → loadData() : data.json (revalide, ETag) → stations.<hash>.json (cache HTTP) → hydratation → state.db
  → render() : route courante (fragment d'URL) → vue enregistree
  → primeGeo() (si permission deja accordee) ; scheduleRefresh() (20 min, page visible, sauf economie de donnees)
  → interactions : delegation data-act / data-change / data-input → modules specialises
  → retour sur l'onglet apres une pause → refreshData() (requete conditionnelle)
```

**Etat (`state.js`) :**
- `prefs` : preferences persistees (`radius`, `maxAge`, `fuels`, `favs`, `vehicles`, `activeV`, `hist` {period, cmp}, `dataSaver`, `theme`, `recent`, `welcomed`, `navApp` ('ask'|'waze'|'gmaps'|'apple'|'geo'), `mapStyle` ('plan'|'sat')) — modifiees uniquement via les setters / `save*()` du module
- `state` : etat d'execution (`db`, `route`, `origin`, `geo`, `sortFuel`, pagination, cartes, graphiques, caches de l'historique…)
- Cles localStorage : constante `LS` (`carbuRadius`, `carbuFavorites`, `carbuVehicles`, `carbuActiveVehicle`, `carbuFuelSel`, `carbuWelcome`, `carbuMaxAge`, `carbuHistory`, `carbuDataSaver`, `carbuTheme`, `carbuRecent`, `carbuNavApp`, `carbuMapStyle`). `carbuFuels` (ancien filtre sans UI) est purge au demarrage.

**Donnees navigateur (format v3, `pipeline/export.py` → `templates/js/data.js`) :**
```
stations.<hash>.json   (nom adresse par contenu ; ~0,9 Mo brut, ~330 Ko gzip, en cache tant qu'il ne change pas)
  {"v":3, "fuels":[...], "regions":[nom], "depts":[[nom, code, i_region]], "brands":[nom],
   "s":[[id, i_brand|-1, osm ("n123"/"w123"/""), adresse, ville, cp, i_dept, lat, lon], ...]}
  departement : nom de la source (code postal en secours) ; code 2A/2B pour la Corse

data.json              (~520 Ko brut, ~145 Ko gzip, seul fichier re-telecharge quand les prix changent)
  {"v":3, "built", "updated", "updated_label", "stations":"stations.<hash>.json", "n", "t0":minutes,
   "p":[[i_carburant, prix millimes, minutes depuis t0, ...], ...]   (aligne ligne a ligne sur "s")
   "r":{"<index>":[i_carburant, jour depuis 1970, ...]}}             (ruptures de moins de EXPORT_RUPTURE_MAX_AGE_DAYS)
```
**Station hydratee :**
```js
{ id, name, brand, osm, addr, city, cp, dept, deptCode, region, lat, lon,
  fuels: { Gazole: { p: 1.789, t: 1764200000000 } }, rupt: null | { E85: jourDepuis1970 } }
```
Statistiques (moyenne, minimum, nombre par carburant, France / region / departement) calculees cote navigateur (`zoneStats()`), sur les prix visibles (filtre d'anciennete applique).

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
zones/fr.json | zones/region/<slug>.json | zones/dept/<code postal 2-3 chiffres>.json
    {"d0":jour,"len":n,"f":{"Gazole":{"a":[moyenne millimes, deltas],"n":[nb stations, deltas]}}}
README.md, .gitattributes          documentation du format (non publies sur le site)
```
Volume : ~225 Mo bruts pour 2007→2026 (~35 M releves, ~14 500 stations). CI : un commit par build qui change des donnees ; au-dela de `HISTORY_KEEP_COMMITS` (30) commits, les plus anciens sont fusionnes en un commit racine puis `push --force-with-lease`. Tout est reconstructible depuis les archives officielles.

---

## 5. Workflow de validation (obligatoire avant tout commit)

Executer dans l'ordre. Stopper et corriger si une etape echoue.

```bash
# Etape 1 — Syntaxe JS (OBLIGATOIRE)
for f in templates/js/*.js templates/app.js; do node -c "$f" && echo "OK: $f"; done

# Etape 2 — Tests pipeline + historique + export (OBLIGATOIRE)
python3 -m unittest tests.test_pipeline_freshness tests.test_history tests.test_export -v

# Etape 3 — Tests front (OBLIGATOIRE ; decode aussi build/ s'il existe)
node --test tests/front.test.mjs

# Etape 4 — Coherence IDs HTML<->JS + absence de gestionnaires inline (OBLIGATOIRE)
python3 << 'EOF'
import re, glob
js = open('templates/app.js').read() + ''.join(open(f).read() for f in glob.glob('templates/js/*.js'))
html = open('templates/index.html').read()
js_ids = set(re.findall(r"\$\(['\"]([^'\"]+)['\"]\)", js)) | set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
html_ids = set(re.findall(r'id="([^"]+)"', html))
dynamic = {'footer-fuel-data-datetime', 'near-r', 'near-sort', 'near-results', 'near-best', 'near-map', 'zone-sort', 'zone-map', 'station-map', 'explore-map', 'exp-rank', 'hist-body', 'hist-chart', 'zone-chart', 'osm-slot', 'go-remember'}
missing = js_ids - html_ids - dynamic
inline = re.findall(r'\son[a-z]+="', html + js)
print(f'ERREUR IDs manquants: {missing}' if missing else 'IDs OK')
print(f'ERREUR gestionnaires inline: {len(inline)}' if inline else 'Pas de gestionnaire inline')
EOF

# Etape 5 — Build complet + syntaxe JS genere (OBLIGATOIRE)
python main.py && for f in build/js/*.js; do node -c "$f"; done && node -c build/app.*.js

# Etape 6 — Smoke test local (recommande pour changements UI : bureau ET mobile, clair ET sombre)
cd build && python -m http.server 8000
```

---

## 6. Pieges connus & anti-patterns

**JS — zones de vigilance :**

- **Delegation** : un bouton dans un lien, ou un lien dans un element `data-act`, declenche les deux. Garder les actions sur des `<button>` hors des `<a>` (ex. etoile Nominatim a cote du lien `.s-link`).
- **Routeur** : `render()` detruit toutes les cartes Leaflet puis redessine la vue. Pour une mise a jour partielle sans perdre le focus (curseur de rayon, tri, « Voir plus »), redessiner seulement la zone de resultats (`rerenderNearList()`), pas toute la vue. `rerender()` conserve le defilement.
- **Pile de navigation** : `history.state.d` = profondeur ; `back()` revient en arriere si l'appli a empile un ecran, sinon remplace par l'accueil (lien profond ouvert depuis l'exterieur). La position de defilement est stockee dans `history.state.y`.
- **Voisinage** (`prices.js`) : cache par station, invalide automatiquement quand `state.dataVersion` change. Rayon fixe `NEAR_KM` (6 km a vol d'oiseau ≈ 7,5 km de route), independant du rayon de recherche.
- **Index derives** (`data.js`) : recherche, codes postaux, zones et statistiques sont memoises et vides a chaque nouvelle donnee ; les statistiques dependent aussi de `prefs.maxAge` (cle de cache), `invalidateDerived('stats')` apres un changement d'anciennete.
- **`TouchDragReorder`** : s'attache au conteneur au rendu. Toujours `destroy()` l'instance precedente (`state.favDnD` / `state.vehicleDnD`) avant de redessiner.
- **Nominatim (geocodage)** : API externe limitee. Recherche debouncee (300 ms) et annulable (`AbortController`) ; garder le controle `ac.signal.aborted` avant d'ecrire dans `#osm-slot`.
- **Historique asynchrone** : `renderStationHistory` / `renderZoneHistory` chargent des fichiers statiques puis ecrivent dans le DOM. Garder les jetons `state.histReq` / `state.zoneReq` et le controle `#hist-body[data-sid]` / route courante : l'utilisateur peut avoir change d'ecran entre-temps. Reponses en cache (`state.histCache`), vide par `refreshData()`.
- **Chart.js et Leaflet charges a la demande** : toute fonction qui les utilise est asynchrone (`await loadChart()` / `loadLeaflet()`) et doit reverifier que la vue est toujours affichee apres l'attente.
- **Jours de l'historique** : numeros de jour UTC (`Date.UTC(...) / 86400000`), formates avec `timeZone: 'UTC'`. Le prix live prolonge la courbe jusqu'a aujourd'hui avec la meme convention que le pipeline (date UTC de l'horodatage).
- **Moyennes de zone** : jours trop peu couverts (< 25 % du nombre median de stations) masques (`zoneDaily`). Fichiers de departement indexes par prefixe de code postal (`histDeptCode`, Corse = `20`), alors que l'interface affiche 2A / 2B.
- **Cle des lieux favoris** : `favKey()` arrondit a 5 decimales, exactement comme `nearHash()`. Toute autre precision casse la reconnaissance d'un favori depuis son lien (doublons, rayon personnalise ignore).
- **Navigation vers l'ecran courant** : `go()` ne fait que remonter en haut de page (pas d'entree d'historique) ; les lieux GPS tardifs ne naviguent que si l'accueil est toujours affiche (`locateMe`).
- **Favoris stations absentes** : un favori station absent des donnees n'est PAS supprime (la station peut reapparaitre) — carte inerte avec une note.
- **Fonds de carte** : plan = `tile.openstreetmap.fr` ; satellite = orthophotos IGN (Geoplateforme `data.geopf.fr`, licence ouverte, sans cle, zoom ≤ 19). Le choix (`prefs.mapStyle`) vaut pour toutes les cartes.
- **« Y aller »** : Plans (Apple) n'est propose que sur appareil Apple, `geo:` que sur Android (`availableApps()`). Le lien `geo:` s'ouvre dans l'onglet courant (pas de `target`).
- **Historique multi-carburants** : la comparaison au departement (pointilles) est limitee a `CMP_MAX_FUELS` (2) carburants affiches, au-dela le graphique deviendrait illisible.
- **Economie de donnees** : cartes differees (`mapSlot()` affiche un bouton ; `showMapNow()` memorise le choix pour la vue courante), tuiles non « retina », pas de rafraichissement periodique. Activee par defaut si `navigator.connection.saveData`.
- **Fraicheur** : `isExpired()` = plus de `maxAge` jours revolus ; toujours passer par `visiblePrice()` pour afficher ou comparer un prix (filtre coherent partout, y compris les statistiques).

**Python — zones de vigilance :**

- **Correlation flux↔quotidien** dans `stations.py` : utilise 2 niveaux de precision lat/lon (5 et 3 decimales). Ne jamais changer la cle de correlation sans adapter les deux niveaux.
- **`parse_price_cell()`** dans `helpers.py` : parseur canonique pour les prix quotidiens et le flux instantane. Ne pas reintroduire de `float(...)` direct sur une cellule Excel brute.
- **`purge_infinity()`** dans `helpers.py` : appeler avant toute serialisation JSON. Les prix non renseignes sont `float('inf')` en interne.
- **Validation prix** : 0.01–10.0 EUR/L (+ plages par carburant `FUEL_PRICE_RANGES`). Les stations hors plage sont ignorees silencieusement.
- **`price_entry_should_replace()`** dans `helpers.py` : comparateur unique de fraicheur. Une entree avec horodatage complet prime sur une date seule le meme jour ; a egalite stricte, le flux peut primer si `prefer_incoming_on_tie=True`.
- **Mapping OSM avec secours** : `resolve_osm_mapping()` (`download.py`) prend le mapping du jour s'il existe, sinon interroge Overpass, sinon retombe sur le mapping precedent le plus recent. Ne jamais copier le secours sous le nom du jour. `overpass.openstreetmap.fr` est exclu (403 depuis les runners GitHub).
- **Departements** : le code postal ne suffit pas (communes limitrophes, Corse 20xxx). `export.py` prend le nom de departement de la source et ne deduit du code postal que les « Inconnu ».
- **Horaires source** : presents dans la base complete (`parse_hours`) mais volontairement non exportes vers le navigateur (trop souvent absents ou « Ferme » par defaut).
- **DST** : les comparaisons de timestamps utilisent l'offset Europe/Paris.
- **Horodatages des exports XLSX decales** : data.economie.gouv.fr ajoute `+01:00`/`+02:00` a des heures deja locales. L'historique prend la **date UTC** de `maj_iso` (`snapshot_day`) pour retomber sur le jour des archives. Ne pas « corriger » vers la date locale.
- **Archives annuelles** : prix en euros (`"1.789"`) depuis ~2022, en millimes (`"1789"`) avant, et `maj` avec espace + microsecondes en 2007 — `parse_annual_price()` gere les deux. Fichier courant republie chaque nuit vers 23:40 UTC.
- **Memoire de l'historique** : series encodees en memoire (`HistoryStore`), decodees seulement pour les paires modifiees. ~1,2 Go pour 2007→2026 ; ne pas tout decoder en tuples (x7).
- **Phase historique non bloquante** : `run_history_phase()` attrape tout. Une erreur laisse la branche intacte et le site sort avec l'historique precedent.
- **Tests** : tout test qui appelle `pipeline.main.main()` doit patcher `run_history_phase` (sinon reseau + modification du depot `.history` local).

**CSS/Build — zones de vigilance :**

- **Ordre CSS fixe** : `variables.css` en premier, `utilities.css` en dernier.
- **Cache-bust** : `app.<ts>.js`, `styles.<ts>.css`, `icon.<ts>.svg` horodates ; les modules `build/js/*.js` gardent leur nom mais **tous les imports relatifs recoivent `?v=<ts>`** (`version_imports()` dans `generate.py`) : sans cela un module en cache survivrait a un deploiement (exports manquants → page blanche). Ne pas ecrire d'import relatif que la regex ne reconnaitrait pas (toujours `from './x.js'`).
- **Minification JS** : `generate.py` retire les commentaires `//` en debut de ligne et les lignes vides. Ne pas mettre de code fonctionnel apres `//` sur la meme ligne.
- **Assets statiques copies** : `sw.js` (auto-destruction d'un ancien service worker de cache), `CNAME`, `manifest.webmanifest`, `icon.svg`. Nouvel asset non-template → boucle `for extra in (...)` de `generate.py`.
- **`stations.<hash>.json`** : un seul publie (les anciens sont supprimes). Un client qui recevrait un `data.json` perime (cache CDN) pointant vers un fichier disparu recharge `data.json?t=…` (voir `loadData`).
- **`build/history/` hors miroir `pages`** : le step CI du miroir exclut `history/`. Il reste dans l'artefact GitHub Pages.
- **`color-mix(in oklab, ...)`** et `:has()` : navigateurs modernes uniquement (Safari 16.2+, Chrome 111+, Firefox 121+).

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
python -m pipeline.history           # Mettre a jour l'historique depuis la database du jour (+ archives a jour / manquantes)
python -m pipeline.history backfill 2007 2008 [--zip 2008=chemin.zip]   # Importer des annees precises
python -m pipeline.history rebuild-zones   # Recalculer toutes les moyennes de zone
node --test tests/front.test.mjs     # Tests unitaires du front
```

**Variables d'environnement historique :** `CARBUWEB_HISTORY_DIR` (depot, defaut `.history/`, checkout de la branche en CI), `CARBUWEB_HISTORY` (`0` desactive), `CARBUWEB_HISTORY_BACKFILL` (annees passees importees par build, defaut 30 = toutes), `CARBUWEB_HISTORY_BACKFILL_BUDGET` (secondes, defaut 900, 0 = sans limite).

**Sources de donnees :**
- Prix quotidiens : XLSX ~9 Mo, une ligne par station/carburant (avec doublons) — dernier prix seulement
- Archives annuelles : `donnees.roulez-eco.fr/opendata/annee/AAAA` depuis 2007, zip 10–35 Mo (XML ISO-8859-1), tous les changements de prix de l'annee ; annee en cours republiee chaque nuit
- Flux instantane : XLSX ~2.5 Mo, une ligne par station (toujours plus recent)
- OSM : Overpass API (3 instances en rotation), cache local journalier, repli sur le mapping precedent
- Geocodage : Nominatim (navigateur, a la demande) ; tuiles : `tile.openstreetmap.fr` (plan) et IGN Geoplateforme (satellite), a la demande

**Poids reseau (gzip) :** premiere visite ≈ 142 Ko (prix) + 331 Ko (stations) + ~62 Ko (HTML/CSS/JS) ; visite suivante sans nouveaux prix ≈ quelques requetes 304 ; nouveaux prix ≈ 145 Ko. Leaflet (~45 Ko) et Chart.js (~60 Ko) seulement si une carte / un graphique est affiche.

**Design system :**
- Accent : `#2563eb` (bleu) ; polices systeme (aucun telechargement)
- Semantique : vert (bon prix / baisse), ambre (moyen / avertissement), rouge (cher / hausse / rupture)
- Theme : automatique (systeme), clair ou sombre force (Reglages)
- Mobile-first : barre du bas sur mobile, onglets en haut sur grand ecran ; listes + carte collante a droite au-dela de 1024 px

**Badges fraicheur :**
- < 7 jours : aucun badge
- 7–14 jours : badge ambre
- 15–29 jours : badge rouge
- 30+ jours : badge rouge "> 1 mois"

**Prix :**
- Unite : EUR/L, float arrondi 3 decimales (millimes dans les fichiers)
- Classement local (fiche, favoris) : par rapport aux stations a moins de `NEAR_KM` ; listes : par rapport au moins cher de la liste
- Cheap : ≤ min + 0.0005 EUR · Mid : ≤ min + 0.030 EUR · Dear : au-dela

**CI/CD :**
- Cron `*/5 * * * *` mais GitHub throttle fortement : ~1 run toutes les 5-9 h. Forcer : `gh workflow run "Build & Deploy"`
- Job `build` : telechargements + `main.py` + force push branche `pages` + `upload-pages-artifact`. Job `deploy` (separe, `needs: build`) : `deploy-pages` avec une seconde tentative apres 60 s — ne pas refusionner les deux jobs
- Cache GitHub Actions uniquement pour le mapping OSM
- Concurrence : les runs precedents sont annules automatiquement (sans risque pour l'historique : le push est atomique et le run suivant reimporte les memes sources ; l'import retroactif est borne par son budget de temps)
- Historique : step « Recuperer la branche d'historique » (clone `--depth 35` dans `.history/`, ou `git init` au premier run) → `CARBUWEB_HISTORY_DIR=.history` pour le build → step « Publier l'historique » (commit, consolidation glissante, `push --force-with-lease`, `continue-on-error`)
