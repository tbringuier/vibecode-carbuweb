# Carbu'Web — Cache removal, timezone fix & features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all caching, fix price timestamp timezone issues, add tank size estimation, vehicle/favorite reordering, per-favorite search radius, and clean up the code.

**Architecture:** Python build script (`main.py`) generates timestamped static assets. Vanilla JS client (`app.js`) with centralized `refreshAllViews()` for state changes. No frameworks, no service worker.

**Tech Stack:** Python 3.14 (pandas, zoneinfo), vanilla JS (ES6+), Tailwind CSS (CDN), Leaflet, Chart.js, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-03-31-carbuweb-cache-tz-features-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `templates/sw.js` | Rewrite → self-destructing SW | Transition: purge caches, unregister |
| `templates/app.js` | Modify | All client-side features + SW cleanup |
| `templates/index.html` | Modify | Remove manifest/PWA, add `{{APP_JS}}` placeholder, vehicle form tank input, reorder UI |
| `templates/manifest.webmanifest` | Delete | No longer needed |
| `main.py` | Modify | Timestamp filenames, timezone normalization |

---

## Task 1: Remove service worker & PWA infrastructure

**Files:**
- Rewrite: `templates/sw.js`
- Modify: `templates/app.js:336-394` (registerServiceWorker, initPwaInstall)
- Modify: `templates/app.js:247-277` (DOMContentLoaded init)
- Modify: `templates/index.html:19` (manifest link)
- Modify: `templates/index.html:434-445` (PWA install bar)
- Modify: `templates/index.html:246-247` (PWA bar CSS)
- Delete: `templates/manifest.webmanifest`
- Modify: `main.py:955-958` (extra files copy)

- [ ] **Step 1: Rewrite sw.js as self-destructing service worker**

Replace the entire contents of `templates/sw.js` with:

```javascript
// Self-destructing service worker: clears all caches and unregisters itself.
// Deployed to clean up clients that had the old caching SW.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
```

- [ ] **Step 2: Replace registerServiceWorker & initPwaInstall in app.js**

In `templates/app.js`, replace `registerServiceWorker()` (lines 338-343) and `initPwaInstall()` (lines 345-394) and the `deferredInstallPrompt` variable (line 336) with a single cleanup function:

```javascript
/** Nettoyage des service workers et caches hérités (idempotent, peut rester indéfiniment). */
function cleanupLegacyServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(regs =>
        regs.forEach(r => r.unregister())
    );
    if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    }
}
```

- [ ] **Step 3: Update DOMContentLoaded to call cleanup instead of SW/PWA**

In `templates/app.js`, in the DOMContentLoaded handler (around lines 275-276), replace:

```javascript
        registerServiceWorker();
        initPwaInstall();
```

with:

```javascript
        cleanupLegacyServiceWorkers();
```

- [ ] **Step 4: Remove manifest link from index.html**

In `templates/index.html`, remove line 19:

```html
    <link rel="manifest" href="manifest.webmanifest">
```

- [ ] **Step 5: Remove PWA install bar HTML from index.html**

In `templates/index.html`, remove the entire PWA install bar div (lines 434-445):

```html
    <div id="pwa-install-bar" ...>
        ...
    </div>
```

- [ ] **Step 6: Remove PWA bar CSS from index.html**

In `templates/index.html`, remove lines 246-247:

```css
        #pwa-install-bar { transition: transform 0.3s ease, opacity 0.3s ease; }
        #pwa-install-bar.pwa-bar-hidden { transform: translateY(110%); opacity: 0; pointer-events: none; }
```

- [ ] **Step 7: Delete manifest.webmanifest**

Delete `templates/manifest.webmanifest`.

- [ ] **Step 8: Update main.py to stop copying manifest.webmanifest**

In `main.py`, line 955, change:

```python
    for extra in ("manifest.webmanifest", "sw.js", "icon.svg", "CNAME"):
```

to:

```python
    for extra in ("sw.js", "icon.svg", "CNAME"):
```

- [ ] **Step 9: Verify**

Run `python main.py` locally (if datasets exist) or review that all references to `registerServiceWorker`, `initPwaInstall`, `deferredInstallPrompt`, `pwa-install-bar`, `pwa-install-btn`, `pwa-install-dismiss`, `pwa-install-hint`, `carbuPwaBannerDismissed`, and `manifest.webmanifest` are gone from app.js and index.html (except the cleanup function and sw.js).

- [ ] **Step 10: Commit**

```bash
git add templates/sw.js templates/app.js templates/index.html main.py
git rm templates/manifest.webmanifest
git commit -m "Remove caching SW and PWA infrastructure

Replace service worker with self-destructing version that cleans up
client caches. Add safety-net cleanup in app.js. Remove manifest,
install banner, and all PWA-related code."
```

---

## Task 2: Add build-time file timestamping

**Files:**
- Modify: `main.py:912-960` (generate_site)
- Modify: `templates/index.html:472` (script src)
- Modify: `templates/index.html:20` (apple-touch-icon)

- [ ] **Step 1: Add {{APP_JS}} and {{ICON_SVG}} placeholders in index.html**

In `templates/index.html`, line 472, change:

```html
    <script src="app.js"></script>
```

to:

```html
    <script src="{{APP_JS}}"></script>
```

And line 20, change:

```html
    <link rel="apple-touch-icon" href="icon.svg">
```

