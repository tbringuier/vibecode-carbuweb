
// ==========================================
// DRAG & DROP — TouchDragReorder
// Reordonnancement tactile (touch + pointer) pour listes avec handles .drag-handle
// et attributs data-drag-index.
// ==========================================
class TouchDragReorder {
    constructor(containerEl, opts = {}) {
        this.el = typeof containerEl === 'string' ? document.querySelector(containerEl) : containerEl;
        this.onReorder = opts.onReorder || (() => {});
        this.handleSel = opts.handleSelector || '.drag-handle';
        this._active = null;
        this._ghost  = null;
        this._ph     = null;
        this._ox = 0; this._oy = 0;
        this._from = -1; this._to = -1;
        this._b = { down: this._onDown.bind(this), move: this._onMove.bind(this), up: this._onUp.bind(this) };
        if (this.el) this.el.addEventListener('pointerdown', this._b.down, { passive: false });
    }
    destroy() {
        if (this.el) this.el.removeEventListener('pointerdown', this._b.down);
        this._cleanup();
    }
    _itemFromHandle(target) {
        let node = target;
        while (node && node !== this.el) {
            if (node.matches && node.matches(this.handleSel)) {
                let p = node.parentElement;
                while (p && p !== this.el) {
                    if (p.dataset.dragIndex !== undefined) return p;
                    p = p.parentElement;
                }
            }
            node = node.parentElement;
        }
        return null;
    }
    _onDown(e) {
        const item = this._itemFromHandle(e.target);
        if (!item) return;
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        this._from = parseInt(item.dataset.dragIndex, 10);
        this._to   = this._from;
        this._ox   = e.clientX - rect.left;
        this._oy   = e.clientY - rect.top;
        this._active = item;
        this._ghost = item.cloneNode(true);
        Object.assign(this._ghost.style, { position:'fixed', zIndex:9999, pointerEvents:'none',
            opacity:'.93', transform:'scale(1.025) rotate(.35deg)', width: rect.width + 'px',
            boxShadow:'0 16px 40px rgba(0,0,0,.18)', borderRadius:'.875rem',
            left: rect.left + 'px', top: rect.top + 'px', transition:'none' });
        document.body.appendChild(this._ghost);
        this._ph = document.createElement('div');
        this._ph.className = 'dnd-placeholder';
        this._ph.style.height = rect.height + 'px';
        item.after(this._ph);
        item.classList.add('dragging-item');
        document.addEventListener('pointermove', this._b.move, { passive: false });
        document.addEventListener('pointerup',   this._b.up);
        document.addEventListener('pointercancel', this._b.up);
    }
    _onMove(e) {
        if (!this._ghost) return;
        e.preventDefault();
        this._ghost.style.left = (e.clientX - this._ox) + 'px';
        this._ghost.style.top  = (e.clientY - this._oy) + 'px';
        const siblings = [...this.el.querySelectorAll('[data-drag-index]')]
            .filter(el => !el.classList.contains('dragging-item'));
        let placed = false;
        for (let i = 0; i < siblings.length; i++) {
            const r = siblings[i].getBoundingClientRect();
            if (e.clientY < r.top + r.height / 2) {
                siblings[i].before(this._ph);
                this._to = i;
                placed = true;
                break;
            }
            this._to = i + 1;
        }
        if (!placed && siblings.length > 0) this.el.appendChild(this._ph);
        if (siblings.length === 0) this._to = 0;
    }
    _onUp() {
        document.removeEventListener('pointermove', this._b.move);
        document.removeEventListener('pointerup',   this._b.up);
        document.removeEventListener('pointercancel', this._b.up);
        const from = this._from, to = this._to;
        this._cleanup();
        if (from !== -1 && to !== -1 && from !== to) this.onReorder(from, to);
    }
    _cleanup() {
        if (this._ghost)  { this._ghost.remove();  this._ghost = null; }
        if (this._ph)     { this._ph.remove();     this._ph    = null; }
        if (this._active) { this._active.classList.remove('dragging-item'); this._active = null; }
        this._from = -1; this._to = -1;
    }
}

let db = null;
let stationMap = null;
let palmaresMap = null;
let searchTimeout = null;

const ALL_FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"];

// localStorage keys
const LS_RADIUS = 'carbuRadius';
const LS_FAVORITES = 'carbuFavorites';
const LS_VEHICLES = 'carbuVehicles';
const LS_ACTIVE_VEHICLE = 'carbuActiveVehicle';
const LS_FUELS = 'carbuFuels';
const LS_WELCOME = 'carbuWelcomeDismissed';

/** Rayon par défaut : ordre de grandeur réaliste pour un détour en voiture autour d'un point. */
const DEFAULT_SEARCH_RADIUS_KM = 10;
let userRadius = parseInt(localStorage.getItem(LS_RADIUS), 10) || DEFAULT_SEARCH_RADIUS_KM;
let userFuels = [...ALL_FUELS];
let userFavorites = JSON.parse(localStorage.getItem(LS_FAVORITES)) || [];
let favDnD     = null;
let vehicleDnD = null;

// Profils véhicules
const VEHICLE_ICONS = [
    { icon: 'fa-car', label: 'Voiture' },
    { icon: 'fa-car-side', label: 'Berline' },
    { icon: 'fa-truck', label: 'Camion' },
    { icon: 'fa-motorcycle', label: 'Moto' },
    { icon: 'fa-van-shuttle', label: 'Van' },
    { icon: 'fa-bicycle', label: 'Vélo' },
    { icon: 'fa-bus', label: 'Bus' },
    { icon: 'fa-gas-pump', label: 'Autre' },
];
let userVehicles = JSON.parse(localStorage.getItem(LS_VEHICLES)) || [];
let activeVehicleId = localStorage.getItem(LS_ACTIVE_VEHICLE) || null;

function saveVehicles() {
    localStorage.setItem(LS_VEHICLES, JSON.stringify(userVehicles));
}

function saveFavorites() {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(userFavorites));
}

function applyActiveVehicle() {
    if (userVehicles.length === 0) {
        activeVehicleId = null;
        localStorage.removeItem(LS_ACTIVE_VEHICLE);
        localStorage.removeItem(LS_FUELS);
        userFuels = [...ALL_FUELS];
        return;
    }
    if (activeVehicleId) {
        const v = userVehicles.find(v => v.id === activeVehicleId);
        if (v) {
            userFuels = [...v.fuels];
        } else {
            activeVehicleId = null;
            localStorage.removeItem(LS_ACTIVE_VEHICLE);
            userFuels = JSON.parse(localStorage.getItem(LS_FUELS)) || [...ALL_FUELS];
        }
    } else {
        userFuels = JSON.parse(localStorage.getItem(LS_FUELS)) || [...ALL_FUELS];
    }
}

/** Taille du réservoir du véhicule actif (litres), ou null si non renseignée. */
function getActiveTankSize() {
    if (!activeVehicleId) return null;
    const v = userVehicles.find(v => v.id === activeVehicleId);
    return v && v.tankSize ? v.tankSize : null;
}

function switchVehicle(vehicleId) {
    if (vehicleId === activeVehicleId) return;
    activeVehicleId = vehicleId;
    if (vehicleId) {
        localStorage.setItem(LS_ACTIVE_VEHICLE, vehicleId);
    } else {
        localStorage.removeItem(LS_ACTIVE_VEHICLE);
    }
    applyActiveVehicle();
    nearbyStationCache.clear();
    renderVehicleBar();
    renderFavorites();
    refreshActiveViews({ resetSortToFirst: true });
}

function refreshActiveViews(opts) {
    const resetSort = opts && opts.resetSortToFirst === true;
    if (currentProximitySearch) {
        let sf = '';
        if (resetSort) {
            sf = userFuels[0] || '';
        } else {
            const sortEl = document.getElementById('sort-fuel-select');
            sf = sortEl ? sortEl.value : '';
            if (sf && !userFuels.includes(sf)) sf = userFuels[0] || '';
        }
        withSearchRadius(() => renderStationsList(currentProximitySearch.lat, currentProximitySearch.lon, currentProximitySearch.labelTitle, sf));
    } else if (currentGeoZone) {
        let gf;
        if (resetSort) {
            gf = userFuels[0] || '';
        } else {
            const sortEl = document.getElementById('geo-sort-select');
            gf = sortEl ? sortEl.value : (userFuels[0] || '');
            if (gf && !userFuels.includes(gf)) gf = userFuels[0] || '';
        }
        searchGeoZone(currentGeoZone.type, currentGeoZone.name, gf);
    } else if (!document.getElementById('home-view').classList.contains('hidden')) {
        debouncedSearch();
    }
    if (!document.getElementById('pane-statistiques').classList.contains('hidden')) {
        chartsInitialized = false;
        renderDashboard();
    }
    const sid = document.getElementById('station-view').getAttribute('data-current-id');
    if (sid && !document.getElementById('station-view').classList.contains('hidden')) showStation(sid);
}

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

function generateVehicleId() {
    return 'v' + Date.now() + Math.random().toString(36).slice(2, 6);
}

function addVehicle(name, icon, fuels, tankSize) {
    if (!name.trim() || fuels.length === 0) return null;
    const v = { id: generateVehicleId(), name: name.trim(), icon, fuels: [...fuels], tankSize: tankSize || null };
    userVehicles.push(v);
    saveVehicles();
    return v;
}

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

function deleteVehicle(id) {
    userVehicles = userVehicles.filter(v => v.id !== id);
    saveVehicles();
    if (activeVehicleId === id || userVehicles.length === 0) {
        if (userVehicles.length === 0) {
            activeVehicleId = null;
            localStorage.removeItem(LS_ACTIVE_VEHICLE);
        }
        applyActiveVehicle();
    }
}