to:

```html
    <link rel="apple-touch-icon" href="{{ICON_SVG}}">
```

- [ ] **Step 2: Update generate_site() in main.py to timestamp files**

In `main.py`, add a `BUILD_TS` variable at the top of `generate_site()` and update the file generation logic. Replace the generate_site function (lines 912-960) with:

```python
def generate_site():
    os.makedirs(BUILD_DIR, exist_ok=True)
    build_json = os.path.join(BUILD_DIR, "data.json")

    with open(DB_FILE, "r", encoding="utf-8") as f:
        db_out = json.load(f)

    meta = db_out.get("meta") if isinstance(db_out.get("meta"), dict) else {}
    if not (meta.get("latest_fuel_price_update_iso") or "").strip():
        meta = {**meta, **compute_latest_fuel_price_update_meta(db_out)}
    db_out.setdefault("meta", {})
    db_out["meta"]["latest_fuel_price_update_iso"] = meta.get("latest_fuel_price_update_iso", "")
    db_out["meta"]["latest_fuel_price_update_label_fr"] = meta.get(
        "latest_fuel_price_update_label_fr", "—"
    )

    with open(build_json, "w", encoding="utf-8") as f:
        json.dump(db_out, f, ensure_ascii=False, separators=(",", ":"))

    # Build timestamp for cache-busting filenames
    build_ts = str(int(time.time()))

    # Timestamped asset filenames
    app_js_name = f"app.{build_ts}.js"
    icon_svg_name = f"icon.{build_ts}.svg"

    # index.html — métadonnées de build + asset placeholders + minify
    with open(os.path.join(TEMPLATES_DIR, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    build_dt = datetime.now(ZoneInfo("Europe/Paris"))
    build_paris = build_dt.strftime("%d/%m/%Y à %H:%M")
    station_count = len(db_out.get("stations") or {})
    commit_short, commit_url = _resolve_git_footer_placeholders()
    html = html.replace("{{BUILD_DATE}}", TODAY)
    html = html.replace("{{BUILD_DATETIME_PARIS}}", build_paris)
    html = html.replace("{{BUILD_DATETIME_ISO}}", build_dt.isoformat(timespec="minutes"))
    html = html.replace("{{STATION_COUNT}}", _format_fr_int(station_count))
    html = html.replace(
        "{{FUEL_DATA_UPDATE_FOOTER_HTML}}", footer_fuel_data_update_html(db_out["meta"])
    )
    html = html.replace("{{GIT_COMMIT_HTML}}", _git_commit_footer_html(commit_short, commit_url))
    html = html.replace("{{APP_JS}}", app_js_name)
    html = html.replace("{{ICON_SVG}}", icon_svg_name)
    with open(os.path.join(BUILD_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(minify_html(html))

    # app.js — minify with timestamped name
    with open(os.path.join(TEMPLATES_DIR, "app.js"), "r", encoding="utf-8") as f:
        js = f.read()
    with open(os.path.join(BUILD_DIR, app_js_name), "w", encoding="utf-8") as f:
        f.write(minify_js(js))

    # icon.svg — copy with timestamped name
    icon_src = os.path.join(TEMPLATES_DIR, "icon.svg")
    if os.path.isfile(icon_src):
        shutil.copy2(icon_src, os.path.join(BUILD_DIR, icon_svg_name))

    # Clean up old timestamped files from previous builds
    for pattern in ("app.*.js", "icon.*.svg"):
        for old in glob.glob(os.path.join(BUILD_DIR, pattern)):
            basename = os.path.basename(old)
            if basename != app_js_name and basename != icon_svg_name:
                os.remove(old)

    for extra in ("sw.js", "CNAME"):
        src = os.path.join(TEMPLATES_DIR, extra)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(BUILD_DIR, extra))

    log.info("Static site written to %s/  (assets: %s, %s)", BUILD_DIR, app_js_name, icon_svg_name)
```

- [ ] **Step 3: Verify**

Check that `build/` would contain `app.<ts>.js`, `icon.<ts>.svg`, and that `index.html` references them correctly. Old `app.js` and `icon.svg` (non-timestamped) should no longer be generated.

- [ ] **Step 4: Commit**

```bash
git add main.py templates/index.html
git commit -m "Add build-time file timestamping for cache busting

Asset files are now named app.<timestamp>.js and icon.<timestamp>.svg.
index.html references them via placeholders replaced at build time.
Old timestamped files are cleaned up automatically."
```

---

## Task 3: Fix timezone on price timestamps

**Files:**
- Modify: `main.py:178-194` (normalize_price_update_iso)
- Modify: `main.py:305-324` (flux_maj_iso_and_date)

- [ ] **Step 1: Update normalize_price_update_iso to ensure timezone offset**

In `main.py`, replace `normalize_price_update_iso` (lines 178-194) with:

```python
def normalize_price_update_iso(raw):
    """Chaîne ISO 8601 avec offset Europe/Paris garanti.

    Les exports Excel utilisent souvent « YYYY-MM-DD HH:MM:SS » sans « T » ni offset.
    Les données gouvernementales sont publiées en heure locale française.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        return None
    if "T" not in s:
        m = re.match(r"^(\d{4}-\d{2}-\d{2})[\sT]+(.+)$", s)
        if m:
            s = m.group(1) + "T" + m.group(2).lstrip()
    if "T" not in s:
        return None
    s = s.replace(" ", "")
    # If an offset is already present (e.g. +02:00, +01:00, Z), keep it.
    if re.search(r"[+-]\d{2}:\d{2}$", s) or s.endswith("Z"):
        return s
    # No offset: assume Europe/Paris local time — add the correct offset for that date.
    try:
        naive = datetime.fromisoformat(s)
        paris = naive.replace(tzinfo=ZoneInfo("Europe/Paris"))
        return paris.isoformat(timespec="seconds")
    except (ValueError, TypeError):
        return s
```

- [ ] **Step 2: Fix synthetic timestamps in flux_maj_iso_and_date**

In `main.py`, in `flux_maj_iso_and_date` (lines 305-324), replace the synthetic timestamp block (lines 321-323):

```python
        rest = s[10:].strip()
        if not rest:
            d = s[:10]
            return f"{d}T12:00:00", d
```

with:

```python
        rest = s[10:].strip()
        if not rest:
            d = s[:10]
            try:
                noon = datetime.strptime(d, "%Y-%m-%d").replace(
                    hour=12, tzinfo=ZoneInfo("Europe/Paris")
                )
                return noon.isoformat(timespec="seconds"), d
            except ValueError:
                return f"{d}T12:00:00", d
```

- [ ] **Step 3: Verify**

Grep the codebase for any `maj_iso` values without timezone offset. Run the build and check sample entries in the output `data.json` — all `maj_iso` values should end with `+01:00` or `+02:00`.

- [ ] **Step 4: Commit**

```bash
git add main.py
git commit -m "Fix price timestamps: ensure Europe/Paris timezone offset

All maj_iso values in data.json now carry an explicit timezone offset.
This prevents ±1h display errors on clients in different DST states."
```

---

## Task 4: Centralized UI refresh & code cleanup

**Files:**
- Modify: `templates/app.js` (multiple locations)

- [ ] **Step 1: Add localStorage key constants at top of app.js**

At the top of `templates/app.js`, after the `ALL_FUELS` constant (line 7), add:

```javascript
// localStorage keys
const LS_RADIUS = 'carbuRadius';
const LS_FAVORITES = 'carbuFavorites';
const LS_VEHICLES = 'carbuVehicles';
const LS_ACTIVE_VEHICLE = 'carbuActiveVehicle';
const LS_FUELS = 'carbuFuels';
const LS_WELCOME = 'carbuWelcomeDismissed';
```

Then replace all hardcoded `'carbuRadius'`, `'carbuFavorites'`, `'carbuVehicles'`, `'carbuActiveVehicle'`, `'carbuFuels'`, `'carbuWelcomeDismissed'` string literals throughout app.js with the corresponding constants.

- [ ] **Step 2: Extract saveFavorites() function**

After the `saveVehicles()` function (line 30), add:

```javascript
function saveFavorites() {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(userFavorites));
}
```

Then replace all occurrences of `localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites))` (approximately 6 occurrences) with `saveFavorites()`.

- [ ] **Step 3: Create refreshAllViews() function**

Add after `refreshActiveViews` (around line 100):

```javascript
/** Point d'entrée unique après toute modification de préférences utilisateur. */
function refreshAllViews() {
    nearbyStationCache.clear();
    renderVehicleBar();
    renderVehiclesList();
    renderFavorites();
    syncFooterStationCount();
    syncFooterFuelDataUpdate();
    refreshActiveViews({});
}
```

- [ ] **Step 4: Use refreshAllViews in saveVehicleForm**

In `saveVehicleForm()` (around line 535), replace:

```javascript
    closeVehicleForm();
    renderVehiclesList();
    renderVehicleBar();
    nearbyStationCache.clear();
    renderFavorites();
    refreshActiveViews({ resetSortToFirst: true });
```

with:

```javascript
    closeVehicleForm();
    refreshAllViews();
```

- [ ] **Step 5: Use refreshAllViews in confirmDeleteVehicle**

In `confirmDeleteVehicle()` (around line 557), replace:

```javascript
    deleteVehicle(id);
    renderVehiclesList();
    renderVehicleBar();
    renderFavorites();
    refreshActiveViews({ resetSortToFirst: true });
```

with:

```javascript
    deleteVehicle(id);
    refreshAllViews();
```

- [ ] **Step 6: Use refreshAllViews in saveSettings**

Replace the body of `saveSettings()` (lines 584-608) with:

```javascript
function saveSettings() {
    userRadius = parseFloat(document.getElementById('radius-slider').value);
    localStorage.setItem(LS_RADIUS, userRadius);
    refreshAllViews();
}
```

- [ ] **Step 7: Use refreshAllViews in refreshCarbuDataFromNetwork**

In `refreshCarbuDataFromNetwork()` (lines 228-240), replace:

```javascript
        db = next;
        syncFooterStationCount();
        syncFooterFuelDataUpdate();
        refreshVisibleViewsAfterDbSwap();
```

with:

```javascript
        db = next;
        refreshAllViews();
```

- [ ] **Step 8: Improve error message in DOMContentLoaded catch**

In the DOMContentLoaded handler, replace the catch block (line 279):

```javascript
        document.getElementById('loading').innerHTML = '<p class="text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>Erreur serveur HTTP local.</p>';
```

with:

```javascript
        document.getElementById('loading').innerHTML = `<p class="text-red-500 font-bold mb-3"><i class="fas fa-exclamation-triangle mr-2"></i>Impossible de charger les données.</p><p class="text-sm text-slate-500 mb-4">${esc(e.message || String(e))}</p><button onclick="location.reload()" class="bg-indigo-600 text-white font-bold px-6 py-2.5 rounded-xl hover:bg-indigo-700 transition"><i class="fas fa-redo mr-2"></i>Réessayer</button>`;
```

- [ ] **Step 9: Commit**

```bash
git add templates/app.js
git commit -m "Add centralized refreshAllViews and code cleanup

Extract localStorage constants, saveFavorites(), and refreshAllViews()
to eliminate duplicated render calls and ensure consistent UI updates."
```

---

## Task 5: Tank size & full tank price estimation

**Files:**
- Modify: `templates/app.js` (vehicle functions, price display)
- Modify: `templates/index.html` (vehicle form)

- [ ] **Step 1: Add tank size input to vehicle form in index.html**

In `templates/index.html`, in the vehicle form (after the fuel checkboxes div, around line 284, before the flex gap-2 buttons div), add:

```html
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1.5" for="vehicle-tank-input">Réservoir (litres) <span class="font-normal text-slate-400">— optionnel</span></label>
                        <input type="number" id="vehicle-tank-input" min="1" max="999" step="1" placeholder="ex : 50" class="w-full min-h-[2.75rem] py-2 px-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium tabular-nums">
                    </div>
```

- [ ] **Step 2: Update addVehicle to include tankSize**

In `templates/app.js`, update `addVehicle()` (line 106-112):

```javascript
function addVehicle(name, icon, fuels, tankSize) {
    if (!name.trim() || fuels.length === 0) return null;
    const v = { id: generateVehicleId(), name: name.trim(), icon, fuels: [...fuels], tankSize: tankSize || null };
    userVehicles.push(v);
    saveVehicles();
    return v;
}
```

- [ ] **Step 3: Update updateVehicle to include tankSize**

Update `updateVehicle()` (line 114-122):

```javascript
function updateVehicle(id, name, icon, fuels, tankSize) {
    const v = userVehicles.find(v => v.id === id);
    if (!v) return;
    v.name = name.trim();
    v.icon = icon;
    v.fuels = [...fuels];
    v.tankSize = tankSize || null;
    saveVehicles();
    if (activeVehicleId === id) applyActiveVehicle();
}
```

- [ ] **Step 4: Update openVehicleForm to populate tank size**

In `openVehicleForm()`, after populating `vehicle-name-input` (around line 493), add:

```javascript
    document.getElementById('vehicle-tank-input').value = existing && existing.tankSize ? existing.tankSize : '';
```

- [ ] **Step 5: Update saveVehicleForm to read tank size**

In `saveVehicleForm()`, after reading fuels (around line 540-541), add tankSize reading and update the calls:

```javascript
    const tankRaw = parseInt(document.getElementById('vehicle-tank-input').value, 10);
    const tankSize = Number.isFinite(tankRaw) && tankRaw > 0 ? tankRaw : null;

    if (editingVehicleId) {
        updateVehicle(editingVehicleId, name, icon, fuels, tankSize);
    } else {
        const v = addVehicle(name, icon, fuels, tankSize);
        if (!v) return;
    }
```

- [ ] **Step 6: Add getActiveTankSize helper**

After `applyActiveVehicle()`, add:

```javascript
/** Taille du réservoir du véhicule actif (litres), ou null si non renseignée. */
function getActiveTankSize() {
    if (!activeVehicleId) return null;
    const v = userVehicles.find(v => v.id === activeVehicleId);
    return v && v.tankSize ? v.tankSize : null;
}
```

- [ ] **Step 7: Add fullTankHtml helper**

After `formatMajHtml()`, add:

```javascript
/** Estimation du prix d'un plein complet (si réservoir renseigné). */
function fullTankHtml(prixNum) {
    const tank = getActiveTankSize();
    if (!tank || !Number.isFinite(prixNum)) return '';
    const total = (prixNum * tank).toFixed(2).replace('.', ',');
    return `<div class="text-[10px] text-slate-400 font-medium">Plein ≈ ${total}\u202f€</div>`;
}
```

- [ ] **Step 8: Show tank price in station detail (showStation)**

In `showStation()`, in the price card rendering (around line 1939-1943), after the `<span>` with the price, add the full tank estimation. Replace:

```javascript
                    <div class="flex justify-end items-center mt-2">
                        <span class="text-slate-400 text-xs font-medium" translate="no"><i class="fas fa-clock mr-1"></i>${formatMajHtml(data)}</span>
                    </div>
```

with:

```javascript
                    ${fullTankHtml(prixActuel)}
                    <div class="flex justify-end items-center mt-2">
                        <span class="text-slate-400 text-xs font-medium" translate="no"><i class="fas fa-clock mr-1"></i>${formatMajHtml(data)}</span>
                    </div>
```

- [ ] **Step 9: Show tank price in favorite station cards**

In `renderFavorites()`, in the station favorite price tags (around line 832), replace:

```javascript
                    tags.push(`<span class="inline-block ${col.bg} ${col.text} text-[11px] font-semibold px-1.5 py-0.5 rounded"${ta}>${c} ${d.prix}€</span>`);
```

with:

```javascript
                    const tankInfo = fullTankHtml(parseFloat(d.prix));
                    tags.push(`<span class="inline-block ${col.bg} ${col.text} text-[11px] font-semibold px-1.5 py-0.5 rounded"${ta}>${c} ${d.prix}€</span>${tankInfo}`);
```

- [ ] **Step 10: Show tank price in favorite address best-price cards**

In `renderFavorites()`, in the address best-price cards (around line 866), replace:

```javascript
                        bestCards += `<div onclick="..." class="bg-green-50 ..."><div class="text-[10px] font-bold text-green-800">${fuel}</div><div class="text-sm font-black text-green-700">${best.prix.toFixed(3)}€</div>...`;
```

Add full tank after the price line. After `${best.prix.toFixed(3)}€</div>`, add:

```javascript
${fullTankHtml(best.prix)}
```

- [ ] **Step 11: Show tank size in vehicle list (settings)**

In `renderVehiclesList()`, after the fuel badges display (around line 476), add the tank size if present. Replace:

```javascript
                <div class="flex flex-wrap gap-1 mt-0.5">${fuelBadges}</div>
```

with:

```javascript
                <div class="flex flex-wrap gap-1 mt-0.5">${fuelBadges}${v.tankSize ? `<span class="text-[10px] bg-slate-100 text-slate-500 font-semibold px-1.5 py-0.5 rounded"><i class="fas fa-gas-pump mr-0.5"></i>${v.tankSize}L</span>` : ''}</div>
```

- [ ] **Step 12: Commit**

```bash
git add templates/app.js templates/index.html
git commit -m "Add tank size to vehicles and full tank price estimation

Vehicles can now have an optional tank size (liters). When set, a
full tank price estimate is shown on station detail, favorite cards,
and best-price widgets."
```

---

## Task 6: Vehicle and favorite reordering

**Files:**
- Modify: `templates/app.js` (renderVehicleBar, renderVehiclesList, renderFavorites)

- [ ] **Step 1: Add generic drag-and-drop + arrow reorder helpers**

After `refreshAllViews()`, add:

```javascript
// Drag-and-drop & arrow reordering helpers
let dragSrcIndex = null;
let dragListKey = null;

function startDrag(e, index, listKey) {
    dragSrcIndex = index;
    dragListKey = listKey;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    e.currentTarget.style.opacity = '0.4';
}

function endDrag(e) {
    e.currentTarget.style.opacity = '1';
}

function overDrag(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const el = e.currentTarget;
    el.style.outline = '2px dashed #6366f1';
    el.style.outlineOffset = '2px';
}

function leaveDrag(e) {
    e.currentTarget.style.outline = '';
    e.currentTarget.style.outlineOffset = '';
}

function dropItem(e, targetIndex, listKey) {
    e.preventDefault();
    e.currentTarget.style.outline = '';
    e.currentTarget.style.outlineOffset = '';
    if (dragListKey !== listKey || dragSrcIndex === null || dragSrcIndex === targetIndex) return;
    const arr = listKey === 'vehicles' ? userVehicles : userFavorites;
    const [item] = arr.splice(dragSrcIndex, 1);
    arr.splice(targetIndex, 0, item);
    if (listKey === 'vehicles') saveVehicles();
    else saveFavorites();
    refreshAllViews();
}

function moveItem(listKey, index, direction) {
    const arr = listKey === 'vehicles' ? userVehicles : userFavorites;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    if (listKey === 'vehicles') saveVehicles();
    else saveFavorites();
    refreshAllViews();
}
```

- [ ] **Step 2: Add drag-and-drop to vehicle bar**

In `renderVehicleBar()`, update the vehicle button rendering (around line 147-150). Replace:

```javascript
    userVehicles.forEach(v => {
        const active = activeVehicleId === v.id;
        html += `<button type="button" onclick="switchVehicle('${v.id}')" class="touch-manipulation snap-start flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition border ${active ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'}"><i class="fas ${v.icon}"></i>${esc(v.name)}</button>`;
    });
```

with:

```javascript
    userVehicles.forEach((v, i) => {
        const active = activeVehicleId === v.id;
        html += `<button type="button" onclick="switchVehicle('${v.id}')" draggable="true" ondragstart="startDrag(event,${i},'vehicles')" ondragend="endDrag(event)" ondragover="overDrag(event)" ondragleave="leaveDrag(event)" ondrop="dropItem(event,${i},'vehicles')" class="touch-manipulation snap-start flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition border ${active ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'}"><i class="fas ${v.icon}"></i>${esc(v.name)}</button>`;
    });
```

- [ ] **Step 3: Add drag-and-drop + arrows to vehicle list (settings)**

In `renderVehiclesList()`, update the rendering (around line 469-481). Replace the forEach loop with:

```javascript
    userVehicles.forEach((v, i) => {
        const fuelBadges = v.fuels.map(f => `<span class="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 rounded">${f}</span>`).join(' ');
        const isActive = activeVehicleId === v.id;
        html += `<div class="flex items-center gap-2 p-2.5 rounded-xl border ${isActive ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'} group" draggable="true" ondragstart="startDrag(event,${i},'vehicles')" ondragend="endDrag(event)" ondragover="overDrag(event)" ondragleave="leaveDrag(event)" ondrop="dropItem(event,${i},'vehicles')">
            <div class="flex flex-col gap-0.5 shrink-0">
                <button type="button" onclick="moveItem('vehicles',${i},-1)" class="touch-manipulation h-5 w-5 flex items-center justify-center rounded text-slate-300 hover:text-indigo-600 transition text-[10px] ${i === 0 ? 'invisible' : ''}" title="Monter"><i class="fas fa-chevron-up"></i></button>
                <button type="button" onclick="moveItem('vehicles',${i},1)" class="touch-manipulation h-5 w-5 flex items-center justify-center rounded text-slate-300 hover:text-indigo-600 transition text-[10px] ${i === userVehicles.length - 1 ? 'invisible' : ''}" title="Descendre"><i class="fas fa-chevron-down"></i></button>
            </div>
            <div class="h-9 w-9 rounded-full ${isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'} flex items-center justify-center shrink-0"><i class="fas ${v.icon} text-sm"></i></div>
            <div class="flex-1 min-w-0">
                <div class="font-bold text-sm text-slate-800 truncate">${esc(v.name)}</div>
                <div class="flex flex-wrap gap-1 mt-0.5">${fuelBadges}${v.tankSize ? `<span class="text-[10px] bg-slate-100 text-slate-500 font-semibold px-1.5 py-0.5 rounded"><i class="fas fa-gas-pump mr-0.5"></i>${v.tankSize}L</span>` : ''}</div>
            </div>
            <button type="button" onclick="openVehicleForm('${v.id}')" class="touch-manipulation h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition text-xs" title="Modifier"><i class="fas fa-pen"></i></button>
            <button type="button" onclick="confirmDeleteVehicle('${v.id}')" class="touch-manipulation h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition text-xs" title="Supprimer"><i class="fas fa-trash"></i></button>
        </div>`;
    });
```

- [ ] **Step 4: Add drag-and-drop + arrows to favorite cards**

In `renderFavorites()`, update the favorite card rendering. Wrap each card with drag attributes and add arrow buttons.

For **station favorites** (around line 836), replace the opening `<div class="p-3 bg-yellow-50...">` with:

```javascript
            allHtml += `
                <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-xl hover:shadow-md hover:border-yellow-300 transition group" draggable="true" ondragstart="startDrag(event,${i},'favorites')" ondragend="endDrag(event)" ondragover="overDrag(event)" ondragleave="leaveDrag(event)" ondrop="dropItem(event,${i},'favorites')">
                    <div class="flex justify-between items-start">
                        <div class="flex flex-col gap-0.5 shrink-0 mr-2">
                            <button onclick="event.stopPropagation(); moveItem('favorites',${i},-1)" class="touch-manipulation h-5 w-5 flex items-center justify-center rounded text-yellow-400 hover:text-yellow-700 transition text-[10px] ${i === 0 ? 'invisible' : ''}" title="Monter"><i class="fas fa-chevron-up"></i></button>
                            <button onclick="event.stopPropagation(); moveItem('favorites',${i},1)" class="touch-manipulation h-5 w-5 flex items-center justify-center rounded text-yellow-400 hover:text-yellow-700 transition text-[10px] ${i === userFavorites.length - 1 ? 'invisible' : ''}" title="Descendre"><i class="fas fa-chevron-down"></i></button>
                        </div>
                        <div onclick="showStation('${f.id}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="font-bold text-yellow-800 truncate"><i class="fas fa-gas-pump mr-2 text-yellow-600"></i>${esc(f.name)}</div>
                            <div class="text-xs text-yellow-700 truncate mt-1">${esc(f.adresse)}</div>
                        </div>
                        <button onclick="event.stopPropagation(); removeFavorite('${f.id}')" class="ml-2 flex-shrink-0 text-yellow-400 hover:text-red-500 transition" title="Retirer des favoris"><i class="fas fa-star text-lg"></i></button>
                    </div>
                    <div onclick="showStation('${f.id}')" class="cursor-pointer">${pricesHtml}</div>
                </div>`;
```

For **address favorites** (around line 872), replace the opening `<div class="p-3 bg-indigo-50...">` similarly:

```javascript
            allHtml += `
                <div class="p-3 bg-indigo-50 border border-indigo-200 rounded-xl hover:shadow-md hover:border-indigo-300 transition group" draggable="true" ondragstart="startDrag(event,${i},'favorites')" ondragend="endDrag(event)" ondragover="overDrag(event)" ondragleave="leaveDrag(event)" ondrop="dropItem(event,${i},'favorites')">
                    <div class="flex justify-between items-center">
                        <div class="flex flex-col gap-0.5 shrink-0 mr-2">
                            <button onclick="event.stopPropagation(); moveItem('favorites',${i},-1)" class="touch-manipulation h-5 w-5 flex items-center justify-center rounded text-indigo-400 hover:text-indigo-700 transition text-[10px] ${i === 0 ? 'invisible' : ''}" title="Monter"><i class="fas fa-chevron-up"></i></button>
                            <button onclick="event.stopPropagation(); moveItem('favorites',${i},1)" class="touch-manipulation h-5 w-5 flex items-center justify-center rounded text-indigo-400 hover:text-indigo-700 transition text-[10px] ${i === userFavorites.length - 1 ? 'invisible' : ''}" title="Descendre"><i class="fas fa-chevron-down"></i></button>
                        </div>
                        <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="font-bold text-indigo-800 truncate"><i class="fas fa-map-marker-alt mr-2 text-indigo-600"></i>${esc(f.name)}</div>
                            <div class="text-xs text-indigo-700 mt-1">Adresse favorite · ${radiusSettingKmHtml()}</div>
                        </div>
                        <button onclick="event.stopPropagation(); removeFavorite('${f.id}')" class="ml-2 flex-shrink-0 text-yellow-400 hover:text-red-500 transition" title="Retirer des favoris"><i class="fas fa-star text-lg"></i></button>
                    </div>
                    <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="cursor-pointer">${widgetRow}</div>
                </div>`;
```

- [ ] **Step 5: Commit**

```bash
git add templates/app.js
git commit -m "Add drag-and-drop and arrow reordering for vehicles and favorites

Both vehicle bar, vehicle settings list, and favorite cards now support
drag-and-drop reordering and up/down arrow buttons. Changes persist
immediately to localStorage."
```

---

## Task 7: Per-favorite search radius & favorite star on widgets

**Files:**
- Modify: `templates/app.js` (renderFavorites, favorite address logic, findStationsNear)

- [ ] **Step 1: Add radiusKm migration for address favorites**

In `migrateAddressFavoritesCoords()`, after rebuilding each address favorite object (around line 668), also migrate missing `radiusKm`. Replace:

```javascript
        next.push({ ...f, id: key, lat: la, lon: lo });
```

with:

```javascript
        next.push({ ...f, id: key, lat: la, lon: lo, radiusKm: f.radiusKm || null });
```

- [ ] **Step 2: Add radiusKm when creating address favorites**

In `toggleFavoriteAddress()` (around line 684), replace:

```javascript
    else userFavorites.push({ id: idStr, type: 'address', name, lat: la, lon: lo });
```

with:

```javascript
    else userFavorites.push({ id: idStr, type: 'address', name, lat: la, lon: lo, radiusKm: userRadius });
```

- [ ] **Step 3: Add getFavoriteRadius helper**

After `addressFavoriteKey()`, add:

```javascript
/** Rayon de recherche d'un favori adresse (fallback sur le rayon global). */
function getFavoriteRadius(fav) {
    return (fav && Number.isFinite(fav.radiusKm) && fav.radiusKm > 0) ? fav.radiusKm : userRadius;
}

/** Distance haversine max pour un rayon donné (km). */
function maxStraightLineKmFor(radiusKm) {
    return parseFloat(radiusKm) / ROUTE_DISTANCE_FACTOR;
}
```

- [ ] **Step 4: Use per-favorite radius in renderFavorites address cards**

In `renderFavorites()`, in the address favorite section (around line 854), replace:

```javascript
                const maxKm = maxStraightLineKmForRadius();
```

with:

```javascript
                const favRadius = getFavoriteRadius(f);
                const maxKm = maxStraightLineKmFor(favRadius);
```

And update the radius display in the card (around line 877). Replace:

```javascript
                            <div class="text-xs text-indigo-700 mt-1">Adresse favorite · ${radiusSettingKmHtml()}</div>
```

with:

```javascript
                            <div class="text-xs text-indigo-700 mt-1">Adresse favorite · <span class="distance-km" translate="no">~${getFavoriteRadius(f)}\u202fkm</span></div>
```

- [ ] **Step 5: Add radius selector popover functions**

After `getFavoriteRadius()`, add:

```javascript
const RADIUS_OPTIONS = [5, 10, 15, 20, 30];

function toggleRadiusPopover(favId, btnEl) {
    const existing = document.getElementById('radius-popover-' + favId);
    if (existing) { existing.remove(); return; }
    // Close any other open popover
    document.querySelectorAll('[id^="radius-popover-"]').forEach(el => el.remove());
    const fav = userFavorites.find(f => f.id === favId);
    const currentR = getFavoriteRadius(fav);
    const options = RADIUS_OPTIONS.map(r =>
        `<button type="button" onclick="event.stopPropagation(); setFavoriteRadius('${favId}', ${r})" class="touch-manipulation px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${r === currentR ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-indigo-50 border border-slate-200'}">${r} km</button>`
    ).join('');
    const popover = document.createElement('div');
    popover.id = 'radius-popover-' + favId;
    popover.className = 'flex flex-wrap gap-1.5 mt-2 p-2 bg-slate-50 border border-slate-200 rounded-xl animate-[fadeIn_0.1s_ease-out]';
    popover.innerHTML = `<span class="text-[10px] font-semibold text-slate-500 w-full mb-0.5">Rayon de recherche</span>${options}`;
    popover.onclick = (e) => e.stopPropagation();
    btnEl.closest('.p-3').appendChild(popover);
}

function setFavoriteRadius(favId, radiusKm) {
    const fav = userFavorites.find(f => f.id === favId);
    if (fav) {
        fav.radiusKm = radiusKm;
        saveFavorites();
        refreshAllViews();
    }
}
```

- [ ] **Step 6: Add gear icon to address favorite widget cards**

In `renderFavorites()`, in the address favorite card, add the gear button next to the star. After the star button (around the `removeFavorite` button line for address favorites), add a gear button. The buttons section should become:

```javascript
                        <div class="flex items-center gap-1 ml-2 shrink-0">
                            <button onclick="event.stopPropagation(); toggleRadiusPopover('${f.id}', this)" class="text-indigo-400 hover:text-indigo-600 transition" title="Rayon de recherche"><i class="fas fa-gear text-sm"></i></button>
                            <button onclick="event.stopPropagation(); removeFavorite('${f.id}')" class="text-yellow-400 hover:text-red-500 transition" title="Retirer des favoris"><i class="fas fa-star text-lg"></i></button>
                        </div>
```

Replace the single star button on address favorite cards with this group.

- [ ] **Step 7: Pass favorite radius to findStationsNear from favorite cards**

Update the `findStationsNear` function signature to optionally accept a custom radius. Replace (line 1488):

```javascript
function findStationsNear(lat, lon, labelTitle) {
```

with:

```javascript
function findStationsNear(lat, lon, labelTitle, customRadiusKm) {
```

And in `renderStationsList` call (around line 1500), pass it through. But actually, the simpler approach is to temporarily override `userRadius` when coming from a favorite. Instead, update `renderStationsList` to accept an optional radius parameter.

Replace `renderStationsList` signature (line 1503):

```javascript
function renderStationsList(lat, lon, labelTitle, sortFuel) {
```

with:

```javascript
function renderStationsList(lat, lon, labelTitle, sortFuel, overrideRadiusKm) {
```

And in `renderStationsList`, replace:

```javascript
        if (dist <= maxStraightLineKmForRadius()) stationsInRadius.push({ id, dist, station: stat });
```

with:

```javascript
        const maxKm = overrideRadiusKm ? maxStraightLineKmFor(overrideRadiusKm) : maxStraightLineKmForRadius();
        if (dist <= maxKm) stationsInRadius.push({ id, dist, station: stat });
```

Update `findStationsNear` to store and pass custom radius:

```javascript
function findStationsNear(lat, lon, labelTitle, customRadiusKm) {
    if (!document.getElementById('home-view').classList.contains('hidden')) {
        pushNav({ type: 'home' });
    }
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.removeAttribute('data-current-id');

    currentGeoZone = null;
    stationDetailSearchAnchor = null;
    currentProximitySearch = { lat, lon, labelTitle, radiusKm: customRadiusKm || null };
    renderStationsList(lat, lon, labelTitle, userFuels[0] || "", customRadiusKm || undefined);
}
```

- [ ] **Step 8: Update address favorite onclick to pass per-favorite radius**

In `renderFavorites()`, update the onclick for address favorites. Replace:

```javascript
                        <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="flex-1 min-w-0 cursor-pointer">
```

with:

```javascript
                        <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}', ${getFavoriteRadius(f)})" class="flex-1 min-w-0 cursor-pointer">
```

And also update the widgetRow onclick similarly.

- [ ] **Step 9: Add gear icon on the "Stations autour de" header**

In `renderStationsList()`, after the header h2 (around line 1524), check if there's a favorite for this location and add gear/star buttons. After `<h2 class="text-lg...">...</h2>`, add:

```javascript
    const favKey = addressFavoriteKey(lat, lon);
    const currentFav = favKey ? userFavorites.find(f => f.type === 'address' && f.id === favKey) : null;
    const listRadiusKm = overrideRadiusKm || userRadius;

    // ... after the h2 line:
    html += `<div class="flex items-center justify-center gap-3 mt-2">`;
    if (currentFav) {
        html += `<button onclick="event.stopPropagation(); toggleRadiusPopover('${currentFav.id}', this)" class="text-white/70 hover:text-white transition text-sm" title="Rayon de recherche"><i class="fas fa-gear"></i> ${listRadiusKm} km</button>`;
    }
    html += `</div>`;
```

- [ ] **Step 10: Commit**

```bash
git add templates/app.js
git commit -m "Add per-favorite search radius with gear icon popover

Address favorites now have their own radiusKm field. Gear icon opens
a radius selector. Star icon on all favorite widgets allows quick
removal. The radius is used both in the widget and in stations-near view."
```

---

## Task 8: Final verification & cleanup

- [ ] **Step 1: Search for dead references**

Grep app.js and index.html for any remaining references to:
- `registerServiceWorker`
- `initPwaInstall`
- `deferredInstallPrompt`
- `pwa-install-bar`
- `manifest.webmanifest`
- `carbuPwaBannerDismissed` (except in `resetSettings` which should also be cleaned)
- Hardcoded localStorage key strings (should all use constants)

- [ ] **Step 2: Update resetSettings to use constants and clean PWA key**

Replace `resetSettings()` to use the new constants and remove the PWA banner key:

```javascript
function resetSettings() {
    try {
        localStorage.removeItem(LS_RADIUS);
        localStorage.removeItem(LS_FAVORITES);
        localStorage.removeItem(LS_WELCOME);
        localStorage.removeItem(LS_VEHICLES);
        localStorage.removeItem(LS_ACTIVE_VEHICLE);
        localStorage.removeItem(LS_FUELS);
    } catch (e) {
        console.warn('resetSettings', e);
    }
    window.location.reload();
}
```

- [ ] **Step 3: Remove refreshVisibleViewsAfterDbSwap if now unused**

If `refreshVisibleViewsAfterDbSwap()` is no longer called anywhere (replaced by `refreshAllViews()`), delete it.

- [ ] **Step 4: Final commit**

```bash
git add templates/app.js templates/index.html
git commit -m "Final cleanup: remove dead code and remaining hardcoded keys"
```