function renderVehicleBar() {
    const bar = document.getElementById('vehicle-bar');
    const list = document.getElementById('vehicle-bar-list');
    if (!bar || !list) return;
    if (userVehicles.length === 0) {
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    const isAll = !activeVehicleId;
    const chipOn  = 'bg-[#2563EB] text-white border-[#2563EB] shadow-sm';
    const chipOff = 'bg-white text-[#78716C] border-[#D0C9BF] hover:border-[#2563EB] hover:text-[#2563EB]';
    let html = `<button type="button" onclick="switchVehicle(null)" aria-pressed="${isAll}" class="touch-manipulation snap-start min-h-[2.5rem] flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition border ${isAll ? chipOn : chipOff}"><i class="fas fa-list-ul text-[0.85em] opacity-90" aria-hidden="true"></i><span>Tous</span></button>`;
    userVehicles.forEach(v => {
        const active = activeVehicleId === v.id;
        html += `<button type="button" onclick="switchVehicle('${v.id}')" aria-pressed="${active}" class="touch-manipulation snap-start min-h-[2.5rem] flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition border ${active ? chipOn : chipOff}"><i class="fas ${v.icon} text-[0.85em] opacity-90" aria-hidden="true"></i><span class="truncate max-w-[10rem] sm:max-w-[14rem]">${esc(v.name)}</span></button>`;
    });
    list.innerHTML = html;
}

let chartsInitialized = false;
let currentProximitySearch = null;
/** Point de recherche pour carte / comparaison quand on ouvre une station depuis un favori adresse (sans être passé par l'écran liste). */
let stationDetailSearchAnchor = null;
let currentGeoZone = null;
let navStack = [];
let isRestoringNav = false;
let chartNatPrices = null;
let chartNatFuels = null;
let searchAbortController = null;

/** Rafraîchissement des données publiées (aligné sur les builds CI ~10 min). */
const DATA_REFRESH_MS = 20 * 60 * 1000;
let dataRefreshTimerId = null;

async function fetchDataJsonFresh() {
    const url = `data.json?_=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function refreshVisibleViewsAfterDbSwap() {
    nearbyStationCache.clear();
    chartsInitialized = false;

    renderVehicleBar();
    populateRegions();
    populateFuelsSelect();
    renderFavorites();

    const homeView = document.getElementById('home-view');
    const stationView = document.getElementById('station-view');
    const statsPane = document.getElementById('pane-statistiques');

    if (homeView && !homeView.classList.contains('hidden')) {
        debouncedSearch();
    }

    if (stationView && !stationView.classList.contains('hidden')) {
        const sid = stationView.getAttribute('data-current-id');
        if (sid) {
            if (db.stations[sid]) showStation(sid);
            else goHome();
        } else if (currentProximitySearch) {
            const sortEl = document.getElementById('sort-fuel-select');
            const sf = sortEl ? sortEl.value : '';
            withSearchRadius(() => renderStationsList(
                currentProximitySearch.lat,
                currentProximitySearch.lon,
                currentProximitySearch.labelTitle,
                sf
            ));
        } else if (currentGeoZone) {
            const sortEl = document.getElementById('geo-sort-select');
            const gf = sortEl ? sortEl.value : (userFuels[0] || '');
            searchGeoZone(currentGeoZone.type, currentGeoZone.name, gf);
        }
    }

    if (statsPane && !statsPane.classList.contains('hidden')) {
        renderDashboard();
    }

    const palmTab = document.getElementById('tab-palmares');
    if (palmTab && palmTab.getAttribute('aria-selected') === 'true') {
        try {
            findCheapest();
        } catch (e) {
            console.warn('findCheapest après refresh', e);
        }
    }
}

async function refreshCarbuDataFromNetwork() {
    if (!db) return;
    try {
        const next = await fetchDataJsonFresh();
        if (!next || !next.stations) return;
        db = next;
        refreshAllViews();
    } catch (e) {
        console.warn('Actualisation data.json', e);
    }
}

function startPeriodicDataRefresh() {
    if (dataRefreshTimerId !== null) clearInterval(dataRefreshTimerId);
    dataRefreshTimerId = setInterval(refreshCarbuDataFromNetwork, DATA_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById('radius-slider').value = userRadius;
    document.getElementById('radius-display').innerText = userRadius;
    
    document.getElementById('radius-slider').addEventListener('input', (e) => {
        document.getElementById('radius-display').innerText = e.target.value;
        debouncedSaveSettings();
    });

    const vNameEl = document.getElementById('vehicle-name-input');
    vNameEl?.addEventListener('input', () => {
        if (vNameEl.value.trim()) setVehicleNameError(false);
    });
    const vTankEl = document.getElementById('vehicle-tank-input');
    vTankEl?.addEventListener('input', () => {
        const t = vTankEl.value.trim();
        if (t === '') {
            setVehicleTankError(false);
            return;
        }
        const n = parseInt(t, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 999) setVehicleTankError(false);
    });

    try {
        db = await fetchDataJsonFresh();

        applyActiveVehicle();
        renderVehicleBar();
        renderVehiclesList();

        document.getElementById('loading').classList.add('hidden');
        document.getElementById('home-view').classList.remove('hidden');

        if (localStorage.getItem(LS_WELCOME)) {
            document.getElementById('welcome-card').classList.add('hidden');
        }

        populateRegions();
        populateFuelsSelect();
        renderFavorites();
        syncFooterStationCount();
        syncFooterFuelDataUpdate();
        cleanupLegacyServiceWorkers();
        startPeriodicDataRefresh();
    } catch (e) {
        document.getElementById('loading').innerHTML = `<div class="max-w-md mx-auto px-2">${uiNoticeBlock('fa-plug', 'bg-red-500', 'Impossible de charger les données.', `<p class="text-left text-sm">${esc(e.message || String(e))}</p>`)}<button type="button" onclick="location.reload()" class="touch-manipulation mt-4 w-full min-h-[3rem] bg-indigo-600 text-white font-extrabold px-6 py-3 rounded-2xl hover:bg-indigo-700 transition shadow-md border-2 border-indigo-700/30"><i class="fas fa-redo mr-2" aria-hidden="true"></i>Recharger la page</button></div>`;
    }
});

function dismissWelcome() {
    document.getElementById('welcome-card').classList.add('hidden');
    localStorage.setItem(LS_WELCOME, '1');
}

// Utilitaires
function normalizeText(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-']/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Bloc d'information / vide : contraste élevé, lisible, `role="status"` pour les lecteurs d'écran. */
function uiNoticeBlock(iconClass, iconWrapClass, title, bodyHtml) {
    return `<div class="p-5 sm:p-6 rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/20 text-center shadow-sm" role="status">
        <span class="inline-flex h-12 w-12 items-center justify-center rounded-xl ${iconWrapClass} text-white shadow-md mb-3 mx-auto" aria-hidden="true"><i class="fas ${iconClass} text-xl"></i></span>
        <p class="font-extrabold text-slate-900 text-sm sm:text-base leading-snug">${title}</p>
        ${bodyHtml ? `<div class="text-sm text-slate-600 mt-2 max-w-lg mx-auto leading-relaxed">${bodyHtml}</div>` : ''}
    </div>`;
}

function formatFrInt(n) {
    const num = typeof n === 'number' ? n : parseInt(String(n).replace(/\u202f/g, ''), 10);
    if (!Number.isFinite(num)) return '';
    return String(Math.trunc(num)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}

function syncFooterStationCount() {
    const el = document.getElementById('footer-station-count');
    if (!el || !db || !db.stations) return;
    el.textContent = formatFrInt(Object.keys(db.stations).length);
}

function syncFooterFuelDataUpdate() {
    const el = document.getElementById('footer-fuel-data-datetime');
    if (!el || !db || !db.meta) return;
    const iso = db.meta.latest_fuel_price_update_iso;
    const label = db.meta.latest_fuel_price_update_label_fr;
    if (label) el.textContent = label;
    if (iso && el.tagName === 'TIME') {
        el.setAttribute('datetime', iso);
    }
}

let toastHideTimer = null;
function showToast(message, iconClass = 'fa-check-circle') {
    const el = document.getElementById('app-toast');
    if (!el) return;
    el.innerHTML = `<i class="fas ${iconClass} flex-shrink-0 text-emerald-400" aria-hidden="true"></i><span>${esc(message)}</span>`;
    el.classList.remove('toast-hidden');
    el.classList.add('toast-visible');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
        el.classList.remove('toast-visible');
        el.classList.add('toast-hidden');
    }, 2400);
}

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

function distanceHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Le rayon réglé par l'utilisateur est interprété comme une distance « en voiture » approximative.
 * On en déduit une distance géodésique max pour filtrer les stations (plus courte que le trajet réel).
 */
const ROUTE_DISTANCE_FACTOR = 1.25;

function maxStraightLineKmForRadius() {
    return parseFloat(userRadius) / ROUTE_DISTANCE_FACTOR;
}

/** Rayon haversine pour un favori adresse (rayon personnalisé ou rayon global). */
function maxStraightLineKmForFavorite(fav) {
    if (fav && fav.radius && Number.isFinite(parseFloat(fav.radius))) {
        return parseFloat(fav.radius) / ROUTE_DISTANCE_FACTOR;
    }
    return maxStraightLineKmForRadius();
}

/** Ajuste le rayon de recherche d'un favori adresse. */
function adjustFavRadius(id, delta) {
    const idx = userFavorites.findIndex(f => f.id === id);
    if (idx === -1) return;
    const f = userFavorites[idx];
    const current = f.radius ? parseFloat(f.radius) : userRadius;
    const next = Math.max(1, Math.min(100, current + delta));
    userFavorites[idx] = { ...f, radius: next };
    saveFavorites();
    renderFavorites();
}

/** Reorder d'un favori dans la liste (callback DnD). */
function reorderFavorite(from, slotIdx) {
    const next = [...userFavorites];
    const [item] = next.splice(from, 1);
    next.splice(slotIdx, 0, item);
    userFavorites = next;
    saveFavorites();
    renderFavorites();
}

/** Reorder d'un véhicule dans la liste (callback DnD). */
function reorderVehicle(from, slotIdx) {
    const next = [...userVehicles];
    const [item] = next.splice(from, 1);
    next.splice(slotIdx, 0, item);
    userVehicles = next;
    saveVehicles();
    renderVehiclesList();
    renderVehicleBar();
}

/**
 * Exécute fn() en appliquant temporairement le rayon personnalisé d'une recherche de proximité
 * (currentProximitySearch.customRadius) afin que maxStraightLineKmForRadius() retourne la bonne valeur.
 */
function withSearchRadius(fn) {
    const cr = currentProximitySearch && currentProximitySearch.customRadius;
    if (!cr) return fn();
    const saved = userRadius;
    userRadius = cr;
    try { fn(); } finally { userRadius = saved; }
}

/** Lance une recherche de proximité à partir d'un favori (utilise son rayon personnalisé). */
function findStationsNearFav(lat, lon, name, favId) {
    const fav = userFavorites.find(f => f.id === favId);
    const cr = fav && fav.radius ? parseFloat(fav.radius) : null;
    findStationsNear(lat, lon, name, cr);
}

/** Estimation d'itinéraire (km) à partir du haversine, pour l'affichage uniquement. */
function displayRouteKm(straightKm) {
    return Math.round(straightKm * ROUTE_DISTANCE_FACTOR * 10) / 10;
}

/** Libellé français : virgule décimale, espace insécable étroit avant l'unité (typo + HiDPI). */
function formatApproxRouteKm(straightKm) {
    const d = displayRouteKm(straightKm);
    const num = String(d.toFixed(1)).replace('.', ',');
    return `~${num}\u202fkm`;
}

function searchSourcePill(text) {
    return `<span class="search-source-pill">${esc(text)}</span>`;
}

function distanceKmSpan(straightKm) {
    return `<span class="distance-km" translate="no">${formatApproxRouteKm(straightKm)}</span>`;
}

function radiusSettingKmHtml() {
    return `<span class="distance-km" translate="no">~${userRadius}\u202fkm</span>`;
}

/** Rayon haversine (km) pour comparer les prix « autour » d'une station (borné). */
function nearbyCompareStraightKm() {
    const m = maxStraightLineKmForRadius();
    return Math.min(11, Math.max(4, m));
}

function getGoogleMapsLink(lat, lon, query = "") {
    if (lat && lon) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function hasTrackedFuel(station) {
    if (!station || !station.carburants_disponibles) return false;
    for (const c of Object.keys(station.carburants_disponibles)) {
        if (userFuels.includes(c)) return true;
    }
    return false;
}

// Gestion véhicules (paramètres)
let editingVehicleId = null;

function clearVehicleFormErrors() {
    const nameIn = document.getElementById('vehicle-name-input');
    const tankIn = document.getElementById('vehicle-tank-input');
    const fuelWrap = document.getElementById('vehicle-fuels-field-wrap');
    const errCls = ['border-red-500', 'bg-red-50', 'ring-2', 'ring-red-400', 'focus:ring-red-500', 'focus:border-red-500'];
    if (nameIn) {
        errCls.forEach(c => nameIn.classList.remove(c));
        nameIn.removeAttribute('aria-invalid');
    }
    document.getElementById('vehicle-name-error')?.classList.add('hidden');
    if (tankIn) {
        errCls.forEach(c => tankIn.classList.remove(c));
        tankIn.removeAttribute('aria-invalid');
    }
    document.getElementById('vehicle-tank-error')?.classList.add('hidden');
    if (fuelWrap) {
        ['ring-2', 'ring-red-400', 'bg-red-50/50', 'border', 'border-red-200', 'p-2', '-m-0.5'].forEach(c => fuelWrap.classList.remove(c));
    }
    document.getElementById('vehicle-fuels-error')?.classList.add('hidden');
}

function setVehicleNameError(show) {
    const el = document.getElementById('vehicle-name-input');
    const err = document.getElementById('vehicle-name-error');
    if (!el) return;
    const errCls = ['border-red-500', 'bg-red-50', 'ring-2', 'ring-red-400', 'focus:ring-red-500', 'focus:border-red-500'];
    if (show) {
        errCls.forEach(c => el.classList.add(c));
        el.setAttribute('aria-invalid', 'true');
        err?.classList.remove('hidden');
    } else {
        errCls.forEach(c => el.classList.remove(c));
        el.removeAttribute('aria-invalid');
        err?.classList.add('hidden');
    }
}

function setVehicleFuelsError(show) {
    const wrap = document.getElementById('vehicle-fuels-field-wrap');
    const err = document.getElementById('vehicle-fuels-error');
    if (!wrap) return;
    const wrapCls = ['ring-2', 'ring-red-400', 'bg-red-50/50', 'border', 'border-red-200', 'p-2', '-m-0.5'];
    if (show) {
        wrapCls.forEach(c => wrap.classList.add(c));
        err?.classList.remove('hidden');
    } else {
        wrapCls.forEach(c => wrap.classList.remove(c));
        err?.classList.add('hidden');
    }
}

function setVehicleTankError(show) {
    const el = document.getElementById('vehicle-tank-input');
    const err = document.getElementById('vehicle-tank-error');
    if (!el) return;
    const errCls = ['border-red-500', 'bg-red-50', 'ring-2', 'ring-red-400', 'focus:ring-red-500', 'focus:border-red-500'];
    if (show) {
        errCls.forEach(c => el.classList.add(c));
        el.setAttribute('aria-invalid', 'true');
        err?.classList.remove('hidden');
    } else {
        errCls.forEach(c => el.classList.remove(c));
        el.removeAttribute('aria-invalid');
        err?.classList.add('hidden');
    }
}

function renderVehiclesList() {
    const container = document.getElementById('vehicles-list');
    if (!container) return;
    if (userVehicles.length === 0) {
        container.innerHTML = '<div class="rounded-lg border border-dashed border-[var(--cb-border2)] px-4 py-3.5 text-center" role="status"><p class="text-sm font-semibold text-[var(--cb-text)]">Aucun véhicule enregistré</p><p class="text-xs text-[var(--cb-muted)] mt-1.5 leading-relaxed">L\'app s\'appuie sur les carburants que vous cochez plus bas jusqu\'à ce que vous définissiez un véhicule.</p></div>';
        if (vehicleDnD) { vehicleDnD.destroy(); vehicleDnD = null; }
        return;
    }
    let html = '';
    userVehicles.forEach((v, idx) => {
        const fuelBadges = v.fuels.map(f => `<span class="text-[10px] font-semibold px-2 py-0.5 rounded border border-[var(--cb-border2)] text-[var(--cb-muted)]">${esc(f)}</span>`).join(' ');
        const isActive = activeVehicleId === v.id;
        html += `<div data-drag-index="${idx}" class="flex items-center gap-2 p-3 cb-card border shadow-sm transition ${isActive ? 'border-[var(--cb-accent)]/40 bg-blue-50/30' : 'hover:border-[var(--cb-border2)]'}">
            <span class="drag-handle shrink-0 cursor-grab p-1 rounded text-[var(--cb-border2)] hover:text-[var(--cb-muted)]" aria-hidden="true" title="Déplacer"><i class="fas fa-grip-vertical text-sm"></i></span>
            <div class="h-10 w-10 rounded-lg ${isActive ? 'bg-[var(--cb-accent)] text-white' : 'bg-[var(--cb-bg)] text-[var(--cb-muted)]'} flex items-center justify-center shrink-0 border border-[var(--cb-border)]" aria-hidden="true"><i class="fas ${v.icon} text-sm"></i></div>
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-[var(--cb-text)] truncate">${esc(v.name)}</div>
                <div class="flex flex-wrap gap-1 mt-1">${fuelBadges}${v.tankSize ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded border border-[var(--cb-border2)] text-[var(--cb-muted)]"><i class="fas fa-gas-pump mr-0.5" aria-hidden="true"></i>${v.tankSize}\u202fL</span>` : ''}</div>
            </div>
            <button type="button" onclick="openVehicleForm('${v.id}')" class="touch-manipulation cb-btn cb-btn-ghost min-h-[2.25rem] min-w-[2.25rem] !p-0 shrink-0" title="Modifier" aria-label="Modifier ${esc(v.name)}"><i class="fas fa-pen text-sm" aria-hidden="true"></i></button>
            <button type="button" onclick="confirmDeleteVehicle('${v.id}')" class="touch-manipulation cb-btn cb-btn-ghost min-h-[2.25rem] min-w-[2.25rem] !p-0 shrink-0 hover:text-red-600" title="Supprimer" aria-label="Supprimer ${esc(v.name)}"><i class="fas fa-trash text-sm" aria-hidden="true"></i></button>
        </div>`;
    });
    container.innerHTML = html;
    if (vehicleDnD) vehicleDnD.destroy();
    vehicleDnD = null;
    if (userVehicles.length > 1) {
        vehicleDnD = new TouchDragReorder(container, {
            onReorder: (from, slotIdx) => reorderVehicle(from, slotIdx)
        });
    }
}

function openVehicleForm(vehicleId) {
    editingVehicleId = vehicleId || null;
    clearVehicleFormErrors();
    const form = document.getElementById('vehicle-form');
    const addBtn = document.getElementById('vehicle-add-btn');
    form.classList.remove('hidden');
    if (addBtn) addBtn.classList.add('hidden');

    const existing = vehicleId ? userVehicles.find(v => v.id === vehicleId) : null;
    document.getElementById('vehicle-name-input').value = existing ? existing.name : '';
    document.getElementById('vehicle-tank-input').value = existing && existing.tankSize ? existing.tankSize : '';

    const selectedIcon = existing ? existing.icon : VEHICLE_ICONS[0].icon;
    const picker = document.getElementById('vehicle-icon-picker');
    picker.innerHTML = VEHICLE_ICONS.map(vi =>
        `<button type="button" onclick="selectVehicleIcon('${vi.icon}')" data-icon="${vi.icon}" class="vehicle-icon-btn touch-manipulation h-10 w-10 flex items-center justify-center rounded-xl border-2 transition text-base ${vi.icon === selectedIcon ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300'}" title="${vi.label}"><i class="fas ${vi.icon}"></i></button>`
    ).join('');

    const selectedFuels = existing ? existing.fuels : [];
    const fuelCbs = document.getElementById('vehicle-fuel-checkboxes');
    fuelCbs.innerHTML = ALL_FUELS.map(f => {
        const checked = selectedFuels.includes(f);
        return `<label class="vehicle-fuel-label touch-manipulation inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 text-sm font-semibold cursor-pointer transition select-none ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'}">
            <input type="checkbox" value="${f}" class="vehicle-fuel-cb sr-only" ${checked ? 'checked' : ''} onchange="toggleVehicleFuelStyle(this)">${f}</label>`;
    }).join('');

    document.getElementById('vehicle-name-input').focus();
}

function closeVehicleForm() {
    editingVehicleId = null;
    clearVehicleFormErrors();
    document.getElementById('vehicle-form').classList.add('hidden');
    const addBtn = document.getElementById('vehicle-add-btn');
    if (addBtn) addBtn.classList.remove('hidden');
}

function selectVehicleIcon(icon) {
    document.querySelectorAll('#vehicle-icon-picker .vehicle-icon-btn').forEach(btn => {
        const isSelected = btn.dataset.icon === icon;
        btn.className = `vehicle-icon-btn touch-manipulation h-10 w-10 flex items-center justify-center rounded-xl border-2 transition text-base ${isSelected ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300'}`;
    });
}

function toggleVehicleFuelStyle(cb) {
    const label = cb.closest('.vehicle-fuel-label');
    if (cb.checked) {
        label.className = label.className.replace('border-slate-200 bg-white text-slate-600 hover:border-indigo-300', 'border-indigo-500 bg-indigo-50 text-indigo-700');
    } else {
        label.className = label.className.replace('border-indigo-500 bg-indigo-50 text-indigo-700', 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300');
    }
    if (document.querySelectorAll('.vehicle-fuel-cb:checked').length > 0) setVehicleFuelsError(false);
}

function saveVehicleForm() {
    clearVehicleFormErrors();
    const nameIn = document.getElementById('vehicle-name-input');
    const tankIn = document.getElementById('vehicle-tank-input');
    const name = nameIn ? nameIn.value.trim() : '';
    const selectedIcon = document.querySelector('#vehicle-icon-picker .vehicle-icon-btn.border-indigo-500');
    const icon = selectedIcon ? selectedIcon.dataset.icon : 'fa-car';
    const fuels = [...document.querySelectorAll('.vehicle-fuel-cb:checked')].map(cb => cb.value);
    const tankStr = tankIn ? tankIn.value.trim() : '';
    let tankSize = null;
    let tankBad = false;
    if (tankStr !== '') {
        const tankRaw = parseInt(tankStr, 10);
        if (!Number.isFinite(tankRaw) || tankRaw < 1 || tankRaw > 999) tankBad = true;
        else tankSize = tankRaw;
    }
    let valid = true;
    if (!name) {
        setVehicleNameError(true);
        valid = false;
    }
    if (fuels.length === 0) {
        setVehicleFuelsError(true);
        valid = false;
    }
    if (tankBad) {
        setVehicleTankError(true);
        valid = false;
    }
    if (!valid) {
        if (!name && nameIn) nameIn.focus();
        else if (fuels.length === 0) document.querySelector('.vehicle-fuel-cb')?.focus();
        else if (tankIn) tankIn.focus();
        return;
    }

    if (editingVehicleId) {
        updateVehicle(editingVehicleId, name, icon, fuels, tankSize);
    } else {
        const v = addVehicle(name, icon, fuels, tankSize);
        if (!v) return;
    }
    closeVehicleForm();
    refreshAllViews();
}

function confirmDeleteVehicle(id) {
    const v = userVehicles.find(v => v.id === id);
    if (!v) return;
    if (!confirm(`Supprimer le véhicule « ${v.name} » ?`)) return;
    deleteVehicle(id);
    refreshAllViews();
}

// Paramètres & Sauvegarde
let saveTimeout;
function debouncedSaveSettings() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 300);
}

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    const btn = document.getElementById('btn-open-settings');
    if (!modal) return;
    modal.classList.toggle('hidden');
    const open = !modal.classList.contains('hidden');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function saveSettings() {
    userRadius = parseFloat(document.getElementById('radius-slider').value);
    localStorage.setItem(LS_RADIUS, userRadius);
    refreshAllViews();
}

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

// Lieux Favoris
/** Parse lat/lon (nombre, chaîne OSM, virgule décimale éventuelle). */
function parseCoord(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const s = String(v).trim().replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
}

/** Clé stable pour un favori « adresse » (évite incohérences id / recherche OSM). */
function addressFavoriteKey(lat, lon) {
    const la = parseCoord(lat);
    const lo = parseCoord(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return '';
    return `${la.toFixed(6)}-${lo.toFixed(6)}`;
}

/** Migre coords + id des favoris adresse et supprime les doublons géographiques. */
function migrateAddressFavoritesCoords() {
    let changed = false;
    const seenKeys = new Set();
    const next = [];
    for (const f of userFavorites) {
        if (f.type === 'station') {
            next.push(f);
            continue;
        }
        if (f.type !== 'address') {
            next.push(f);
            continue;
        }
        const la = parseCoord(f.lat);
        const lo = parseCoord(f.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) {
            changed = true;
            continue;
        }
        const key = addressFavoriteKey(la, lo);
        if (!key || seenKeys.has(key)) {
            changed = true;
            continue;
        }
        seenKeys.add(key);
        if (f.id !== key || f.lat !== la || f.lon !== lo) changed = true;
        next.push({ ...f, id: key, lat: la, lon: lo });
    }
    if (changed) {
        userFavorites = next;
        saveFavorites();
    }
}

function toggleFavoriteAddress(lat, lon, name) {
    const la = parseCoord(lat);
    const lo = parseCoord(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    const idStr = addressFavoriteKey(la, lo);
    const idx = userFavorites.findIndex(f => f.type === 'address' && addressFavoriteKey(f.lat, f.lon) === idStr);
    const wasFav = idx > -1;
    if (wasFav) userFavorites.splice(idx, 1);
    else userFavorites.push({ id: idStr, type: 'address', name, lat: la, lon: lo });
    saveFavorites();
    renderFavorites();
    if (!document.getElementById('home-view').classList.contains('hidden')) {
        debouncedSearch();
    }
    syncFavoriteHeaderButton();
    showToast(wasFav ? 'Lieu retiré des favoris' : 'Lieu ajouté aux favoris', wasFav ? 'fa-bookmark' : 'fa-star');
}

function toggleFavoriteCurrentStation() {
    const sid = document.getElementById('station-view').getAttribute('data-current-id');
    const s = db.stations[sid];
    const idx = userFavorites.findIndex(f => f.id === sid);
    const wasFav = idx > -1;
    if (wasFav) userFavorites.splice(idx, 1);
    else userFavorites.push({ id: sid, type: 'station', name: s.nom_osm || 'Station-service', adresse: `${s.adresse}, ${s.ville}` });
    saveFavorites();
    updateStarUI(sid);
    renderFavorites();
    showToast(wasFav ? 'Station retirée des favoris' : 'Station ajoutée aux favoris', wasFav ? 'fa-circle-minus' : 'fa-star');
}

function updateStarUI(sid) {
    const btn = document.getElementById('btn-favorite-station');
    const isFav = userFavorites.some(f => f.id === sid);
        if (isFav) {
        btn.innerHTML = `<i class="fas fa-star text-yellow-400"></i>`;
        btn.title = 'Retirer des favoris';
        btn.className = 'touch-manipulation inline-flex items-center justify-center min-h-[2.75rem] min-w-[2.75rem] text-2xl transition hover:scale-110 active:scale-95 hover:text-red-400 rounded-full';
    } else {
        btn.innerHTML = `<i class="far fa-star text-slate-300 hover:text-yellow-400"></i>`;
        btn.title = 'Ajouter aux favoris';
        btn.className = 'touch-manipulation inline-flex items-center justify-center min-h-[2.75rem] min-w-[2.75rem] text-2xl transition hover:scale-110 active:scale-95 rounded-full';
    }
}

/** Point de recherche actif pour carte station + comparaison de prix (liste proximité ou favori adresse). */
function getActiveSearchOrigin() {
    if (currentProximitySearch) {
        const la = parseCoord(currentProximitySearch.lat);
        const lo = parseCoord(currentProximitySearch.lon);
        if (Number.isFinite(la) && Number.isFinite(lo)) {
            return { lat: la, lon: lo, labelTitle: currentProximitySearch.labelTitle || '' };
        }
    }
    if (stationDetailSearchAnchor) {
        const la = parseCoord(stationDetailSearchAnchor.lat);
        const lo = parseCoord(stationDetailSearchAnchor.lon);
        if (Number.isFinite(la) && Number.isFinite(lo)) {
            return { lat: la, lon: lo, labelTitle: stationDetailSearchAnchor.labelTitle || '' };
        }
    }
    return null;
}

function showStationWithFavoriteOrigin(stationId, lat, lon, labelTitle) {
    const la = parseCoord(lat);
    const lo = parseCoord(lon);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
        stationDetailSearchAnchor = { lat: la, lon: lo, labelTitle: labelTitle || 'Lieu favori' };
    } else {
        stationDetailSearchAnchor = null;
    }
    showStation(stationId);
}

function toggleFavoriteProximitySearchPoint() {
    if (!currentProximitySearch) return;
    const la = parseCoord(currentProximitySearch.lat);
    const lo = parseCoord(currentProximitySearch.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    toggleFavoriteAddress(la, lo, currentProximitySearch.labelTitle || 'Lieu');
}

/**
 * Étoile d'en-tête : station (fiche) ou lieu de la recherche « autour de ».
 */
function syncFavoriteHeaderButton() {
    const btn = document.getElementById('btn-favorite-station');
    const stationView = document.getElementById('station-view');
    if (!btn || !stationView || stationView.classList.contains('hidden')) return;

    const sid = stationView.getAttribute('data-current-id');
    if (sid && db && db.stations[sid]) {
        btn.classList.remove('hidden');
        btn.onclick = () => toggleFavoriteCurrentStation();
        updateStarUI(sid);
        btn.setAttribute('aria-label', userFavorites.some(f => f.id === sid) ? 'Retirer cette station des favoris' : 'Ajouter cette station aux favoris');
        return;
    }

    if (currentProximitySearch) {
        const la = parseCoord(currentProximitySearch.lat);
        const lo = parseCoord(currentProximitySearch.lon);
        if (Number.isFinite(la) && Number.isFinite(lo)) {
            btn.classList.remove('hidden');
            const key = addressFavoriteKey(la, lo);
            const isFav = key && userFavorites.some(f => f.type === 'address' && addressFavoriteKey(f.lat, f.lon) === key);
            btn.onclick = () => toggleFavoriteProximitySearchPoint();
            btn.innerHTML = isFav
                ? '<i class="fas fa-star text-yellow-400" aria-hidden="true"></i>'
                : '<i class="far fa-star text-slate-300 hover:text-yellow-400" aria-hidden="true"></i>';
            btn.title = isFav ? 'Retirer ce lieu des favoris' : 'Ajouter ce lieu aux favoris';
            btn.setAttribute('aria-label', btn.title);
            btn.className = `touch-manipulation inline-flex items-center justify-center min-h-[2.75rem] min-w-[2.75rem] text-2xl transition hover:scale-110 active:scale-95 rounded-full${isFav ? ' hover:text-red-400' : ''}`;
            return;
        }
    }

    btn.classList.add('hidden');
}

function removeFavorite(id) {
    userFavorites = userFavorites.filter(f => f.id !== id);
    saveFavorites();
    renderFavorites();
    syncFavoriteHeaderButton();
    showToast('Favori retiré', 'fa-bookmark');
}

function renderFavorites() {
    const container = document.getElementById('favorites-container');
    const list = document.getElementById('favorites-list');
    migrateAddressFavoritesCoords();
    const prevLen = userFavorites.length;
    userFavorites = userFavorites.filter(f => f.type !== 'station' || (db && db.stations[f.id]));
    if (userFavorites.length !== prevLen) saveFavorites();
    if (userFavorites.length === 0) {
        container.classList.add('hidden');
        if (favDnD) { favDnD.destroy(); favDnD = null; }
        return;
    }
    container.classList.remove('hidden');
    let allHtml = '';

    for (let i = 0; i < userFavorites.length; i++) {
        const f = userFavorites[i];
        if (f.type === 'station') {
            let pricesHtml = '';
            const st = db ? db.stations[f.id] : null;
            if (st && st.carburants_disponibles) {
                let tags = [];
                for (const [c, d] of Object.entries(st.carburants_disponibles)) {
                    if (!userFuels.includes(c)) continue;
                    const col = prixColorTag(f.id, c, d.prix);
                    const majT = formatMajLabel(d);
                    const t = [col.title, majT ? `Maj. ${majT}` : ""].filter(Boolean).join(" · ");
                    const ta = t ? ` title="${esc(t)}"` : '';
                    const tankInfo = fullTankHtml(parseFloat(d.prix), 'compact');
                    tags.push(`<div class="inline-flex flex-col gap-0.5 rounded-lg border border-slate-200/70 bg-white/90 p-1 shadow-sm max-w-[9rem]"${ta}><span class="inline-block ${col.bg} ${col.text} text-[11px] font-bold px-1.5 py-0.5 rounded text-center">${c} ${d.prix}€</span>${tankInfo}</div>`);
                }
                if (tags.length) pricesHtml = `<div class="flex flex-wrap gap-1 mt-1.5">${tags.join('')}</div>`;
            }
            allHtml += `
                <div data-drag-index="${i}" class="p-4 bg-gradient-to-br from-amber-50 via-yellow-50/60 to-orange-50/30 border-2 border-amber-300/70 rounded-2xl hover:shadow-lg hover:border-amber-500 transition group shadow-sm">
                    <div class="flex justify-between items-start gap-2">
                        <span class="drag-handle shrink-0 self-start mt-0.5 p-1 rounded text-amber-200 hover:text-amber-400" aria-hidden="true" title="Déplacer"><i class="fas fa-grip-vertical text-sm"></i></span>
                        <div onclick="showStation('${f.id}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="flex items-start gap-2 min-w-0">
                                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md" aria-hidden="true"><i class="fas fa-gas-pump"></i></span>
                                <div class="min-w-0">
                                    <div class="font-extrabold text-amber-950 truncate leading-tight">${esc(f.name)}</div>
                                    <div class="text-xs font-semibold text-amber-900/85 truncate mt-1">${esc(f.adresse)}</div>
                                </div>
                            </div>
                        </div>
                        <button type="button" onclick="event.stopPropagation(); removeFavorite('${f.id}')" class="touch-manipulation ml-1 flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-white border-2 border-amber-200 text-amber-500 hover:text-red-600 hover:border-red-300 transition" title="Retirer des favoris" aria-label="Retirer cette station des favoris"><i class="fas fa-star text-lg" aria-hidden="true"></i></button>
                    </div>
                    <div onclick="showStation('${f.id}')" class="cursor-pointer mt-2">${pricesHtml}</div>
                </div>`;
        } else {
            const favRadius = f.radius ? parseFloat(f.radius) : userRadius;
            let bestCards = '';
            if (db && f.lat && f.lon) {
                const favLat = parseCoord(f.lat);
                const favLon = parseCoord(f.lon);
                if (Number.isFinite(favLat) && Number.isFinite(favLon)) {
                    let nearbyStations = [];
                    const maxKm = maxStraightLineKmForFavorite(f);
                    for (const [id, s] of Object.entries(db.stations)) {
                        if (!s.lat || !s.lon || !hasTrackedFuel(s)) continue;
                        const straight = distanceHaversine(favLat, favLon, s.lat, s.lon);
                        if (straight <= maxKm) nearbyStations.push({ id, station: s, dist: straight });
                    }
                    userFuels.forEach(fuel => {
                        const best = pickBestStationForFuelByPriceThenDistance(nearbyStations, fuel);
                        if (best) {
                            const stB = db.stations[best.id];
                            const fd = stB && stB.carburants_disponibles ? stB.carburants_disponibles[fuel] : null;
                            const maj = fd ? formatMajHtml(fd) : "";
                            bestCards += `<div onclick="event.stopPropagation(); showStationWithFavoriteOrigin('${best.id}', ${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="bg-gradient-to-b from-green-50 to-emerald-50/80 border-2 border-green-300/80 rounded-xl p-2 text-center cursor-pointer hover:shadow-lg transition min-w-0 shadow-md"><div class="text-[10px] font-extrabold uppercase tracking-wide text-green-950">${fuel}</div><div class="text-base font-black text-green-900 tabular-nums my-0.5">${best.prix.toFixed(3)}<span class="text-xs font-bold">€</span></div>${fullTankHtml(best.prix, 'proximity', 'green')}${maj ? `<div class="text-[8px] text-green-800 font-bold italic leading-tight mt-0.5" translate="no"><i class="fas fa-clock mr-0.5 not-italic text-amber-600"></i>${maj}</div>` : ''}<div class="text-[9px] font-bold text-green-900 truncate mt-0.5">${esc(best.nom)}</div></div>`;
                        }
                    });
                }
            }
            const safeId  = esc(f.id);
            const safeName = f.name.replace(/'/g, "\\'");
            const widgetRow = bestCards ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">${bestCards}</div>` : '';
            allHtml += `
                <div data-drag-index="${i}" class="p-4 bg-gradient-to-br from-indigo-50 via-white to-violet-50/40 border-2 border-indigo-200/80 rounded-2xl hover:shadow-lg hover:border-indigo-400 transition group shadow-sm">
                    <div class="flex justify-between items-start gap-2">
                        <span class="drag-handle shrink-0 self-start mt-0.5 p-1 rounded text-indigo-200 hover:text-indigo-400" aria-hidden="true" title="Déplacer"><i class="fas fa-grip-vertical text-sm"></i></span>
                        <div onclick="findStationsNearFav(${f.lat}, ${f.lon}, '${safeName}', '${safeId}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="flex items-start gap-2">
                                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md" aria-hidden="true"><i class="fas fa-map-marker-alt"></i></span>
                                <div class="min-w-0">
                                    <div class="font-extrabold text-indigo-950 truncate leading-tight">${esc(f.name)}</div>
                                    <div class="text-xs font-bold text-indigo-800 mt-1">Lieu favori · rayon <span class="price-num">~${favRadius}\u202fkm</span></div>
                                </div>
                            </div>
                        </div>
                        <button type="button" onclick="event.stopPropagation(); removeFavorite('${safeId}')" class="touch-manipulation flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border-2 border-indigo-200 text-amber-500 hover:text-red-600 hover:border-red-300 transition" title="Retirer des favoris" aria-label="Retirer ce lieu des favoris"><i class="fas fa-star text-lg" aria-hidden="true"></i></button>
                    </div>
                    <div class="flex items-center gap-2 mt-2 pl-7" onclick="event.stopPropagation()">
                        <button type="button" onclick="adjustFavRadius('${safeId}', -5)" class="touch-manipulation flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--cb-border2)] text-[var(--cb-muted)] hover:border-[var(--cb-accent)] hover:text-[var(--cb-accent)] transition text-base font-bold select-none" aria-label="Réduire le rayon de 5 km" title="−5 km">−</button>
                        <span class="text-xs text-[var(--cb-muted)] price-num select-none">~${favRadius}\u202fkm</span>
                        <button type="button" onclick="adjustFavRadius('${safeId}', 5)" class="touch-manipulation flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--cb-border2)] text-[var(--cb-muted)] hover:border-[var(--cb-accent)] hover:text-[var(--cb-accent)] transition text-base font-bold select-none" aria-label="Augmenter le rayon de 5 km" title="+5 km">+</button>
                    </div>
                    <div onclick="findStationsNearFav(${f.lat}, ${f.lon}, '${safeName}', '${safeId}')" class="cursor-pointer">${widgetRow}</div>
                </div>`;
        }
    }
    list.innerHTML = allHtml;
    // Drag & drop pour réorganiser les favoris
    if (favDnD) favDnD.destroy();
    favDnD = null;
    if (userFavorites.length > 1) {
        favDnD = new TouchDragReorder(list, {
            onReorder: (from, slotIdx) => reorderFavorite(from, slotIdx)
        });
    }
}

/** Tolérance float (€) pour considérer deux prix comme égaux. */
const PRICE_EPS = 0.0005;
/** Au-delà de cet écart vs le minimum, on affiche un message « vous pouvez faire mieux ». */
const PRICE_NEAR_MAX = 0.03;

/** Tri par prix croissant pour un carburant ; à prix équivalent (dans PRICE_EPS), par distance croissante (km). */
function compareStationEntriesByPriceThenDistance(sortFuel, a, b) {
    const pa = parseFloat(a.station.carburants_disponibles[sortFuel].prix);
    const pb = parseFloat(b.station.carburants_disponibles[sortFuel].prix);
    if (Math.abs(pa - pb) > PRICE_EPS) return pa - pb;
    return a.dist - b.dist;
}

/**
 * Meilleur prix pour un carburant parmi des entrées { id, station, dist? }.
 * Même règle que le tri proximité : prix puis distance (dist omise → 0, ex. zone géo).
 */
function pickBestStationForFuelByPriceThenDistance(candidates, fuel) {
    let best = null;
    for (const entry of candidates) {
        const row = entry.station.carburants_disponibles[fuel];
        if (!row) continue;
        const prix = parseFloat(row.prix);
        if (!Number.isFinite(prix)) continue;
        const dist = Number.isFinite(entry.dist) ? entry.dist : 0;
        if (!best) {
            best = { prix, id: entry.id, nom: entry.station.nom_osm || entry.station.ville, dist };
            continue;
        }
        const dp = prix - best.prix;
        if (dp < -PRICE_EPS || (Math.abs(dp) <= PRICE_EPS && dist < best.dist - 1e-12)) {
            best = { prix, id: entry.id, nom: entry.station.nom_osm || entry.station.ville, dist };
        }
    }
    if (!best) return null;
    return { prix: best.prix, id: best.id, nom: best.nom };
}

function formatFrEuros(n) {
    return n.toFixed(3).replace('.', ',');
}

/** Libellé de mise à jour : heure locale si `maj_iso` (flux / fichier quotidien enrichi), sinon date seule. */
function formatMajLabel(entry) {
    if (!entry) return "";
    if (entry.maj_iso) {
        try {
            const d = new Date(entry.maj_iso);
            if (!isNaN(d.getTime())) {
                return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
            }
        } catch (e) { /* ignore */ }
    }
    return entry.date_maj || "";
}

function formatMajHtml(entry) {
    const s = formatMajLabel(entry);
    return s ? esc(s) : "";
}

/** Montant estimé du plein (litres × prix/L), ou null si non calculable. */
function fullTankEuroStr(prixNum) {
    const tank = getActiveTankSize();
    if (!tank || !Number.isFinite(prixNum)) return null;
    return (prixNum * tank).toFixed(2).replace('.', ',');
}

/** Couleurs du bloc « plein » pour listes proximité / zone (aligné sur le badge prix). */
function fullTankListToneClasses(tone) {
    const t = {
        green: {
            grad: 'from-emerald-50 via-green-50 to-teal-50/90',
            border: 'border-emerald-400/85',
            shadow: 'shadow-md shadow-emerald-100/60',
            icon: 'text-emerald-600',
            lab: 'text-emerald-900',
            val: 'text-emerald-950',
        },
        amber: {
            grad: 'from-amber-50 via-orange-50 to-amber-50/90',
            border: 'border-amber-400/85',
            shadow: 'shadow-md shadow-amber-100/60',
            icon: 'text-amber-600',
            lab: 'text-amber-950',
            val: 'text-amber-950',
        },
        indigo: {
            grad: 'from-indigo-50 via-violet-50 to-indigo-50/90',
            border: 'border-indigo-400/85',
            shadow: 'shadow-md shadow-indigo-100/50',
            icon: 'text-indigo-600',
            lab: 'text-indigo-950',
            val: 'text-indigo-950',
        },
        neutral: {
            grad: 'from-slate-50 via-cyan-50/60 to-teal-50/80',
            border: 'border-teal-300/90',
            shadow: 'shadow-md shadow-slate-200/40',
            icon: 'text-teal-600',
            lab: 'text-teal-900',
            val: 'text-teal-950',
        },
    };
    return t[tone] || t.neutral;
}

function tankToneFromPrixColorBg(bgClass) {
    if (!bgClass) return 'neutral';
    if (bgClass.includes('green')) return 'green';
    if (bgClass.includes('amber')) return 'amber';
    if (bgClass.includes('indigo')) return 'indigo';
    return 'neutral';
}

/** Distance + libellés pour une ligne de liste « autour de ». */
function proximityDistanceRowHtml(straightKm) {
    return `<div class="proximity-dist-row mt-2 flex items-stretch gap-2.5 rounded-xl border-2 border-indigo-200/70 bg-gradient-to-r from-indigo-50/90 via-white to-sky-50/50 p-2 sm:p-2.5 shadow-sm">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-xl bg-indigo-600 text-white text-base shadow-md shadow-indigo-300/40" aria-hidden="true"><i class="fas fa-route"></i></span>
        <div class="min-w-0 flex-1 leading-tight py-0.5">
            <div class="text-[10px] font-extrabold uppercase tracking-wider text-indigo-800/90">Distance routière estimée</div>
            <div class="mt-0.5 text-base sm:text-lg font-black text-slate-900 tabular-nums">${distanceKmSpan(straightKm)}</div>
            <div class="text-[10px] font-semibold italic text-slate-500 mt-0.5">depuis votre point de recherche</div>
        </div>
    </div>`;
}

/**
 * Estimation plein réservoir — même langage visuel que les cartes prix (teal, dégradé, icône, graisse).
 * variant: 'detail' fiche station · 'compact' listes & widgets · 'micro' inline · 'proximity' liste à proximité (listTone: green|amber|indigo|neutral).
 */
function fullTankHtml(prixNum, variant = 'detail', listTone = 'neutral') {
    const total = fullTankEuroStr(prixNum);
    if (!total) return '';
    const iconFill = '<i class="fas fa-fill-drip" aria-hidden="true"></i>';
    if (variant === 'micro') {
        return ` <span class="whitespace-nowrap text-[10px] font-bold text-teal-800"><span class="text-teal-600">${iconFill}</span> <em class="not-italic font-semibold text-teal-700">plein</em> <strong class="tabular-nums">${total}\u202f€</strong></span>`;
    }
    if (variant === 'proximity') {
        const tc = fullTankListToneClasses(listTone);
        return `<div class="full-tank-estimate mt-1.5 flex flex-col items-stretch rounded-xl border-2 bg-gradient-to-br ${tc.grad} ${tc.border} px-2.5 py-2 sm:py-2.5 ${tc.shadow}">
            <div class="flex items-center justify-center gap-1.5 ${tc.lab}">
                <span class="${tc.icon} text-base sm:text-lg leading-none" aria-hidden="true">${iconFill}</span>
                <span class="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wide">Plein réservoir</span>
            </div>
            <div class="mt-1 text-center font-black tabular-nums text-lg sm:text-xl leading-none ${tc.val}">${total}<span class="text-sm font-bold opacity-80">\u202f€</span></div>
        </div>`;
    }
    if (variant === 'compact') {
        return `<div class="full-tank-estimate mt-1 flex items-center justify-center gap-1 rounded-lg border border-teal-200/90 bg-gradient-to-r from-teal-50 to-cyan-50 px-1.5 py-1 text-center shadow-sm"><span class="text-teal-600 text-sm leading-none">${iconFill}</span><span class="text-[10px] font-bold leading-tight text-teal-950"><em class="not-italic font-semibold text-teal-800">Plein</em> <strong class="tabular-nums">${total}\u202f€</strong></span></div>`;
    }
    return `<div class="full-tank-estimate mt-2 flex items-center gap-3 rounded-2xl border-2 border-teal-300/80 bg-gradient-to-br from-teal-50 via-cyan-50/90 to-teal-50/80 px-3 py-3 shadow-md"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-white text-lg shadow-md" aria-hidden="true">${iconFill}</span><div class="min-w-0 text-left leading-tight"><div class="text-[10px] font-extrabold uppercase tracking-wide text-teal-900/90">Estimation plein réservoir</div><div class="text-xl font-black tabular-nums text-teal-950">${total}<span class="text-sm font-bold text-teal-700">\u202f€</span></div><div class="text-[10px] font-semibold text-teal-800/80 mt-0.5">Basée sur le réservoir du véhicule actif</div></div></div>`;
}

/** Colonne prix + plein pour une ligne de résultat de recherche (stations). */
function buildSearchStationPriceColumn(stationId, station) {
    const fuelsShown = userFuels.filter(f => station.carburants_disponibles[f]);
    if (fuelsShown.length === 0) {
        return '<i class="fas fa-chevron-right text-slate-300 group-hover:text-indigo-500 transition flex-shrink-0 text-lg self-center"></i>';
    }
    let blocks = '';
    fuelsShown.forEach(f => {
        const d = station.carburants_disponibles[f];
        const prixNum = parseFloat(d.prix);
        const col = prixColorTag(stationId, f, d.prix);
        const mj = formatMajHtml(d);
        const t = [col.title, mj ? `Maj. ${mj}` : ''].filter(Boolean).join(' · ');
        const ta = t ? ` title="${esc(t)}"` : '';
        blocks += `
            <div class="flex flex-col items-stretch gap-1 rounded-2xl border-2 border-slate-200/90 bg-gradient-to-b from-white to-slate-50/50 p-2 shadow-md"${ta}>
                <div class="text-[10px] font-extrabold uppercase tracking-wide ${col.text} truncate">${f}</div>
                <div class="${col.bg} ${col.text} font-black text-base tabular-nums text-center rounded-lg border border-white/50 px-2 py-1">${d.prix}<span class="text-xs font-bold opacity-90">€</span></div>
                ${fullTankHtml(prixNum, 'proximity', tankToneFromPrixColorBg(col.bg))}
                ${mj ? `<div class="text-[9px] font-bold text-slate-600 text-center italic" translate="no"><i class="fas fa-clock mr-0.5 text-amber-500 not-italic"></i>${mj}</div>` : ''}
            </div>`;
    });
    return `<div class="flex flex-col gap-2 shrink-0 w-[7.35rem] sm:w-[8.35rem]">${blocks}</div><i class="fas fa-chevron-right text-indigo-200 group-hover:text-indigo-500 transition flex-shrink-0 self-center text-lg ml-1" aria-hidden="true"></i>`;
}

/**
 * Badge prix dans une liste triée (même carburant) : vert = meilleur de la liste,
 * ambre = proche du minimum, indigo = rappel explicite du prix le plus bas affiché.
 * Colonne largeur fixe + sous-titre sur hauteur fixe pour aligner les cartes entre lignes.
 */
function buildZonePriceListBadge(prixDisplayStr, prixNum, minPrixInList) {
    const col = 'price-list-badge flex flex-col items-stretch justify-center shrink-0 w-[9rem] sm:w-[10rem] gap-1.5 self-center';
    const subSlot = (inner) => `<div class="min-h-[3.25rem] flex items-center justify-center px-0.5">${inner}</div>`;
    const placeholder = '<span class="invisible text-[10px] select-none" aria-hidden="true">·</span>';

    let listTone = 'neutral';
    let delta = null;
    if (minPrixInList !== null && Number.isFinite(prixNum)) {
        delta = prixNum - minPrixInList;
        if (delta <= PRICE_EPS) listTone = 'green';
        else if (delta <= PRICE_NEAR_MAX) listTone = 'amber';
        else listTone = 'indigo';
    }
    const tankRow = fullTankHtml(prixNum, 'proximity', listTone);

    if (minPrixInList === null || !Number.isFinite(prixNum)) {
        return {
            markerType: 'station_blue',
            html: `<div class="${col}">
                <div class="rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/80 px-2 sm:px-3 py-2 text-center shadow-sm">
                    <div class="text-[9px] font-extrabold uppercase tracking-wide text-slate-500">Prix au litre</div>
                    <div class="font-black text-lg sm:text-xl text-slate-900 tabular-nums leading-tight">${prixDisplayStr}<span class="text-sm font-bold text-slate-600"> €</span></div>
                </div>
                ${tankRow}
                ${subSlot(placeholder)}
            </div>`,
        };
    }
    if (delta <= PRICE_EPS) {
        return {
            markerType: 'station_green',
            html: `<div class="${col}">
                <div class="rounded-xl border-2 border-emerald-400/80 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 px-2 sm:px-3 py-2 text-center shadow-md shadow-emerald-100/50">
                    <div class="text-[9px] font-extrabold uppercase tracking-wide text-emerald-800">Prix au litre</div>
                    <div class="font-black text-lg sm:text-xl text-emerald-950 tabular-nums leading-tight">${prixDisplayStr}<span class="text-sm font-bold text-emerald-700"> €</span></div>
                </div>
                ${tankRow}
                ${subSlot(`<p class="text-[10px] sm:text-[11px] font-bold text-emerald-900 text-center leading-snug"><i class="fas fa-trophy text-amber-500 mr-0.5" aria-hidden="true"></i><em class="not-italic">Meilleur prix</em> de la liste</p>`)}
            </div>`,
        };
    }
    const minFmt = formatFrEuros(minPrixInList);
    if (delta <= PRICE_NEAR_MAX) {
        return {
            markerType: 'station_orange',
            html: `<div class="${col}">
                <div class="rounded-xl border-2 border-amber-400/80 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50/90 px-2 sm:px-3 py-2 text-center shadow-md shadow-amber-100/50">
                    <div class="text-[9px] font-extrabold uppercase tracking-wide text-amber-900">Prix au litre</div>
                    <div class="font-black text-lg sm:text-xl text-amber-950 tabular-nums leading-tight">${prixDisplayStr}<span class="text-sm font-bold text-amber-800"> €</span></div>
                </div>
                ${tankRow}
                ${subSlot(`<p class="text-[10px] sm:text-[11px] font-bold text-amber-950 text-center leading-snug">+<strong class="tabular-nums">${formatFrEuros(delta)}</strong> € <span class="font-semibold opacity-90">vs le moins cher</span></p>`)}
            </div>`,
        };
    }
    return {
        markerType: 'station_blue',
        html: `<div class="${col}">
            <div class="rounded-xl border-2 border-indigo-400/80 bg-gradient-to-br from-indigo-50 via-violet-50 to-indigo-50/90 px-2 sm:px-3 py-2 text-center shadow-md shadow-indigo-100/40">
                <div class="text-[9px] font-extrabold uppercase tracking-wide text-indigo-900">Prix au litre</div>
                <div class="font-black text-lg sm:text-xl text-indigo-950 tabular-nums leading-tight">${prixDisplayStr}<span class="text-sm font-bold text-indigo-700"> €</span></div>
            </div>
            ${tankRow}
            ${subSlot(`<p class="text-[10px] sm:text-[11px] text-indigo-950 text-center leading-snug"><span class="font-extrabold">Mieux à ${minFmt} €</span> <span class="font-semibold text-indigo-800">dans cette liste</span></p>`)}
        </div>`,
    };
}

const nearbyStationCache = new Map();
function getNearbyStations(stationId) {
    const cap = nearbyCompareStraightKm();
    const cacheKey = `${stationId}|${cap}`;
    if (nearbyStationCache.has(cacheKey)) return nearbyStationCache.get(cacheKey);
    const st = db.stations[stationId];
    if (!st || !st.lat || !st.lon) { nearbyStationCache.set(cacheKey, []); return []; }
    const ids = [];
    for (const [id, s] of Object.entries(db.stations)) {
        if (id === stationId || !s.lat || !s.lon) continue;
        if (distanceHaversine(st.lat, st.lon, s.lat, s.lon) <= cap) ids.push(id);
    }
    nearbyStationCache.set(cacheKey, ids);
    return ids;
}

function prixColorTag(stationId, carburant, prix) {
    const st = db.stations[stationId];
    if (!st || !st.lat || !st.lon) return { bg: 'bg-slate-100', text: 'text-slate-700', title: '' };
    const prixNum = parseFloat(prix);
    const nearbyIds = getNearbyStations(stationId);
    const prices = [prixNum];
    for (const id of nearbyIds) {
        const s = db.stations[id];
        if (s.carburants_disponibles[carburant]) prices.push(parseFloat(s.carburants_disponibles[carburant].prix));
    }
    if (prices.length < 2) return { bg: 'bg-slate-100', text: 'text-slate-700', title: '' };
    const minP = Math.min(...prices);
    const delta = prixNum - minP;
    if (delta <= PRICE_EPS) return { bg: 'bg-green-100', text: 'text-green-800', title: 'Meilleur prix parmi les stations très proches' };
    if (delta <= PRICE_NEAR_MAX) return { bg: 'bg-amber-100', text: 'text-amber-900', title: `Très proche du minimum local (${minP.toFixed(3)} €)` };
    return {
        bg: 'bg-indigo-100',
        text: 'text-indigo-900',
        title: `Moins cher à ${minP.toFixed(3)} € dans les environs`,
    };
}

// UI Navigation Tabs
function switchTab(tab) {
    // Si la vue station est ouverte, revenir à l'accueil avant de changer d'onglet
    const stationView = document.getElementById('station-view');
    if (stationView && !stationView.classList.contains('hidden')) {
        goHome();
    }

    // Onglet Favoris (mobile) : affiche l'aside, masque le panel principal
    const homeView = document.getElementById('home-view');
    if (homeView) homeView.classList.toggle('fav-tab', tab === 'favoris');

    // Panes + boutons panel-tab (desktop)
    ['recherche', 'palmares', 'statistiques'].forEach(t => {
        const panelBtn = document.getElementById(`tab-${t}`);
        const navBtn   = document.getElementById(`nav-tab-${t}`);
        const pane     = document.getElementById(`pane-${t}`);
        const isActive = t === tab;
        if (panelBtn) panelBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (navBtn)   navBtn.setAttribute('aria-selected',   isActive ? 'true' : 'false');
        if (pane) {
            if (isActive) pane.classList.remove('hidden');
            else          pane.classList.add('hidden');
        }
    });

    // Bottom nav (inclut favoris)
    ['recherche', 'palmares', 'statistiques', 'favoris'].forEach(t => {
        const btn = document.getElementById(`bn-${t}`);
        if (btn) btn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });

    if (tab === 'palmares' && palmaresMap) setTimeout(() => palmaresMap.invalidateSize(), 100);
    if (tab === 'statistiques') renderDashboard();
}

function pushNav(state) {
    if (isRestoringNav) return;
    navStack.push(state);
    history.pushState({ idx: navStack.length }, '');
}

function goHome() {
    navStack = [];
    currentProximitySearch = null;
    stationDetailSearchAnchor = null;
    currentGeoZone = null;
    document.getElementById('station-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    renderFavorites();
}

function goBack() {
    if (navStack.length > 0) {
        history.back();
    } else {
        goHome();
    }
}

window.addEventListener('popstate', () => {
    if (navStack.length === 0) { goHome(); return; }
    const prev = navStack.pop();
    isRestoringNav = true;
    if (prev.type === 'home') goHome();
    else if (prev.type === 'proximity') findStationsNear(prev.lat, prev.lon, prev.label);
    else if (prev.type === 'geoZone') searchGeoZone(prev.geoType, prev.name);
    else goHome();
    isRestoringNav = false;
});

function buildBestPricesWidget(stations) {
    let cards = '';
    userFuels.forEach(fuel => {
        const best = pickBestStationForFuelByPriceThenDistance(stations, fuel);
        if (best) {
            const stBest = db.stations[best.id];
            const addr = stBest ? `${stBest.adresse}, ${stBest.ville}` : '';
            const fd = stBest && stBest.carburants_disponibles ? stBest.carburants_disponibles[fuel] : null;
            const maj = fd ? formatMajHtml(fd) : "";
            cards += `<div onclick="showStation('${best.id}')" class="bg-gradient-to-b from-green-50 to-emerald-50/80 border-2 border-green-200/90 rounded-xl p-2.5 text-center cursor-pointer hover:shadow-lg hover:border-green-400 transition shadow-sm"><div class="text-[11px] font-extrabold text-green-900 uppercase tracking-wide">${fuel}</div><div class="text-xl font-black text-green-800 my-0.5 tabular-nums">${best.prix.toFixed(3)} <span class="text-sm font-bold">€</span></div>${fullTankHtml(best.prix, 'proximity', 'green')}${maj ? `<div class="text-[9px] text-green-700 font-semibold italic" translate="no"><i class="fas fa-clock mr-0.5 not-italic"></i>${maj}</div>` : ''}<div class="text-[10px] font-bold text-green-800 truncate leading-tight mt-0.5">${esc(best.nom)}</div><div class="text-[9px] text-green-600 truncate leading-tight italic">${esc(addr)}</div></div>`;
        }
    });
    if (!cards) return '';
    return `<div class="mb-5 bg-gradient-to-br from-green-50 via-emerald-50/80 to-teal-50/40 border-2 border-green-300/70 rounded-2xl p-4 shadow-sm"><h4 class="text-base font-extrabold text-green-900 mb-3 flex flex-wrap items-center gap-2"><span class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 shadow-sm" aria-hidden="true"><i class="fas fa-trophy text-lg"></i></span><span>Les meilleurs prix <em class="not-italic text-green-700 font-bold text-sm">dans la zone affichée</em></span></h4><div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${cards}</div></div>`;
}

function searchGeoZone(type, name, overrideFuel) {
    let stationIds = [];
    if (type === 'region' && db.region_index[name]) {
        stationIds = db.region_index[name].stations;
    } else if (type === 'dept') {
        for (const [, d] of Object.entries(db.dept_index)) {
            if (d.nom === name) { stationIds = d.stations; break; }
        }
    }
    if (stationIds.length === 0) return;

    if (!document.getElementById('home-view').classList.contains('hidden')) {
        pushNav({ type: 'home' });
    }
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.removeAttribute('data-current-id');
    stationDetailSearchAnchor = null;
    currentProximitySearch = null;
    currentGeoZone = { type, name, stationIds };

    const stationsInZoneForWidget = stationIds
        .map(id => ({ id, station: db.stations[id] }))
        .filter(s => s.station && hasTrackedFuel(s.station));

    let sortFuel = overrideFuel || userFuels[0] || '';
    let stations = [...stationsInZoneForWidget];
    if (sortFuel) {
        stations = stations.filter(s => s.station.carburants_disponibles[sortFuel]);
        stations.sort((a, b) => parseFloat(a.station.carburants_disponibles[sortFuel].prix) - parseFloat(b.station.carburants_disponibles[sortFuel].prix));
    }

    const total = stations.length;
    const nbZoneSuivis = stationsInZoneForWidget.length;
    const zoneLabel = type === 'region' ? name : `${name} (département)`;

    let sortOptions = userFuels.map(f => `<option value="${f}" ${sortFuel === f ? 'selected' : ''}>${f}</option>`).join('');

    const listeGeoLabel = sortFuel
        ? `<span class="text-white font-bold tabular-nums">${total}</span> <span class="text-blue-100/90">avec</span> <em class="not-italic font-black text-amber-200">${esc(sortFuel)}</em>`
        : `<span class="text-blue-100/95 font-medium">tous carburants suivis</span>`;

    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-indigo-200/60">
            <div class="bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-4 sm:p-6 text-white text-center shadow-inner">
                <h2 class="text-lg sm:text-2xl font-extrabold drop-shadow-sm leading-tight px-1"><i class="fas fa-map-marked-alt mr-2 text-cyan-200" aria-hidden="true"></i><em class="not-italic font-black text-white">${esc(zoneLabel)}</em></h2>
                <p class="mt-3 flex flex-wrap justify-center gap-2 text-xs sm:text-sm font-semibold">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 backdrop-blur-sm shadow-sm"><i class="fas fa-gas-pump text-amber-200" aria-hidden="true"></i><strong class="tabular-nums font-black">${nbZoneSuivis}</strong>&nbsp;station${nbZoneSuivis > 1 ? 's' : ''} <span class="font-medium opacity-90">(suivies)</span></span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 backdrop-blur-sm shadow-sm">Liste : ${listeGeoLabel}</span>
                </p>
            </div>
            <div class="p-4 sm:p-6 md:p-8">
                <div id="station-map" class="station-map-shell mb-5 sm:mb-6 w-full"></div>
                ${stationsInZoneForWidget.length ? buildBestPricesWidget(stationsInZoneForWidget) : ''}
                <div class="mb-5 rounded-2xl border-2 border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 via-white to-violet-50/40 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div class="min-w-0">
                        <label for="geo-sort-select" class="flex items-center gap-2 text-sm font-extrabold text-slate-800"><span class="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md" aria-hidden="true"><i class="fas fa-sort-amount-down"></i></span>Trier par prix</label>
                        <p class="mt-1.5 text-xs font-semibold text-slate-600 pl-11 sm:pl-0 sm:ml-11">Carburant utilisé pour la colonne de droite</p>
                    </div>
                    <select id="geo-sort-select" onchange="applyGeoSort('${type}', '${name.replace(/'/g, "\\'")}', this.value)" class="min-h-[3rem] py-3 px-3 border-2 border-indigo-200 rounded-xl text-base font-bold text-indigo-900 bg-white outline-none focus:ring-2 focus:ring-indigo-500 w-full md:w-auto md:min-w-[14rem] touch-manipulation shadow-inner">
                        ${sortOptions}
                    </select>
                </div>
                <div class="space-y-4 max-h-[min(70dvh,70vh)] overflow-y-auto custom-scrollbar scroll-touch">`;

    let minPrixListe = null;
    if (sortFuel && total > 0) {
        minPrixListe = Math.min(...stations.map(s => parseFloat(s.station.carburants_disponibles[sortFuel].prix)));
    }

    if (stationsInZoneForWidget.length > 0 && total === 0) {
        html += uiNoticeBlock('fa-filter', 'bg-amber-500', 'Aucune station ne propose ce carburant dans cette zone.', 'Les <strong class="text-slate-800">meilleurs prix</strong> ci-dessus restent calculés sur <strong class="text-slate-800">tous vos carburants</strong> suivis.');
    }

    stations.forEach((res) => {
        let rightContent = '';
        let markerType = 'station_blue';
        if (sortFuel && res.station.carburants_disponibles[sortFuel]) {
            const prix = res.station.carburants_disponibles[sortFuel].prix;
            const prixNum = parseFloat(prix);
            const badge = buildZonePriceListBadge(String(prix), prixNum, minPrixListe);
            rightContent = badge.html;
            markerType = badge.markerType;
        }
        res.markerType = markerType;

        let carbsHtml = '';
        if (sortFuel && res.station.carburants_disponibles[sortFuel]) {
            const mj = formatMajHtml(res.station.carburants_disponibles[sortFuel]);
            const fuelChip = `<div class="mt-2 inline-flex items-center gap-2 rounded-xl border-2 border-amber-300/70 bg-gradient-to-r from-amber-50 to-orange-50/80 px-3 py-2 shadow-sm">
                <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white text-sm shadow" aria-hidden="true"><i class="fas fa-gas-pump"></i></span>
                <div class="min-w-0 leading-tight text-left">
                    <div class="text-[9px] font-extrabold uppercase tracking-wider text-amber-900/80">Carburant trié</div>
                    <div class="text-sm font-black text-amber-950">${esc(sortFuel)}</div>
                </div>
            </div>`;
            const majBlock = mj
                ? `<div class="mt-2 flex items-start gap-2 rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2 shadow-sm" translate="no">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 text-sm" aria-hidden="true"><i class="fas fa-clock"></i></span>
                    <div class="min-w-0 leading-tight">
                        <div class="text-[9px] font-extrabold uppercase tracking-wide text-slate-500">Mise à jour prix</div>
                        <div class="text-xs font-bold italic text-slate-800">${mj}</div>
                    </div>
                </div>`
                : '';
            carbsHtml = fuelChip + majBlock;
        } else {
            const carbsArray = [];
            for (const [c, d] of Object.entries(res.station.carburants_disponibles)) {
                if (userFuels.includes(c)) {
                    const mj = formatMajHtml(d);
                    const prixNum = parseFloat(d.prix);
                    const col = prixColorTag(res.id, c, d.prix);
                    const tone = tankToneFromPrixColorBg(col.bg);
                    const bord = tone === 'green' ? 'border-emerald-300/80' : tone === 'amber' ? 'border-amber-300/80' : tone === 'indigo' ? 'border-indigo-300/80' : 'border-slate-200';
                    carbsArray.push(`<div class="inline-flex flex-col gap-1 rounded-2xl border-2 ${bord} ${col.bg} px-2.5 py-2 shadow-md min-w-[6.5rem] sm:min-w-[7rem]">
                        <span class="font-extrabold text-[10px] uppercase tracking-wide ${col.text} text-center">${c}</span>
                        <span class="font-black tabular-nums ${col.text} text-lg text-center leading-none">${d.prix}<span class="text-sm font-bold">€</span><span class="block text-[9px] font-bold uppercase opacity-80 mt-0.5">/ litre</span></span>
                        ${fullTankHtml(prixNum, 'proximity', tone)}
                        ${mj ? `<span class="text-[9px] font-bold text-center italic ${col.text} opacity-95 leading-tight" translate="no"><i class="fas fa-clock mr-0.5 not-italic opacity-70"></i>${mj}</span>` : ''}
                    </div>`);
                }
            }
            if (carbsArray.length) {
                carbsHtml = `<div class="mt-3"><div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5"><i class="fas fa-layer-group text-indigo-500" aria-hidden="true"></i>Vos carburants suivis</div><div class="flex flex-wrap gap-2.5 items-stretch">${carbsArray.join('')}</div></div>`;
            }
        }

        let rowShell = 'from-white via-slate-50/50 to-indigo-50/20 border-slate-200/90';
        if (sortFuel) {
            if (res.markerType === 'station_green') rowShell = 'from-emerald-50/50 via-white to-teal-50/30 border-emerald-300/70';
            else if (res.markerType === 'station_orange') rowShell = 'from-amber-50/45 via-white to-orange-50/25 border-amber-300/70';
            else if (res.markerType === 'station_blue') rowShell = 'from-indigo-50/40 via-white to-violet-50/20 border-indigo-200/80';
        }

        html += `
            <div onclick="showStation('${res.id}')" class="p-4 sm:p-5 bg-gradient-to-br ${rowShell} border-2 rounded-2xl hover:shadow-xl hover:border-indigo-500 cursor-pointer transition flex justify-between items-stretch gap-3 sm:gap-4 group shadow-sm">
                <div class="flex-1 min-w-0">
                    <div class="flex items-start gap-2 min-w-0">
                        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 shadow-inner" aria-hidden="true"><i class="fas fa-gas-pump text-lg"></i></span>
                        <div class="min-w-0 flex-1">
                            <div class="font-black text-slate-950 text-base sm:text-lg group-hover:text-indigo-800 transition leading-tight">${esc(res.station.nom_osm) || 'Station-service'}</div>
                            <div class="text-sm text-slate-700 mt-1.5 flex items-start gap-2 leading-snug"><i class="fas fa-map-marker-alt mt-0.5 text-rose-500 text-base shrink-0" aria-hidden="true"></i><span class="font-semibold min-w-0"><span class="italic text-slate-600">${esc(res.station.adresse)}</span><span class="text-slate-400 font-normal"> · </span><strong class="font-extrabold text-slate-900 not-italic">${esc(res.station.code_postal)} ${esc(res.station.ville)}</strong></span></div>
                        </div>
                    </div>
                    ${carbsHtml}
                </div>
                ${rightContent}
            </div>`;
    });

    html += `</div></div></div>`;

    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);

    let mapMarkers = [];
    const geoMapSource = stations.length > 0 ? stations : stationsInZoneForWidget;
    geoMapSource.forEach(s => {
        if (s.station.lat && s.station.lon) mapMarkers.push({ type: s.markerType || 'station_blue', lat: s.station.lat, lon: s.station.lon, label: s.station.nom_osm || 'Station-service', adresse: `${s.station.adresse}, ${s.station.ville}`, id: s.id });
    });
    setTimeout(() => initStationMap(mapMarkers, true), 100);
    syncFavoriteHeaderButton();
}

function applyGeoSort(type, name, fuel) {
    searchGeoZone(type, name, fuel);
}

// ==========================================
// RUBRIQUE STATISTIQUES (DASHBOARD)
// ==========================================
let dashSortFuel = null;
let dashSortDir = 'asc';

function renderDashboard() {
    if (!chartsInitialized) {
        chartsInitialized = true;
        if (chartNatPrices) { chartNatPrices.destroy(); chartNatPrices = null; }
        if (chartNatFuels) { chartNatFuels.destroy(); chartNatFuels = null; }
        const dash = db.dashboard;
        const fuels = Object.keys(dash.national.avg_prices).filter(f => dash.national.avg_prices[f] > 0);
        const avgPrices = fuels.map(f => dash.national.avg_prices[f]);
        const fuelCounts = fuels.map(f => dash.national.fuel_presence[f]);
        const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

        chartNatPrices = new Chart(document.getElementById('chart-nat-prices'), {
            type: 'bar',
            data: { labels: fuels, datasets: [{ label: 'Prix moyen (€)', data: avgPrices, backgroundColor: colors }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: false } }
            }
        });

        chartNatFuels = new Chart(document.getElementById('chart-nat-fuels'), {
            type: 'pie',
            data: { labels: fuels, datasets: [{ data: fuelCounts, backgroundColor: colors }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
    renderRegionsTable();
}

function sortDashboardBy(fuel) {
    if (dashSortFuel === fuel) dashSortDir = dashSortDir === 'asc' ? 'desc' : 'asc';
    else { dashSortFuel = fuel; dashSortDir = 'asc'; }
    renderRegionsTable();
}

function toggleRegionAccordion(region) {
    document.querySelectorAll(`.dept-row-${CSS.escape(region)}`).forEach(r => r.classList.toggle('hidden'));
    const icon = document.querySelector(`#chevron-${CSS.escape(region)}`);
    if (icon) icon.classList.toggle('fa-chevron-down'), icon.classList.toggle('fa-chevron-right');
}

function renderRegionsTable() {
    const dash = db.dashboard;
    const fuels = Object.keys(dash.national.avg_prices).filter(f => dash.national.avg_prices[f] > 0);

    let regions = Object.entries(dash.regional).filter(([r]) => r !== 'Inconnue');
    if (dashSortFuel) {
        regions.sort((a, b) => {
            const va = a[1].avg_prices[dashSortFuel] || 999;
            const vb = b[1].avg_prices[dashSortFuel] || 999;
            return dashSortDir === 'asc' ? va - vb : vb - va;
        });
    } else {
        regions.sort((a, b) => a[0].localeCompare(b[0]));
    }

    let tableHtml = `<thead class="bg-gradient-to-r from-indigo-100 via-slate-100 to-violet-100 text-indigo-950 uppercase text-[10px] sm:text-xs font-extrabold tracking-wide border-b-2 border-indigo-200/60"><tr><th scope="col" class="px-2 py-2.5 sm:px-4 sm:py-3 sticky left-0 bg-indigo-100/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] z-10 whitespace-nowrap">Région</th><th scope="col" class="px-2 py-2.5 sm:px-4 sm:py-3 whitespace-nowrap text-center">Stations</th>`;
    fuels.forEach(f => {
        const arrow = dashSortFuel === f ? (dashSortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
        const cls = dashSortFuel === f ? 'text-indigo-600' : 'text-slate-400';
        tableHtml += `<th scope="col" class="px-2 py-2.5 sm:px-4 sm:py-3 cursor-pointer select-none hover:bg-white/60 transition whitespace-nowrap text-center rounded-t-lg" onclick="sortDashboardBy('${f}')" title="Trier par ${esc(f)}">${f} <i class="fas ${arrow} ${cls} text-[10px] ml-0.5 sm:ml-1" aria-hidden="true"></i></th>`;
    });
    tableHtml += `</tr></thead><tbody class="text-sm">`;

    for (const [region, data] of regions) {
        const slug = region.replace(/[^a-zA-Z0-9]/g, '_');
        tableHtml += `<tr class="border-b border-slate-200/80 hover:bg-indigo-50/40 cursor-pointer transition-colors" onclick="toggleRegionAccordion('${slug}')"><th scope="row" class="px-2 py-2.5 sm:px-4 sm:py-3 font-extrabold text-left text-slate-900 sticky left-0 bg-white/98 backdrop-blur-sm z-10 max-w-[42vw] sm:max-w-none shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]"><i id="chevron-${slug}" class="fas fa-chevron-right text-xs text-indigo-400 mr-1.5 sm:mr-2 transition-transform shrink-0" aria-hidden="true"></i><span class="align-middle">${esc(region)}</span></th><td class="px-2 py-2.5 sm:px-4 sm:py-3 text-center tabular-nums font-semibold text-slate-800">${data.station_count}</td>`;
        fuels.forEach(f => {
            let p = data.avg_prices[f];
            tableHtml += `<td class="px-2 py-2.5 sm:px-4 sm:py-3 text-center font-medium tabular-nums text-xs sm:text-sm">${p > 0 ? p.toFixed(3) + ' €' : '-'}</td>`;
        });
        tableHtml += `</tr>`;

        if (dash.departemental) {
            const deptRows = Object.entries(dash.departemental).filter(([, d]) => d.region === region).sort((a, b) => a[1].nom.localeCompare(b[1].nom));
            for (const [, dept] of deptRows) {
                tableHtml += `<tr class="dept-row-${slug} hidden border-b bg-slate-50/50"><td class="px-2 py-2 sm:px-4 pl-6 sm:pl-10 text-slate-600 sticky left-0 bg-slate-50/95 backdrop-blur-sm z-10 max-w-[40vw] sm:max-w-none shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]">${esc(dept.nom)}</td><td class="px-2 py-2 sm:px-4 text-center text-slate-500 tabular-nums">${dept.station_count}</td>`;
                fuels.forEach(f => {
                    let p = dept.avg_prices[f];
                    tableHtml += `<td class="px-2 py-2 sm:px-4 text-center text-slate-500 tabular-nums text-xs sm:text-sm">${p > 0 ? p.toFixed(3) + ' €' : '-'}</td>`;
                });
                tableHtml += `</tr>`;
            }
        }
    }
    tableHtml += `</tbody>`;
    document.getElementById('table-regions').innerHTML = tableHtml;
}

// ==========================================
// MOTEUR DE RECHERCHE MIXTE
// ==========================================

function debouncedSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 500);
}

async function performSearch() {
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const currentSignal = searchAbortController.signal;
    const query = document.getElementById('search-input').value;
    const normQuery = normalizeText(query);
    const resultsContainer = document.getElementById('search-results');
    currentProximitySearch = null;
    stationDetailSearchAnchor = null;

    if (normQuery.length < 3) { resultsContainer.innerHTML = ''; return; }
    resultsContainer.innerHTML = `<div class="py-6 text-center rounded-2xl border-2 border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white shadow-sm" role="status" aria-live="polite"><span class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md mb-2 mx-auto" aria-hidden="true"><i class="fas fa-spinner fa-spin text-xl"></i></span><p class="font-extrabold text-indigo-900 text-sm">Recherche en cours…</p><p class="text-xs text-slate-600 mt-1 px-4">Sources locales et OpenStreetMap</p></div>`;

    let html = '';

    // 1. Search regions & departments
    let regionResults = [];
    let deptResults = [];
    const isDeptCode = /^\d{2,3}$/.test(normQuery);
    if (isDeptCode && db.dept_index[normQuery]) {
        const d = db.dept_index[normQuery];
        deptResults.push({ code: normQuery, nom: d.nom, region: d.region, count: d.stations.length });
    }
    if (!isDeptCode) {
        for (const [code, d] of Object.entries(db.dept_index)) {
            if (d.nom_norm.includes(normQuery)) {
                deptResults.push({ code, nom: d.nom, region: d.region, count: d.stations.length });
            }
        }
        for (const [, r] of Object.entries(db.region_index)) {
            if (r.nom_norm.includes(normQuery)) {
                regionResults.push({ nom: r.nom, count: r.stations.length });
            }
        }
    }

    if (regionResults.length > 0) {
        html += `<div class="text-xs font-extrabold text-slate-600 uppercase tracking-wider mb-2 mt-4 flex items-center gap-2"><i class="fas fa-map-marked-alt text-purple-600 text-base"></i><span>Régions</span></div>`;
        regionResults.forEach(g => {
            html += `
                <div onclick="searchGeoZone('region', '${g.nom.replace(/'/g, "\\'")}')" class="p-4 bg-gradient-to-br from-purple-50 to-fuchsia-50/60 border-2 border-purple-200/80 rounded-xl hover:shadow-lg hover:border-purple-400 cursor-pointer transition flex justify-between items-center group gap-4 mb-2">
                    <div class="flex-1 min-w-0 flex items-start gap-3">
                        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 text-xl shadow-sm"><i class="fas fa-map-marked-alt"></i></span>
                        <div class="min-w-0">
                            <div class="font-extrabold text-purple-950 group-hover:text-purple-700 transition truncate text-lg leading-tight">${esc(g.nom)}</div>
                            <div class="text-sm font-semibold text-purple-800 mt-1.5"><strong class="font-black text-purple-900 text-base">${g.count}</strong> <em class="font-medium not-italic text-purple-700">stations</em> <span class="text-purple-600/90">répertoriées</span></div>
                        </div>
                    </div>
                    <i class="fas fa-chevron-right text-purple-400 group-hover:text-purple-600 transition flex-shrink-0 text-xl"></i>
                </div>
            `;
        });
    }

    if (deptResults.length > 0) {
        html += `<div class="text-xs font-extrabold text-slate-600 uppercase tracking-wider mb-2 mt-4 flex items-center gap-2"><i class="fas fa-map-pin text-indigo-600 text-base"></i><span>Départements</span></div>`;
        deptResults.forEach(g => {
            html += `
                <div onclick="searchGeoZone('dept', '${g.nom.replace(/'/g, "\\'")}')" class="p-4 bg-gradient-to-br from-white to-indigo-50/40 border-2 border-slate-200/90 rounded-xl hover:shadow-lg hover:border-indigo-400 cursor-pointer transition flex justify-between items-center group gap-4 mb-2">
                    <div class="flex-1 min-w-0 flex items-start gap-3">
                        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 text-xl shadow-sm"><i class="fas fa-map-pin"></i></span>
                        <div class="min-w-0">
                            <div class="font-extrabold text-slate-900 group-hover:text-indigo-700 transition truncate text-lg leading-tight">${esc(g.nom)} <span class="text-indigo-700 font-black">(${esc(g.code)})</span></div>
                            <div class="text-sm mt-1.5"><em class="font-semibold not-italic text-slate-600">${esc(g.region)}</em> · <strong class="font-bold text-slate-800">${g.count}</strong> <span class="text-slate-600 font-medium">stations</span></div>
                        </div>
                    </div>
                    <i class="fas fa-chevron-right text-slate-300 group-hover:text-indigo-500 transition flex-shrink-0 text-xl"></i>
                </div>
            `;
        });
    }

    // 2. Search stations by postal code or text
    let localResults = [];
    if (!isDeptCode && db.cp_index[normQuery]) {
        db.cp_index[normQuery].forEach(id => {
            if (hasTrackedFuel(db.stations[id])) localResults.push({ id, label: db.recherche_texte[id].label_affichage, station: db.stations[id] });
        });
    } else if (!isDeptCode) {
        for (const [id, data] of Object.entries(db.recherche_texte)) {
            if (data.texte_norm.includes(normQuery) && hasTrackedFuel(db.stations[id])) {
                localResults.push({ id, label: data.label_affichage, station: db.stations[id] });
            }
            if (localResults.length > 100) break;
        }
    }

    let stationsHtml = '';
    if (localResults.length > 0) {
        stationsHtml += `<div class="text-xs font-extrabold text-slate-600 uppercase tracking-wider mb-2 mt-4 flex justify-between items-center gap-2 min-w-0"><span class="min-w-0 truncate flex items-center gap-2"><i class="fas fa-gas-pump text-amber-600 text-base"></i><span>Stations-services</span></span>${searchSourcePill('via data.economie.gouv.fr')}</div>`;
        localResults.forEach(res => {
            stationsHtml += `
                <div onclick="showStation('${res.id}')" class="p-4 bg-gradient-to-br from-white to-slate-50/90 border-2 border-slate-200/80 rounded-xl hover:shadow-lg hover:border-indigo-400 cursor-pointer transition flex justify-between items-stretch gap-3 group mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="font-extrabold text-slate-900 group-hover:text-indigo-700 transition truncate text-lg leading-tight">${esc(res.station.nom_osm) || 'Station-service'}</div>
                        <div class="text-sm text-slate-600 truncate mt-2 flex items-start gap-2">
                            <i class="fas fa-map-marker-alt mt-0.5 text-indigo-500 text-lg shrink-0"></i>
                            <span class="font-medium leading-snug"><span class="italic text-slate-700">${esc(res.station.adresse)}</span>, <strong class="font-bold not-italic text-slate-900">${esc(res.station.code_postal)}</strong> ${esc(res.station.ville)}</span>
                        </div>
                    </div>
                    <div class="flex items-center shrink-0">${buildSearchStationPriceColumn(res.id, res.station)}</div>
                </div>
            `;
        });
    }

    try {
        const osmResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=fr&limit=4`, { signal: currentSignal });
        const osmData = await osmResponse.json();

        if (osmData.length > 0) {
            html += `<div class="text-xs font-extrabold text-slate-600 uppercase tracking-wider mb-2 mt-4 flex justify-between items-center gap-2 min-w-0"><span class="min-w-0 truncate flex items-center gap-2"><i class="fas fa-map-marked-alt text-sky-600 text-base"></i><span>Villes & adresses</span></span>${searchSourcePill('via OpenStreetMap')}</div>`;
            osmData.forEach(place => {
                const parts = place.display_name.split(',');
                const name = parts[0];
                const desc = parts.slice(1, -2).join(',').trim();
                const placeKey = addressFavoriteKey(place.lat, place.lon);
                const isFav = placeKey && userFavorites.some(f => f.type === 'address' && addressFavoriteKey(f.lat, f.lon) === placeKey);

                html += `
                    <div class="bg-gradient-to-r from-indigo-50 via-blue-50/70 to-indigo-50/80 border-2 border-indigo-200/70 rounded-xl hover:shadow-lg hover:border-indigo-400 transition flex items-stretch group mb-2 overflow-hidden">
                        <div onclick="findStationsNear(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')" class="p-4 flex-1 min-w-0 cursor-pointer flex justify-between items-center gap-3">
                            <div class="min-w-0 flex items-start gap-3">
                                <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 text-2xl shadow-inner"><i class="fas fa-city"></i></span>
                                <div class="min-w-0">
                                    <div class="font-extrabold text-indigo-950 group-hover:text-indigo-700 transition truncate text-lg leading-tight">${esc(name)}</div>
                                    <div class="text-sm text-indigo-700 mt-1.5 italic leading-snug line-clamp-2"><i class="fas fa-search-location mr-1.5 text-indigo-500 not-italic text-base align-middle"></i>${esc(desc)}</div>
                                </div>
                            </div>
                            <i class="fas fa-arrow-right text-indigo-400 group-hover:text-indigo-600 transition text-xl shrink-0 self-center"></i>
                        </div>
                        <button onclick="toggleFavoriteAddress(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')" class="px-4 flex items-center justify-center text-2xl border-l-2 border-indigo-200/80 transition hover:bg-indigo-100/90 shrink-0" title="Ajouter aux lieux favoris">
                            <i class="fas fa-star ${isFav ? 'text-yellow-400' : 'text-indigo-300 hover:text-yellow-400'}"></i>
                        </button>
                    </div>
                `;
            });
        }
    } catch (e) { console.error("OSM API Error", e); }

    html += stationsHtml;

    if (html === '') {
        html = `<div class="mt-4">${uiNoticeBlock('fa-search', 'bg-slate-500', 'Aucun résultat pour cette recherche.', 'Les stations dont les prix sont <strong class="text-slate-800">anciens</strong> ou qui ne vendent pas vos <strong class="text-slate-800">carburants suivis</strong> sont masquées. Essayez un autre mot-clé ou ouvrez les paramètres.')}</div>`;
    }
    if (currentSignal.aborted) return;
    resultsContainer.innerHTML = html;
}

// ==========================================
// GEOLOCALISATION & RECHERCHE AUTOUR
// ==========================================

function geolocateMe() {
    if (!navigator.geolocation) { alert("La géolocalisation n'est pas supportée."); return; }
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = `<div class="py-6 text-center rounded-2xl border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 to-indigo-50/40 shadow-sm" role="status" aria-live="polite"><span class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-md mb-2 mx-auto" aria-hidden="true"><i class="fas fa-compass fa-spin text-xl"></i></span><p class="font-extrabold text-cyan-950 text-sm">Localisation en cours…</p><p class="text-xs text-slate-600 mt-1">Autorisez l'accès si le navigateur le demande</p></div>`;
    
    navigator.geolocation.getCurrentPosition(
        (pos) => findStationsNear(pos.coords.latitude, pos.coords.longitude, "Votre position actuelle"),
        () => { resultsContainer.innerHTML = uiNoticeBlock('fa-location-slash', 'bg-red-500', 'Position non disponible.', 'Vérifiez les <strong class="text-slate-800">autorisations</strong> du site et que le <strong class="text-slate-800">GPS</strong> est activé.'); }
    );
}

function applyFuelSort(fuel) {
    if (!currentProximitySearch) return;
    withSearchRadius(() => renderStationsList(currentProximitySearch.lat, currentProximitySearch.lon, currentProximitySearch.labelTitle, fuel));
}

function findStationsNear(lat, lon, labelTitle, customRadius) {
    if (!document.getElementById('home-view').classList.contains('hidden')) {
        pushNav({ type: 'home' });
    }
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.removeAttribute('data-current-id');

    currentGeoZone = null;
    stationDetailSearchAnchor = null;
    currentProximitySearch = { lat, lon, labelTitle, customRadius: customRadius || null };
    withSearchRadius(() => renderStationsList(lat, lon, labelTitle, userFuels[0] || ""));
}

function renderStationsList(lat, lon, labelTitle, sortFuel) {
    let stationsInRadius = [];
    for (const [id, stat] of Object.entries(db.stations)) {
        if (!stat.lat || !stat.lon) continue;
        if (!hasTrackedFuel(stat)) continue;

        const dist = distanceHaversine(lat, lon, stat.lat, stat.lon);
        if (dist <= maxStraightLineKmForRadius()) stationsInRadius.push({ id, dist, station: stat });
    }

    let topStations = [...stationsInRadius];
    if (sortFuel) {
        topStations = topStations.filter(s => s.station.carburants_disponibles[sortFuel]);
        topStations.sort((a, b) => compareStationEntriesByPriceThenDistance(sortFuel, a, b));
    } else {
        topStations.sort((a, b) => a.dist - b.dist);
    }

    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-indigo-200/60">
            <div class="bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-600 p-4 sm:p-6 text-white text-center shadow-inner">
                <h2 class="text-lg sm:text-2xl font-extrabold drop-shadow-sm leading-tight px-1"><i class="fas fa-location-arrow mr-2 text-cyan-200" aria-hidden="true"></i>Stations autour de <em class="not-italic font-black text-white">${esc(labelTitle)}</em></h2>
                <p class="mt-3 flex flex-wrap justify-center gap-2 text-xs sm:text-sm font-semibold">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 backdrop-blur-sm shadow-sm"><i class="fas fa-circle-notch text-cyan-200" aria-hidden="true"></i>Rayon ${radiusSettingKmHtml()}</span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 backdrop-blur-sm shadow-sm"><i class="fas fa-gas-pump text-amber-200" aria-hidden="true"></i><strong class="tabular-nums font-black">${stationsInRadius.length}</strong>&nbsp;station${stationsInRadius.length > 1 ? 's' : ''} <em class="font-medium not-italic opacity-90">(vos carburants)</em></span>
                </p>
            </div>
            <div class="p-4 sm:p-6 md:p-8">
                <div id="station-map" class="station-map-shell mb-5 sm:mb-6 w-full"></div>
    `;

    if (stationsInRadius.length === 0) {
        html += uiNoticeBlock('fa-circle-notch', 'bg-indigo-500', `Aucune station dans un rayon d'environ ${radiusSettingKmHtml()}.`, 'Ouvrez les <strong class="text-slate-800">param\u00e8tres</strong> (ic\u00f4ne en haut \u00e0 droite) pour augmenter le rayon ou cocher d\'autres carburants.');
    } else {
        html += buildBestPricesWidget(stationsInRadius);
        if (topStations.length === 0) {
            html += `<div class="mb-4">${uiNoticeBlock('fa-gas-pump', 'bg-amber-500', 'Aucune station ne propose ce carburant dans le rayon.', 'Les <strong class="text-slate-800">meilleurs prix</strong> ci-dessus restent calculés sur <strong class="text-slate-800">tous vos carburants</strong> suivis.')}</div>`;
        }
        let sortOptions = userFuels.map(f => `<option value="${f}" ${sortFuel === f ? 'selected' : ''}>${f}</option>`).join('');
        const listeLabel = sortFuel
            ? `<span class="text-indigo-800 font-bold tabular-nums">${topStations.length}</span> <span class="text-slate-600">avec</span> <em class="not-italic font-extrabold text-amber-700">${esc(sortFuel)}</em>`
            : `<span class="text-indigo-800 font-bold">distance</span> <span class="text-slate-600">croissante</span>`;
        html += `
            <div class="mb-5 rounded-2xl border-2 border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 via-white to-violet-50/40 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div class="min-w-0">
                    <label for="sort-fuel-select" class="flex items-center gap-2 text-sm font-extrabold text-slate-800"><span class="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md"><i class="fas fa-sort-amount-down" aria-hidden="true"></i></span>Ordre d'affichage</label>
                    <p class="mt-1.5 text-xs font-semibold text-slate-600 pl-11 sm:pl-0 sm:ml-11 leading-snug">Liste : ${listeLabel}</p>
                </div>
                <select id="sort-fuel-select" onchange="applyFuelSort(this.value)" class="min-h-[3rem] py-3 px-3 border-2 border-indigo-200 rounded-xl text-base font-bold text-indigo-900 bg-white outline-none focus:ring-2 focus:ring-indigo-500 w-full md:w-auto md:min-w-[14rem] touch-manipulation shadow-inner">
                    <option value="">Par distance (tous carburants)</option>
                    ${sortOptions}
                </select>
            </div>
        `;
        if (topStations.length > 0) {
            html += `<div class="space-y-4">`;
            const total = topStations.length;
            let minPrixRayon = null;
            if (sortFuel && total > 0) {
                minPrixRayon = Math.min(...topStations.map(s => parseFloat(s.station.carburants_disponibles[sortFuel].prix)));
            }

            topStations.forEach((res) => {
                let carbsHtml = "";
                let rightContent = "";

                const distBlock = proximityDistanceRowHtml(res.dist);

                if (sortFuel) {
                    const prix = res.station.carburants_disponibles[sortFuel].prix;
                    const prixNum = parseFloat(prix);
                    const badge = buildZonePriceListBadge(String(prix), prixNum, minPrixRayon);
                    res.markerType = badge.markerType;
                    rightContent = badge.html;
                    const mj = formatMajHtml(res.station.carburants_disponibles[sortFuel]);
                    const fuelChip = `<div class="mt-2 inline-flex items-center gap-2 rounded-xl border-2 border-amber-300/70 bg-gradient-to-r from-amber-50 to-orange-50/80 px-3 py-2 shadow-sm">
                        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white text-sm shadow" aria-hidden="true"><i class="fas fa-gas-pump"></i></span>
                        <div class="min-w-0 leading-tight text-left">
                            <div class="text-[9px] font-extrabold uppercase tracking-wider text-amber-900/80">Carburant trié</div>
                            <div class="text-sm font-black text-amber-950">${esc(sortFuel)}</div>
                        </div>
                    </div>`;
                    const majBlock = mj
                        ? `<div class="mt-2 flex items-start gap-2 rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2 shadow-sm" translate="no">
                            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 text-sm" aria-hidden="true"><i class="fas fa-clock"></i></span>
                            <div class="min-w-0 leading-tight">
                                <div class="text-[9px] font-extrabold uppercase tracking-wide text-slate-500">Mise à jour prix</div>
                                <div class="text-xs font-bold italic text-slate-800">${mj}</div>
                            </div>
                        </div>`
                        : '';
                    carbsHtml = distBlock + fuelChip + majBlock;
                } else {
                    let carbsArray = [];
                    for (const [c, d] of Object.entries(res.station.carburants_disponibles)) {
                        if (userFuels.includes(c)) {
                            const mj = formatMajHtml(d);
                            const prixNum = parseFloat(d.prix);
                            const col = prixColorTag(res.id, c, d.prix);
                            const tone = tankToneFromPrixColorBg(col.bg);
                            const bord = tone === 'green' ? 'border-emerald-300/80' : tone === 'amber' ? 'border-amber-300/80' : tone === 'indigo' ? 'border-indigo-300/80' : 'border-slate-200';
                            carbsArray.push(`<div class="inline-flex flex-col gap-1 rounded-2xl border-2 ${bord} ${col.bg} px-2.5 py-2 shadow-md min-w-[6.5rem] sm:min-w-[7rem]">
                                <span class="font-extrabold text-[10px] uppercase tracking-wide ${col.text} text-center">${c}</span>
                                <span class="font-black tabular-nums ${col.text} text-lg text-center leading-none">${d.prix}<span class="text-sm font-bold">€</span><span class="block text-[9px] font-bold uppercase opacity-80 mt-0.5">/ litre</span></span>
                                ${fullTankHtml(prixNum, 'proximity', tone)}
                                ${mj ? `<span class="text-[9px] font-bold text-center italic ${col.text} opacity-95 leading-tight" translate="no"><i class="fas fa-clock mr-0.5 not-italic opacity-70"></i>${mj}</span>` : ''}
                            </div>`);
                        }
                    }
                    carbsHtml = distBlock + `<div class="mt-3"><div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5"><i class="fas fa-layer-group text-indigo-500"></i>Vos carburants suivis</div><div class="flex flex-wrap gap-2.5 items-stretch">${carbsArray.join('')}</div></div>`;
                    rightContent = '';
                    res.markerType = 'station_blue';
                }

                let rowShell = 'from-white via-slate-50/50 to-indigo-50/20 border-slate-200/90';
                if (sortFuel) {
                    if (res.markerType === 'station_green') rowShell = 'from-emerald-50/50 via-white to-teal-50/30 border-emerald-300/70';
                    else if (res.markerType === 'station_orange') rowShell = 'from-amber-50/45 via-white to-orange-50/25 border-amber-300/70';
                    else if (res.markerType === 'station_blue') rowShell = 'from-indigo-50/40 via-white to-violet-50/20 border-indigo-200/80';
                }

                html += `
                <div onclick="showStation('${res.id}')" class="p-4 sm:p-5 bg-gradient-to-br ${rowShell} border-2 rounded-2xl hover:shadow-xl hover:border-indigo-500 cursor-pointer transition flex justify-between items-stretch gap-3 sm:gap-4 group shadow-sm">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start gap-2 min-w-0">
                            <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 shadow-inner" aria-hidden="true"><i class="fas fa-gas-pump text-lg"></i></span>
                            <div class="min-w-0 flex-1">
                                <div class="font-black text-slate-950 text-base sm:text-lg group-hover:text-indigo-800 transition leading-tight">${esc(res.station.nom_osm) || 'Station-service'}</div>
                                <div class="text-sm text-slate-700 mt-1.5 flex items-start gap-2 leading-snug"><i class="fas fa-map-marker-alt mt-0.5 text-rose-500 text-base shrink-0" aria-hidden="true"></i><span class="font-semibold min-w-0"><span class="italic text-slate-600">${esc(res.station.adresse)}</span><span class="text-slate-400 font-normal"> · </span><strong class="font-extrabold text-slate-900 not-italic">${esc(res.station.code_postal)} ${esc(res.station.ville)}</strong></span></div>
                            </div>
                        </div>
                        ${carbsHtml}
                    </div>
                    ${rightContent}
                </div>
            `;
            });
            html += `</div>`;
        }
    }
    html += `</div></div>`;

    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);

    let mapMarkers = [{ type: 'search_point', lat: lat, lon: lon, label: '📍 Point de recherche', adresse: labelTitle }];
    const proxMapSource = topStations.length > 0 ? topStations : stationsInRadius;
    proxMapSource.forEach(s => mapMarkers.push({ type: s.markerType || 'station_blue', lat: s.station.lat, lon: s.station.lon, label: s.station.nom_osm || 'Station-service', adresse: `${s.station.adresse}, ${s.station.ville}`, id: s.id }));
    setTimeout(() => initStationMap(mapMarkers, true), 100);
    syncFavoriteHeaderButton();
}

// ==========================================
// PALMARÈS
// ==========================================

function populateFuelsSelect() {
    const select = document.getElementById('palmares-carb');
    select.innerHTML = '';
    ALL_FUELS.forEach(f => select.add(new Option(f, f)));
}

function populateRegions() {
    const regionSelect = document.getElementById('select-region');
    const prev = regionSelect.value;
    regionSelect.innerHTML = '';
    regionSelect.add(new Option('🇫🇷 Toute la France', 'national'));
    Object.keys(db.geo_tree).sort().forEach(r => {
        if (r !== "Inconnue") regionSelect.add(new Option(r, r));
    });
    if ([...regionSelect.options].some(o => o.value === prev)) {
        regionSelect.value = prev;
    } else {
        regionSelect.value = 'national';
    }
    updateDepartments();
}

function updateDepartments() {
    const region = document.getElementById('select-region').value;
    const deptSelect = document.getElementById('select-dept');
    deptSelect.innerHTML = '<option value="">Optionnel</option>';
    if (!region || region === "national") { deptSelect.disabled = true; return; }
    
    deptSelect.disabled = false;
    Object.keys(db.geo_tree[region]).sort().forEach(d => { if (d !== "Inconnu") deptSelect.add(new Option(d, d)); });
}

function findCheapest() {
    const carb = document.getElementById('palmares-carb').value;
    const sort = document.getElementById('palmares-sort').value;
    const region = document.getElementById('select-region').value;
    const dept = document.getElementById('select-dept').value;
    const resultsContainer = document.getElementById('palmares-results');
    
    let idsAChercher = [];
    if (region === "national") {
        for (const r of Object.values(db.geo_tree)) {
            for (const d of Object.values(r)) {
                for (const v of Object.values(d)) idsAChercher.push(...v);
            }
        }
    } else if (dept) {
        for (const villes of Object.values(db.geo_tree[region][dept])) idsAChercher.push(...villes);
    } else if (region) {
        for (const depts of Object.values(db.geo_tree[region])) {
            for (const villes of Object.values(depts)) idsAChercher.push(...villes);
        }
    }

    let resultats = [];
    for (const sid of idsAChercher) {
        const station = db.stations[sid];
        if (station.carburants_disponibles[carb]) {
            resultats.push({ id: sid, prixInfo: parseFloat(station.carburants_disponibles[carb].prix), station: station });
        }
    }

    if (resultats.length === 0) {
        document.getElementById('palmares-map').classList.add('hidden');
        resultsContainer.innerHTML = uiNoticeBlock('fa-filter', 'bg-amber-500', 'Aucune station ne propose ce carburant dans la zone choisie.', 'Élargissez la zone (région, département) ou choisissez un <strong class="text-slate-800">autre carburant</strong>.');
        return;
    }

    if(sort === 'asc') resultats.sort((a, b) => a.prixInfo - b.prixInfo);
    else resultats.sort((a, b) => b.prixInfo - a.prixInfo);
    
    const top10 = resultats.slice(0, 10);

    let html = `<h4 class="section-heading flex flex-wrap items-center gap-3 text-lg font-extrabold text-slate-900 mb-4"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 shadow-sm" aria-hidden="true"><i class="fas fa-list-ol text-lg"></i></span><span class="leading-tight">Top <strong class="tabular-nums text-indigo-700">${top10.length}</strong> <em class="not-italic text-sm font-bold text-slate-500">classement</em></span></h4><div class="space-y-4">`;
    top10.forEach((res, index) => {
        let rowShell = 'from-white via-slate-50/40 to-indigo-50/20 border-slate-200/90';
        let badge = `<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700 font-black text-sm shadow-inner border-2 border-slate-300/80" aria-label="Rang ${index + 1}">${index + 1}</span>`;
        if (sort === 'asc') {
            if (index === 0) {
                rowShell = 'from-amber-50/80 via-yellow-50/50 to-white border-amber-400/90';
                badge = `<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 text-amber-950 shadow-lg border-2 border-amber-300" role="img" aria-label="Premier du classement"><i class="fas fa-crown text-lg" aria-hidden="true"></i></span>`;
            } else if (index === 1) {
                rowShell = 'from-slate-100/90 via-white to-slate-50/50 border-slate-400/70';
                badge = `<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-md border-2 border-slate-400" role="img" aria-label="Deuxième du classement"><i class="fas fa-medal text-lg" aria-hidden="true"></i></span>`;
            } else if (index === 2) {
                rowShell = 'from-orange-50/70 via-amber-50/40 to-white border-orange-300/80';
                badge = `<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-amber-600 text-white shadow-md border-2 border-orange-400" role="img" aria-label="Troisième du classement"><i class="fas fa-medal text-lg" aria-hidden="true"></i></span>`;
            }
        }
        
        let colorPrix = sort === 'asc' ? 'text-emerald-700' : 'text-red-700';
        let tankTone = 'neutral';
        if (sort === 'asc' && index === 0) tankTone = 'green';
        else if (sort === 'asc' && index <= 2) tankTone = 'amber';
        else if (sort === 'asc') tankTone = 'indigo';

        const carbEnt = res.station.carburants_disponibles[carb];
        const majP = carbEnt ? formatMajHtml(carbEnt) : "";
        
        html += `
            <div onclick="showStation('${res.id}')" class="p-4 sm:p-5 border-2 rounded-2xl flex items-stretch cursor-pointer hover:shadow-xl hover:border-indigo-500 transition gap-3 sm:gap-4 group bg-gradient-to-br ${rowShell} shadow-sm">
                ${badge}
                <div class="flex-1 min-w-0">
                    <div class="flex items-start gap-2 min-w-0">
                        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 shadow-inner mt-0.5" aria-hidden="true"><i class="fas fa-gas-pump"></i></span>
                        <div class="min-w-0">
                            <div class="font-black text-slate-950 text-base sm:text-lg truncate group-hover:text-indigo-800 transition leading-tight">${esc(res.station.nom_osm) || 'Station-service'}</div>
                            <div class="text-sm text-slate-700 mt-1 font-semibold leading-snug"><em class="not-italic text-slate-600">${esc(res.station.ville)}</em> <span class="text-slate-400">·</span> <strong class="text-slate-900 tabular-nums">${esc(res.station.code_postal)}</strong></div>
                            ${majP ? `<div class="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-600" translate="no"><span class="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-600" aria-hidden="true"><i class="fas fa-clock text-xs"></i></span>${majP}</div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="flex flex-col items-end gap-1.5 flex-shrink-0 justify-center">
                    <div class="text-[9px] font-extrabold uppercase tracking-wide text-slate-500 text-right">Prix / L</div>
                    <div class="font-black ${colorPrix} text-xl bg-white px-3 py-2 rounded-xl shadow-md border-2 border-white/80 tabular-nums">${res.prixInfo.toFixed(3)} €</div>
                    ${fullTankHtml(res.prixInfo, 'proximity', tankTone)}
                </div>
            </div>
        `;
    });
    html += `</div>`;
    resultsContainer.innerHTML = html;
    
    let mapMarkers = [];
    top10.forEach((res, index) => {
        if(res.station.lat && res.station.lon) {
            mapMarkers.push({ type: 'rank', lat: res.station.lat, lon: res.station.lon, label: `${index+1}. ${res.station.nom_osm || 'Station-service'}`, adresse: res.station.ville, prix: res.prixInfo, id: res.id, isAsc: sort === 'asc', carburant: carb });
        }
    });
    setTimeout(() => initPalmaresMap(mapMarkers), 100);
}

// ==========================================
// AFFICHAGE STATION INDIVIDUELLE & ANALYSE
// ==========================================

function analyserPrixProximite(stationId, carburant, prixActuel) {
    const stationAct = db.stations[stationId];
    if (!stationAct.lat || !stationAct.lon) return { alternative: null };

    let stationsProches = [];
    const prixActNum = prixActuel !== null ? parseFloat(prixActuel) : null;

    // If we come from a geo zone search, compare against all stations in that zone
    if (currentGeoZone && currentGeoZone.stationIds) {
        for (const autreId of currentGeoZone.stationIds) {
            if (autreId === stationId) continue;
            const autreStat = db.stations[autreId];
            if (!autreStat || !autreStat.lat || !autreStat.lon) continue;
            if (!autreStat.carburants_disponibles[carburant]) continue;
            const distFromCurrent = distanceHaversine(stationAct.lat, stationAct.lon, autreStat.lat, autreStat.lon);
            stationsProches.push({ id: autreId, prix: parseFloat(autreStat.carburants_disponibles[carburant].prix), dist: distFromCurrent, nom: autreStat.nom_osm || autreStat.ville, lat: autreStat.lat, lon: autreStat.lon, adresse: `${autreStat.adresse}, ${autreStat.ville}` });
        }
    } else {
        let centerLat = stationAct.lat;
        let centerLon = stationAct.lon;
        const maxStraight = maxStraightLineKmForRadius();

        const searchOrigin = getActiveSearchOrigin();
        if (searchOrigin) {
            centerLat = searchOrigin.lat;
            centerLon = searchOrigin.lon;
        }

        for (const [autreId, autreStat] of Object.entries(db.stations)) {
            if (autreId === stationId || !autreStat.lat || !autreStat.lon) continue;
            const distFromCenter = distanceHaversine(centerLat, centerLon, autreStat.lat, autreStat.lon);
            if (distFromCenter <= maxStraight && autreStat.carburants_disponibles[carburant]) {
                const distFromCurrent = distanceHaversine(stationAct.lat, stationAct.lon, autreStat.lat, autreStat.lon);
                stationsProches.push({ id: autreId, prix: parseFloat(autreStat.carburants_disponibles[carburant].prix), dist: distFromCurrent, nom: autreStat.nom_osm || autreStat.ville, lat: autreStat.lat, lon: autreStat.lon, adresse: `${autreStat.adresse}, ${autreStat.ville}` });
            }
        }
    }

    const baseNeutral = { isCheapest: false, bg: 'bg-white', border: 'border-slate-200', hintHtml: '', tier: 'neutral', priceMain: 'text-slate-900', priceEuro: 'text-slate-500' };

    if (stationsProches.length === 0) {
        return {
            ...baseNeutral,
            alternative: null,
            numProches: 0,
            hintHtml: prixActNum !== null
                ? '<p class="mt-2 text-xs text-slate-600 leading-snug"><i class="fas fa-info-circle mr-1 text-slate-400" aria-hidden="true"></i>Pas d\'autre station avec ce carburant dans la zone utilisée pour la comparaison.</p>'
                : '',
        };
    }

    stationsProches.sort((a, b) => {
        const dp = a.prix - b.prix;
        if (Math.abs(dp) > PRICE_EPS) return dp;
        return a.dist - b.dist;
    });
    const meilleurAutre = stationsProches[0];

    if (prixActNum === null) {
        return {
            ...baseNeutral,
            alternative: { ...meilleurAutre, carburant, isEqual: false, isNew: true },
            numProches: stationsProches.length,
        };
    }

    const isCheapest = prixActNum <= meilleurAutre.prix + PRICE_EPS;
    const delta = prixActNum - meilleurAutre.prix;

    let bg = 'bg-white';
    let border = 'border-slate-200';
    let hintHtml = '';
    let tier = 'neutral';
    let priceMain = 'text-slate-900';
    let priceEuro = 'text-slate-500';

    if (isCheapest) {
        bg = 'bg-green-50';
        border = 'border-green-200';
        tier = 'best';
        priceMain = 'text-green-800';
        priceEuro = 'text-green-600';
        hintHtml = `<p class="mt-2 text-xs text-green-800 leading-snug"><i class="fas fa-check-circle text-green-600 mr-1" aria-hidden="true"></i>Parmi les stations comparées dans cette zone, c'est l'un des meilleurs prix pour ce carburant.</p>`;
    } else if (delta <= PRICE_NEAR_MAX) {
        bg = 'bg-amber-50';
        border = 'border-amber-200';
        tier = 'near';
        priceMain = 'text-amber-950';
        priceEuro = 'text-amber-700';
        hintHtml = `<p class="mt-2 text-xs text-amber-900 leading-snug"><i class="fas fa-info-circle text-amber-600 mr-1" aria-hidden="true"></i>Très proche du minimum à proximité : <strong>${meilleurAutre.prix.toFixed(3)} €</strong> (${delta.toFixed(3)} € d'écart).</p>`;
    } else {
        bg = 'bg-indigo-50';
        border = 'border-indigo-200';
        tier = 'far';
        priceMain = 'text-indigo-950';
        priceEuro = 'text-indigo-600';
        hintHtml = `<p class="mt-2 text-xs text-indigo-900 leading-snug"><i class="fas fa-lightbulb text-amber-500 mr-1" aria-hidden="true"></i>Il existe <strong>moins cher</strong> à proximité : <strong>${meilleurAutre.prix.toFixed(3)} €</strong> à ${distanceKmSpan(meilleurAutre.dist)} (${esc(meilleurAutre.nom)}). Voir les suggestions ci-dessous.</p>`;
    }

    let alternative = null;
    if (meilleurAutre.prix <= prixActNum + PRICE_EPS) {
        alternative = { ...meilleurAutre, carburant, isEqual: Math.abs(meilleurAutre.prix - prixActNum) < PRICE_EPS, isNew: false };
    }

    return {
        isCheapest,
        bg,
        border,
        hintHtml,
        tier,
        priceMain,
        priceEuro,
        numProches: stationsProches.length,
        alternative,
        seulEnZone: false,
    };
}

function showStation(stationId) {
    const station = db.stations[stationId];
    if (!station) return;
    if (currentProximitySearch) {
        stationDetailSearchAnchor = null;
    }
    const stationViewEl = document.getElementById('station-view');
    const skipNavPush =
        stationViewEl &&
        !stationViewEl.classList.contains('hidden') &&
        stationViewEl.getAttribute('data-current-id') === stationId;

    if (!skipNavPush) {
        if (currentGeoZone) {
            pushNav({ type: 'geoZone', geoType: currentGeoZone.type, name: currentGeoZone.name });
        } else if (currentProximitySearch) {
            pushNav({ type: 'proximity', lat: currentProximitySearch.lat, lon: currentProximitySearch.lon, label: currentProximitySearch.labelTitle });
        } else if (!document.getElementById('home-view').classList.contains('hidden')) {
            pushNav({ type: 'home' });
        }
    }
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.setAttribute('data-current-id', stationId);

    syncFavoriteHeaderButton();
    
    const gmapsLink = getGoogleMapsLink(station.lat, station.lon, `${station.adresse}, ${station.code_postal} ${station.ville}`);
    
    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-indigo-200/60">
            <div class="bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-600 p-4 sm:p-5 lg:p-6 text-white relative shadow-inner">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 lg:gap-6">
                <h2 class="text-xl sm:text-2xl lg:text-3xl font-black drop-shadow-sm pr-10 lg:pr-4 leading-tight min-w-0 flex-1">${esc(station.nom_osm) || 'Station-service'}</h2>
                <a href="${gmapsLink}" target="_blank" rel="noopener noreferrer" class="inline-flex items-start gap-3 text-white hover:text-cyan-100 transition group text-sm font-semibold bg-white/15 hover:bg-white/25 border border-white/20 px-4 py-3 rounded-2xl w-full sm:w-max shrink-0 lg:max-w-md shadow-sm">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white group-hover:scale-105 transition-transform" aria-hidden="true"><i class="fas fa-directions text-lg"></i></span>
                    <span class="leading-snug min-w-0"><span class="block text-xs font-extrabold uppercase tracking-wide text-cyan-200/95">Itinéraire</span><span class="block mt-0.5">${esc(station.adresse)}<br><strong class="font-black">${esc(station.code_postal)}</strong> ${esc(station.ville)}</span></span>
                </a>
                </div>
            </div>
            
            <div class="p-4 sm:p-6 md:p-8">
                <div class="grid grid-cols-1 lg:grid-cols-12 lg:gap-6 xl:gap-8 items-start">
                <div class="lg:col-span-5 xl:col-span-4 min-w-0 order-2 lg:order-1">
                <div id="station-map" class="station-map-shell station-map-shell--detail mb-6 lg:mb-0 w-full"></div>
                </div>
                <div class="lg:col-span-7 xl:col-span-8 min-w-0 order-1 lg:order-2 space-y-4">
                <h3 class="section-heading flex flex-wrap items-center gap-3 text-lg sm:text-xl font-extrabold text-slate-900 mb-1 lg:mb-2"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 shadow-sm" aria-hidden="true"><i class="fas fa-gas-pump text-lg"></i></span><span class="min-w-0 leading-tight">Prix à la pompe <em class="not-italic block text-sm font-bold text-slate-500 mt-0.5">vos carburants suivis</em></span></h3>
                
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-2 lg:mb-0">
    `;

    let mapMarkersData = [];
    let alternatives = [];

    if (station.lat && station.lon) {
        mapMarkersData.push({ type: 'station_green', lat: station.lat, lon: station.lon, label: station.nom_osm || 'Ici', adresse: `${station.adresse}, ${station.ville}`, id: stationId });
    }
    const mapOrigin = getActiveSearchOrigin();
    if (mapOrigin) {
        mapMarkersData.push({ type: 'search_point', lat: mapOrigin.lat, lon: mapOrigin.lon, label: '📍 Point de recherche initial', adresse: mapOrigin.labelTitle });
    }

    let aDesPrixAffiches = false;
    
    userFuels.forEach(carb => {
        let data = station.carburants_disponibles[carb];
        let prixActuel = data ? parseFloat(data.prix) : null;
        
        const analyse = analyserPrixProximite(stationId, carb, prixActuel);
        
        if (data) {
            aDesPrixAffiches = true;
            
            let bestBadgeHtml = "";
            let minNat = db.stats.min_prices.national[carb];
            let minReg = db.stats.min_prices.regional[station.region] ? db.stats.min_prices.regional[station.region][carb] : null;
            let minDept = db.stats.min_prices.departemental[station.dept_key] ? db.stats.min_prices.departemental[station.dept_key][carb] : null;

            if (minNat !== null && prixActuel <= minNat) {
                bestBadgeHtml = `<div class="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-amber-400/80 bg-gradient-to-r from-amber-50 to-yellow-50 px-3 py-2 text-xs font-extrabold text-amber-950 shadow-sm"><i class="fas fa-star text-amber-500 text-base" aria-hidden="true"></i>Meilleur prix <em class="not-italic">national</em> recensé</div>`;
            } else if (minReg !== null && prixActuel <= minReg) {
                bestBadgeHtml = `<div class="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-amber-400/80 bg-gradient-to-r from-amber-50 to-yellow-50 px-3 py-2 text-xs font-extrabold text-amber-950 shadow-sm"><i class="fas fa-star text-amber-500 text-base" aria-hidden="true"></i>Meilleur prix <em class="not-italic">régional</em></div>`;
            } else if (minDept !== null && prixActuel <= minDept) {
                bestBadgeHtml = `<div class="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-amber-400/80 bg-gradient-to-r from-amber-50 to-yellow-50 px-3 py-2 text-xs font-extrabold text-amber-950 shadow-sm"><i class="fas fa-star text-amber-500 text-base" aria-hidden="true"></i>Meilleur prix <em class="not-italic">départemental</em></div>`;
            }

            let priceColor = analyse.priceMain || (analyse.isCheapest ? 'text-green-800' : 'text-slate-900');
            let euroColor = analyse.priceEuro || (analyse.isCheapest ? 'text-green-600' : 'text-slate-500');

            html += `
                <div class="p-4 sm:p-5 rounded-2xl border-2 ${analyse.border || 'border-slate-200'} ${analyse.bg || 'bg-white bg-gradient-to-br from-white to-slate-50/80'} relative overflow-hidden transition-shadow hover:shadow-lg shadow-sm">
                    <div class="flex justify-between items-start gap-3 mb-1">
                        <div class="min-w-0">
                            <span class="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Carburant</span>
                            <span class="block font-black text-slate-900 text-lg sm:text-xl leading-tight">${carb}</span>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 block">Prix au litre</span>
                            <span class="font-black text-xl sm:text-2xl tabular-nums ${priceColor}">${data.prix}<span class="text-base sm:text-lg ${euroColor}"> €</span></span>
                        </div>
                    </div>
                    ${fullTankHtml(prixActuel, 'detail')}
                    <div class="flex justify-end items-center mt-3 pt-2 border-t border-slate-200/60">
                        <span class="inline-flex items-center gap-1.5 text-slate-600 text-xs font-bold" translate="no"><span class="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-600" aria-hidden="true"><i class="fas fa-clock text-sm"></i></span>Mise à jour : ${formatMajHtml(data)}</span>
                    </div>
                    ${bestBadgeHtml}
                    ${analyse.hintHtml || ''}
                </div>
            `;
        }

        if (analyse.alternative) {
            alternatives.push(analyse.alternative);
        }
    });

    if (!aDesPrixAffiches) {
        html += `<div class="col-span-1 sm:col-span-2">${uiNoticeBlock('fa-sliders-h', 'bg-indigo-500', 'Aucun prix affiché pour vos carburants suivis.', 'Modifiez les <strong class="text-slate-800">carburants</strong> dans les <strong class="text-slate-800">paramètres</strong> (icône en haut à droite).')}</div>`;
    }
    html += `</div></div></div>`;

    if (alternatives.length > 0) {
        const altOrigin = getActiveSearchOrigin();
        let alternativesTitle = currentGeoZone
            ? `Alternatives dans <em class="not-italic font-black text-violet-900">${esc(currentGeoZone.name)}</em>`
            : altOrigin
            ? `Alternatives autour de <em class="not-italic font-black text-violet-900">${esc(altOrigin.labelTitle || 'votre point de recherche')}</em>`
            : `Alternatives à proximité <span class="text-violet-800 font-bold tabular-nums">(${radiusSettingKmHtml()})</span>`;
            
        html += `<h3 class="section-heading flex flex-wrap items-center gap-3 text-lg sm:text-xl font-extrabold text-slate-900 mb-2"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 shadow-sm" aria-hidden="true"><i class="fas fa-car-side text-lg"></i></span><span class="min-w-0 leading-tight">${alternativesTitle}</span></h3><p class="text-sm text-slate-600 font-semibold mb-4 max-w-prose leading-relaxed border-l-4 border-violet-300 pl-3">Stations où vous pouvez payer <strong class="text-slate-800">moins cher</strong> pour un ou plusieurs de vos carburants suivis — estimation dans la zone ou le rayon affiché.</p><div class="space-y-4 mb-8">`;
        let altGroup = {};
        
        alternatives.forEach(alt => {
            if (!altGroup[alt.id]) altGroup[alt.id] = { nom: alt.nom, dist: alt.dist, carbs: [], isBetter: false };
            if (alt.isNew || !alt.isEqual) altGroup[alt.id].isBetter = true; 
            
            let prefix = alt.isNew ? "Non proposé ici, disponible à proximité" : (alt.isEqual ? "Même prix" : "Moins cher");
            altGroup[alt.id].carbs.push(`<span class="font-bold">${alt.carburant}</span> (${alt.prix}€ <span class="italic text-xs">${prefix}</span>)${fullTankHtml(parseFloat(String(alt.prix).replace(',', '.')), 'micro')}`);
        });

        for (const [altId, info] of Object.entries(altGroup)) {
            let t = !info.isBetter 
                ? { bg: "bg-slate-50", border: "border-slate-300", hoverBg: "hover:bg-slate-100", hoverBorder: "hover:border-slate-400", textMain: "text-slate-700", textSub: "text-slate-500", iconBg: "bg-slate-200", iconText: "text-slate-600", hoverIcon: "group-hover:bg-slate-600", badgeBorder: "border-slate-200", title: "Même prix à proximité" } 
                : { bg: "bg-white", border: "border-green-200", hoverBg: "hover:bg-green-50", hoverBorder: "hover:border-green-400", textMain: "text-green-800", textSub: "text-green-600", iconBg: "bg-green-100", iconText: "text-green-600", hoverIcon: "group-hover:bg-green-500", badgeBorder: "border-green-100", title: "Option intéressante" };

            html += `
                <button onclick="showStation('${altId}')" class="w-full text-left p-4 ${t.bg} border-2 ${t.border} rounded-xl ${t.hoverBg} ${t.hoverBorder} transition shadow-sm flex justify-between items-center group gap-4">
                    <div class="flex-1 min-w-0">
                        <div class="font-extrabold ${t.textMain} text-lg group-hover:opacity-80 transition truncate">${esc(info.nom)}</div>
                        <div class="text-sm font-semibold ${t.textSub} mt-1"><i class="fas fa-route mr-1"></i> à ${distanceKmSpan(info.dist)} d'ici</div>
                        <div class="text-sm text-slate-700 mt-2 bg-white/95 inline-block px-3 py-2 rounded-xl border-2 ${t.badgeBorder} max-w-full shadow-sm leading-relaxed"><span class="inline-flex items-center gap-1.5 font-extrabold text-slate-900"><i class="fas fa-chart-line text-emerald-600" aria-hidden="true"></i>${t.title}</span><div class="mt-1.5 space-y-1">${info.carbs.map(c => `<div class="text-sm border-t border-slate-100 pt-1 first:border-0 first:pt-0">${c}</div>`).join('')}</div></div>
                    </div>
                    <div class="h-10 w-10 flex-shrink-0 ${t.iconBg} rounded-full flex items-center justify-center ${t.hoverIcon} group-hover:text-white transition ${t.iconText}"><i class="fas fa-arrow-right"></i></div>
                </button>
            `;
        }
        html += `</div>`;
    }

    let hasRealHours = station.horaires.automate_24_24 ||
        Object.values(station.horaires.jours).some(v => v !== "Horaires indisponibles");

    html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-6">`;
    if (hasRealHours) {
        html += `<div><h3 class="section-heading flex flex-wrap items-center gap-3 text-lg font-extrabold text-slate-900 mb-3"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 shadow-sm" aria-hidden="true"><i class="fas fa-clock text-lg"></i></span><span class="leading-tight">Horaires <em class="not-italic block text-xs font-bold text-slate-500">accès et automate</em></span></h3><div class="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 p-4 rounded-2xl text-sm shadow-sm">`;
        if (station.horaires.automate_24_24) {
            html += `<div class="text-green-800 font-extrabold bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-xl border-2 border-green-300/80 shadow-sm flex items-center gap-3"><span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-500 text-white shadow-md" aria-hidden="true"><i class="fas fa-check-circle text-xl"></i></span><span>Automate <em class="not-italic">24h/24</em> signalé pour cette station</span></div>`;
        } else {
            html += `<ul class="space-y-2 text-slate-800" role="list">`;
            for (const [jour, hor] of Object.entries(station.horaires.jours)) {
                if (hor === "Horaires indisponibles") continue;
                const colorClass = hor !== "Fermé" ? 'text-slate-900 font-semibold' : 'text-red-600 font-bold italic';
                html += `<li class="flex flex-wrap gap-2 border-b border-slate-200/80 pb-2 last:border-0 last:pb-0"><span class="font-extrabold text-indigo-900 w-28 shrink-0">${jour}</span> <span class="${colorClass} min-w-0">${hor}</span></li>`;
            }
            html += `</ul>`;
        }
        html += `</div></div>`;
    }

    let aDesRupturesAffichees = false;
    let rupturesHtml = `<div><h3 class="section-heading flex flex-wrap items-center gap-3 text-lg font-extrabold text-slate-900 mb-3"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 shadow-sm" aria-hidden="true"><i class="fas fa-ban text-lg"></i></span><span class="leading-tight">Indisponible <em class="not-italic block text-xs font-bold text-red-700/80">ruptures signalées</em></span></h3><div class="space-y-3">`;
    for (const [carb, data] of Object.entries(station.carburants_en_rupture)) {
        if (!userFuels.includes(carb)) continue;
        aDesRupturesAffichees = true;
        let infoSup = data.motif ? ` (${esc(data.motif)})` : '';
        rupturesHtml += `<div class="bg-gradient-to-br from-red-50 to-orange-50/30 border-2 border-red-200/90 p-3 rounded-2xl flex items-center gap-3 shadow-sm"><div class="h-10 w-10 bg-red-500 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 shadow-md" aria-hidden="true"><i class="fas fa-tint-slash text-lg"></i></div><div class="min-w-0"><div class="font-extrabold text-red-950">${esc(carb)}</div><div class="text-xs text-red-800 font-semibold mt-0.5">Depuis le <span class="tabular-nums">${esc(data.debut)}</span>${infoSup}</div></div></div>`;
    }
    rupturesHtml += `</div></div>`;
    if(aDesRupturesAffichees) html += rupturesHtml;
    
    html += `</div></div></div>`;

    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);
    setTimeout(() => initStationMap(mapMarkersData, false), 100);
}

// ==========================================
// MOTEUR CARTES LEAFLET (open source)
// Tuiles : OpenStreetMap France (serveurs en France, gratuit, données OSM).
// ==========================================

const LEAFLET_OSM_FR_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">Contributeurs OpenStreetMap</a> ' +
    '&middot; Tuiles &copy; <a href="https://www.openstreetmap.fr/" rel="noopener noreferrer">OpenStreetMap France</a>';

/** Carte Leaflet : zoom molette, contrôles FR, fond OSM France, rendu net sur écrans HiDPI. */
function createFrenchLeafletMap(containerId) {
    const map = L.map(containerId, {
        scrollWheelZoom: true,
        zoomControl: false,
    });
    L.control.zoom({
        position: 'topleft',
        zoomInTitle: 'Zoomer',
        zoomOutTitle: 'Dézoomer',
    }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        subdomains: 'abc',
        maxZoom: 20,
        minZoom: 2,
        attribution: LEAFLET_OSM_FR_ATTRIBUTION,
        detectRetina: true,
    }).addTo(map);
    return map;
}

function initStationMap(markersData, isMultiple = false) {
    if (stationMap) { stationMap.remove(); }
    
    if (markersData.length === 0) {
        document.getElementById('station-map').innerHTML = '<div class="h-full w-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-50 text-slate-600 font-semibold rounded-xl border-2 border-slate-200 px-4 text-center" role="status"><span class="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-300 text-white shadow-inner" aria-hidden="true"><i class="fas fa-map-marker-slash text-xl"></i></span><span class="text-sm font-extrabold text-slate-800">Carte indisponible</span><span class="text-xs text-slate-500 max-w-xs">Cette fiche n\'a pas de coordonn\u00e9es GPS pour afficher la position.</span></div>';
        return;
    }

    stationMap = createFrenchLeafletMap('station-map');

    let bounds = [];
    const iconBlue = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconGreen = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconOrange = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconRed = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    markersData.forEach(m => {
        if (m.type === 'search_point') {
            L.circle([m.lat, m.lon], { radius: maxStraightLineKmForRadius() * 1000, color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.05, weight: 2, dashArray: '6 4' }).addTo(stationMap);
            L.circleMarker([m.lat, m.lon], { radius: 10, color: '#1e1b4b', fillColor: '#4f46e5', fillOpacity: 0.9, weight: 3 }).bindPopup(`<div class="min-w-[168px] max-w-[260px] py-1 text-left font-sans"><p class="font-extrabold text-slate-900 text-sm leading-tight">${esc(m.label) || 'Point de recherche'}</p>${m.adresse ? `<p class="text-xs text-slate-600 mt-1 leading-snug">${esc(m.adresse)}</p>` : ''}<p class="text-xs font-bold text-indigo-700 mt-2 tabular-nums leading-snug"><span class="distance-km" translate="no">~${userRadius}\u202fkm</span> <span class="text-slate-500 font-semibold">— estimation trajet routier</span></p></div>`).addTo(stationMap).openPopup();
            bounds.push([m.lat, m.lon]);
            return;
        }
        let icon = iconBlue;
        if (m.type === 'station_green') icon = iconGreen;
        else if (m.type === 'station_orange') icon = iconOrange;
        else if (m.type === 'station_red') icon = iconRed;

        let popupBtn = m.id ? `<button type="button" onclick="showStation('${m.id}')" class="touch-manipulation mt-2.5 w-full min-h-[2.35rem] bg-indigo-600 text-white px-3 py-2 rounded-xl font-extrabold text-xs hover:bg-indigo-700 transition shadow-sm"><i class="fas fa-eye mr-1" aria-hidden="true"></i>Voir la station</button>` : '';
        let majPopup = '';
        if (m.id && db.stations[m.id]) {
            const stPop = db.stations[m.id];
            for (const f of userFuels) {
                if (stPop.carburants_disponibles[f]) {
                    const mj = formatMajHtml(stPop.carburants_disponibles[f]);
                    if (mj) { majPopup = `<p class="text-[11px] text-slate-500 leading-snug mt-1.5" translate="no"><i class="fas fa-clock text-slate-400 mr-0.5" aria-hidden="true"></i>${mj}</p>`; break; }
                }
            }
        }
        let popupText = `<div class="min-w-[168px] max-w-[260px] py-1 text-left font-sans"><p class="font-extrabold text-slate-900 text-sm leading-tight">${esc(m.label) || 'Station'}</p>${m.adresse ? `<p class="text-xs text-slate-600 mt-1 leading-snug">${esc(m.adresse)}</p>` : ''}${majPopup}${popupBtn}</div>`;

        L.marker([m.lat, m.lon], { icon }).bindPopup(popupText).addTo(stationMap);
        bounds.push([m.lat, m.lon]);
    });

    if (bounds.length > 1) {
        stationMap.fitBounds(bounds, { padding: [40, 40] });
    } else {
        stationMap.setView(bounds[0], 14);
    }
}

function initPalmaresMap(markersData) {
    document.getElementById('palmares-map').classList.remove('hidden');
    if (palmaresMap) { palmaresMap.remove(); }
    
    palmaresMap = createFrenchLeafletMap('palmares-map');

    let bounds = [];
    const iconGold = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconRed = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });

    markersData.forEach(m => {
        let icon = m.isAsc ? iconGold : iconRed;
        let colorText = m.isAsc ? 'text-green-600' : 'text-red-600';
        let majLine = '';
        if (m.id && m.carburant && db.stations[m.id]) {
            const fd = db.stations[m.id].carburants_disponibles[m.carburant];
            const mj = fd ? formatMajHtml(fd) : '';
            if (mj) majLine = `<p class="text-[11px] text-slate-500 leading-snug mt-1.5" translate="no"><i class="fas fa-clock text-slate-400 mr-0.5" aria-hidden="true"></i>${mj}</p>`;
        }
        let popupText = `<div class="min-w-[168px] max-w-[260px] py-1 text-left font-sans"><p class="font-extrabold text-slate-900 text-sm leading-tight">${esc(m.label)}</p><p class="text-xs text-slate-600 mt-1 leading-snug">${esc(m.adresse)}</p><p class="font-black ${colorText} text-lg mt-2 tabular-nums tracking-tight">${m.prix.toFixed(3)}\u202f€<span class="text-slate-500 font-bold text-xs ml-0.5">/L</span></p>${majLine}<button type="button" onclick="showStation('${m.id}')" class="touch-manipulation w-full min-h-[2.35rem] mt-2 bg-indigo-600 text-white px-3 py-2 rounded-xl font-extrabold text-xs hover:bg-indigo-700 transition shadow-sm"><i class="fas fa-eye mr-1" aria-hidden="true"></i>Voir la fiche</button></div>`;
        
        L.marker([m.lat, m.lon], { icon }).bindPopup(popupText).addTo(palmaresMap);
        bounds.push([m.lat, m.lon]);
    });

    if (bounds.length > 0) palmaresMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
}
