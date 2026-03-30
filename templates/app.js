
let db = null;
let stationMap = null;
let palmaresMap = null;
let searchTimeout = null;

const ALL_FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"];
/** Rayon par défaut : ordre de grandeur réaliste pour un détour en voiture autour d’un point. */
const DEFAULT_SEARCH_RADIUS_KM = 10;
let userRadius = parseInt(localStorage.getItem('carbuRadius'), 10) || DEFAULT_SEARCH_RADIUS_KM;
let userFuels = JSON.parse(localStorage.getItem('carbuFuels')) || ALL_FUELS;
let userFavorites = JSON.parse(localStorage.getItem('carbuFavorites')) || [];
let chartsInitialized = false;
let currentProximitySearch = null;
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

    renderFuelList();
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
            renderStationsList(
                currentProximitySearch.lat,
                currentProximitySearch.lon,
                currentProximitySearch.labelTitle,
                sf
            );
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
    if (palmTab && palmTab.classList.contains('border-indigo-600')) {
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
        syncFooterStationCount();
        refreshVisibleViewsAfterDbSwap();
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

    try {
        db = await fetchDataJsonFresh();
        
        renderFuelList();

        document.getElementById('loading').classList.add('hidden');
        document.getElementById('home-view').classList.remove('hidden');

        if (localStorage.getItem('carbuWelcomeDismissed')) {
            document.getElementById('welcome-card').classList.add('hidden');
        }

        populateRegions();
        populateFuelsSelect();
        renderFavorites();
        syncFooterStationCount();
        registerServiceWorker();
        initPwaInstall();
        startPeriodicDataRefresh();
    } catch (e) {
        document.getElementById('loading').innerHTML = '<p class="text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>Erreur serveur HTTP local.</p>';
    }
});

function dismissWelcome() {
    document.getElementById('welcome-card').classList.add('hidden');
    localStorage.setItem('carbuWelcomeDismissed', '1');
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

let deferredInstallPrompt = null;

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (location.protocol !== 'https:' && !local) return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

function initPwaInstall() {
    const bar = document.getElementById('pwa-install-bar');
    const btn = document.getElementById('pwa-install-btn');
    const dismiss = document.getElementById('pwa-install-dismiss');
    const hint = document.getElementById('pwa-install-hint');
    if (!bar || !dismiss || !hint) return;
    if (localStorage.getItem('carbuPwaBannerDismissed')) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafariInstalled = window.navigator.standalone === true;
    const mobileOrCoarse = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;

    const revealBar = () => {
        if (localStorage.getItem('carbuPwaBannerDismissed')) return;
        bar.classList.remove('pwa-bar-hidden');
    };

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (btn) btn.classList.remove('hidden');
        revealBar();
    });

    if (btn) {
        btn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            try { await deferredInstallPrompt.userChoice; } catch (err) {}
            deferredInstallPrompt = null;
            btn.classList.add('hidden');
            bar.classList.add('pwa-bar-hidden');
            localStorage.setItem('carbuPwaBannerDismissed', '1');
        });
    }

    dismiss.addEventListener('click', () => {
        bar.classList.add('pwa-bar-hidden');
        localStorage.setItem('carbuPwaBannerDismissed', '1');
    });

    if (isIOS && !isSafariInstalled) {
        hint.innerHTML = 'Sur <strong>Safari</strong> : appuyez sur <span class="whitespace-nowrap"><i class="fas fa-share-from-square mx-0.5" aria-hidden="true"></i> Partager</span>, puis <strong>Sur l’écran d’accueil</strong>.';
        if (btn) btn.classList.add('hidden');
        setTimeout(revealBar, 1800);
    } else if (!isIOS && mobileOrCoarse) {
        setTimeout(revealBar, 2200);
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
 * Le rayon réglé par l’utilisateur est interprété comme une distance « en voiture » approximative.
 * On en déduit une distance géodésique max pour filtrer les stations (plus courte que le trajet réel).
 */
const ROUTE_DISTANCE_FACTOR = 1.25;

function maxStraightLineKmForRadius() {
    return parseFloat(userRadius) / ROUTE_DISTANCE_FACTOR;
}

/** Estimation d’itinéraire (km) à partir du haversine, pour l’affichage uniquement. */
function displayRouteKm(straightKm) {
    return Math.round(straightKm * ROUTE_DISTANCE_FACTOR * 10) / 10;
}

/** Libellé français : virgule décimale, espace insécable étroit avant l’unité (typo + HiDPI). */
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

/** Rayon haversine (km) pour comparer les prix « autour » d’une station (borné). */
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
function updateRadiusDisplay() { document.getElementById('radius-display').innerText = document.getElementById('radius-slider').value; }

let fuelDisplayOrder = [...ALL_FUELS];

function renderFuelList() {
    const container = document.getElementById('fuels-checkboxes');
    fuelDisplayOrder = [...userFuels, ...ALL_FUELS.filter(f => !userFuels.includes(f))];
    container.innerHTML = '';
    fuelDisplayOrder.forEach((f, i) => {
        const checked = userFuels.includes(f) ? 'checked' : '';
        const rank = userFuels.indexOf(f);
        const rankLabel = rank >= 0
            ? `<span class="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-600 text-white text-xs font-bold">${rank + 1}</span>`
            : `<span class="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200 text-slate-400 text-xs font-bold">-</span>`;
        const moy = db.dashboard.national.avg_prices[f];
        const moyText = moy ? `<span class="text-[10px] text-slate-400 ml-1">(moy. ${moy.toFixed(3)}€)</span>` : '';
        const row = document.createElement('div');
        row.className = 'fuel-row flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 hover:bg-indigo-50 transition select-none touch-manipulation';
        row.draggable = true;
        row.dataset.fuel = f;
        row.innerHTML = `
            <i class="fas fa-grip-vertical text-slate-300 text-sm cursor-grab"></i>
            <button type="button" onclick="event.preventDefault(); moveFuel('${f}', -1)" class="sm:hidden h-7 w-7 flex items-center justify-center rounded-lg bg-slate-200 text-slate-500 hover:bg-indigo-100 active:bg-indigo-200 text-xs flex-shrink-0"><i class="fas fa-chevron-up"></i></button>
            <button type="button" onclick="event.preventDefault(); moveFuel('${f}', 1)" class="sm:hidden h-7 w-7 flex items-center justify-center rounded-lg bg-slate-200 text-slate-500 hover:bg-indigo-100 active:bg-indigo-200 text-xs flex-shrink-0"><i class="fas fa-chevron-down"></i></button>
            ${rankLabel}
            <input type="checkbox" value="${f}" class="fuel-checkbox form-checkbox h-5 w-5 text-indigo-600 rounded flex-shrink-0" ${checked} onchange="onFuelToggle('${f}')">
            <span class="text-slate-800 font-bold text-sm leading-tight flex-1">${f}</span>${moyText}
        `;
        container.appendChild(row);
    });
    initFuelDragDrop();
}

function initFuelDragDrop() {
    const container = document.getElementById('fuels-checkboxes');
    let draggedEl = null;
    let dragGhostEl = null;
    let touchClone = null;
    let touchOffsetX = 0;
    let touchOffsetY = 0;
    let activeTouchRow = null;

    function cleanupDragClasses() {
        container.querySelectorAll('.fuel-row').forEach(r => r.classList.remove('border-t-2', 'border-indigo-400'));
    }

    container.querySelectorAll('.fuel-row').forEach(row => {
        row.addEventListener('dragstart', e => {
            if (e.target.closest('input') || e.target.closest('button')) {
                e.preventDefault();
                return;
            }
            draggedEl = row;
            row.classList.add('fuel-row-drag-source', 'fuel-row-drag-active');
            const ghost = row.cloneNode(true);
            ghost.style.cssText = 'position:absolute;top:-9999px;left:0;width:' + row.offsetWidth + 'px;pointer-events:none;';
            document.body.appendChild(ghost);
            dragGhostEl = ghost;
            try {
                e.dataTransfer.setDragImage(ghost, e.offsetX, e.offsetY);
            } catch (err) {}
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', row.dataset.fuel);
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('fuel-row-drag-source', 'fuel-row-drag-active');
            if (dragGhostEl) {
                dragGhostEl.remove();
                dragGhostEl = null;
            }
            cleanupDragClasses();
            draggedEl = null;
        });
        row.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            cleanupDragClasses();
            row.classList.add('border-t-2', 'border-indigo-400');
        });
        row.addEventListener('drop', e => {
            e.preventDefault();
            if (!draggedEl || draggedEl === row) return;
            container.insertBefore(draggedEl, row);
            syncFuelOrderFromDOM();
        });

        row.addEventListener('touchstart', e => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            activeTouchRow = row;
            draggedEl = row;
            const touch = e.touches[0];
            const rect = row.getBoundingClientRect();
            touchOffsetX = touch.clientX - rect.left;
            touchOffsetY = touch.clientY - rect.top;
            row.classList.add('fuel-row-drag-source');
            touchClone = row.cloneNode(true);
            touchClone.classList.add('fuel-touch-float');
            touchClone.style.width = rect.width + 'px';
            touchClone.style.left = rect.left + 'px';
            touchClone.style.top = rect.top + 'px';
            touchClone.querySelectorAll('input,button').forEach(n => n.remove());
            document.body.appendChild(touchClone);
        }, { passive: true });

        row.addEventListener('touchmove', e => {
            if (!draggedEl || draggedEl !== row || !touchClone) return;
            e.preventDefault();
            const touch = e.touches[0];
            touchClone.style.left = (touch.clientX - touchOffsetX) + 'px';
            touchClone.style.top = (touch.clientY - touchOffsetY) + 'px';
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetRow = target ? target.closest('.fuel-row') : null;
            cleanupDragClasses();
            if (targetRow && targetRow !== draggedEl) targetRow.classList.add('border-t-2', 'border-indigo-400');
        }, { passive: false });

        function finishTouchDrag(e, cancelled) {
            if (activeTouchRow !== row) return;
            activeTouchRow = null;
            if (touchClone) {
                touchClone.remove();
                touchClone = null;
            }
            row.classList.remove('fuel-row-drag-source');
            if (!draggedEl || draggedEl !== row) {
                draggedEl = null;
                return;
            }
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetRow = target ? target.closest('.fuel-row') : null;
            cleanupDragClasses();
            if (!cancelled && targetRow && targetRow !== draggedEl) {
                container.insertBefore(draggedEl, targetRow);
                syncFuelOrderFromDOM();
            }
            draggedEl = null;
        }

        row.addEventListener('touchend', e => finishTouchDrag(e, false));
        row.addEventListener('touchcancel', e => finishTouchDrag(e, true));
    });

    container.addEventListener('dragover', e => e.preventDefault());
    container.addEventListener('drop', e => {
        if (draggedEl && e.target === container) {
            container.appendChild(draggedEl);
            syncFuelOrderFromDOM();
        }
    });
}

function syncFuelOrderFromDOM() {
    const rows = document.querySelectorAll('#fuels-checkboxes .fuel-row');
    const newOrder = [];
    rows.forEach(r => {
        const fuel = r.dataset.fuel;
        const cb = r.querySelector('.fuel-checkbox');
        if (cb && cb.checked) newOrder.push(fuel);
    });
    userFuels = newOrder;
    renderFuelList();
    debouncedSaveSettings();
}

function moveFuel(fuel, direction) {
    const idx = fuelDisplayOrder.indexOf(fuel);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= fuelDisplayOrder.length) return;
    [fuelDisplayOrder[idx], fuelDisplayOrder[newIdx]] = [fuelDisplayOrder[newIdx], fuelDisplayOrder[idx]];
    userFuels = fuelDisplayOrder.filter(f => userFuels.includes(f));
    renderFuelList();
    debouncedSaveSettings();
}

function onFuelToggle(fuel) {
    const cb = document.querySelector(`.fuel-checkbox[value="${fuel}"]`);
    if (cb.checked) {
        if (!userFuels.includes(fuel)) userFuels.push(fuel);
    } else {
        userFuels = userFuels.filter(f => f !== fuel);
    }
    renderFuelList();
    renderFuelWarning();
    debouncedSaveSettings();
}

function renderFuelWarning() {
    let warning = document.getElementById('fuel-warning');
    if (!warning) {
        warning = document.createElement('div');
        warning.id = 'fuel-warning';
        const container = document.getElementById('fuels-checkboxes');
        container.parentNode.insertBefore(warning, container.nextSibling);
    }
    if (userFuels.length === 0) {
        warning.className = 'mt-2 p-3 bg-red-50 border border-red-300 rounded-xl text-sm text-red-700 font-semibold flex items-center gap-2';
        warning.innerHTML = '<i class="fas fa-exclamation-triangle text-red-500"></i> Veuillez cocher au moins un carburant pour utiliser l\'application.';
    } else {
        warning.className = 'hidden';
        warning.innerHTML = '';
    }
}

function saveSettings() {
    userRadius = parseFloat(document.getElementById('radius-slider').value);
    localStorage.setItem('carbuRadius', userRadius);
    nearbyStationCache.clear();

    if (userFuels.length === 0) {
        renderFuelWarning();
        return;
    }
    localStorage.setItem('carbuFuels', JSON.stringify(userFuels));
    
    renderFavorites();
    if (currentProximitySearch) {
        const sortSelect = document.getElementById('sort-fuel-select');
        const sf = sortSelect ? sortSelect.value : "";
        applyFuelSort(sf);
    } else if (currentGeoZone) {
        searchGeoZone(currentGeoZone.type, currentGeoZone.name);
    } else if (!document.getElementById('home-view').classList.contains('hidden')) {
        debouncedSearch();
    }

    // Re-render dashboard if visible
    if (!document.getElementById('pane-statistiques').classList.contains('hidden')) {
        chartsInitialized = false;
        renderDashboard();
    }

    const currentViewId = document.getElementById('station-view').getAttribute('data-current-id');
    if (currentViewId && !document.getElementById('station-view').classList.contains('hidden')) showStation(currentViewId);
}

function resetSettings() {
    localStorage.removeItem('carbuRadius');
    localStorage.removeItem('carbuFuels');
    localStorage.removeItem('carbuFavorites');
    localStorage.removeItem('carbuWelcomeDismissed');
    location.reload();
}

// Lieux Favoris
function toggleFavoriteAddress(lat, lon, name) {
    const idStr = `${lat}-${lon}`;
    const idx = userFavorites.findIndex(f => f.id === idStr);
    const wasFav = idx > -1;
    if (wasFav) userFavorites.splice(idx, 1);
    else userFavorites.push({ id: idStr, type: 'address', name, lat, lon });
    localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites));
    renderFavorites();
    debouncedSearch();
    showToast(wasFav ? 'Lieu retiré des favoris' : 'Lieu ajouté aux favoris', wasFav ? 'fa-bookmark' : 'fa-star');
}

function toggleFavoriteCurrentStation() {
    const sid = document.getElementById('station-view').getAttribute('data-current-id');
    const s = db.stations[sid];
    const idx = userFavorites.findIndex(f => f.id === sid);
    const wasFav = idx > -1;
    if (wasFav) userFavorites.splice(idx, 1);
    else userFavorites.push({ id: sid, type: 'station', name: s.nom_osm || 'Station-service', adresse: `${s.adresse}, ${s.ville}` });
    localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites));
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

function removeFavorite(id) {
    userFavorites = userFavorites.filter(f => f.id !== id);
    localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites));
    renderFavorites();
    showToast('Favori retiré', 'fa-bookmark');
}

function renderFavorites() {
    const container = document.getElementById('favorites-container');
    const list = document.getElementById('favorites-list');
    const prevLen = userFavorites.length;
    userFavorites = userFavorites.filter(f => f.type !== 'station' || (db && db.stations[f.id]));
    if (userFavorites.length !== prevLen) localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites));
    if (userFavorites.length === 0) {
        container.classList.add('hidden');
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
                    tags.push(`<span class="inline-block ${col.bg} ${col.text} text-[11px] font-semibold px-1.5 py-0.5 rounded"${ta}>${c} ${d.prix}€</span>`);
                }
                if (tags.length) pricesHtml = `<div class="flex flex-wrap gap-1 mt-1.5">${tags.join('')}</div>`;
            }
            allHtml += `
                <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-xl hover:shadow-md hover:border-yellow-300 transition group">
                    <div class="flex justify-between items-start">
                        <div onclick="showStation('${f.id}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="font-bold text-yellow-800 truncate"><i class="fas fa-gas-pump mr-2 text-yellow-600"></i>${esc(f.name)}</div>
                            <div class="text-xs text-yellow-700 truncate mt-1">${esc(f.adresse)}</div>
                        </div>
                        <button onclick="event.stopPropagation(); removeFavorite('${f.id}')" class="ml-2 flex-shrink-0 text-yellow-400 hover:text-red-500 transition" title="Retirer des favoris"><i class="fas fa-star text-lg"></i></button>
                    </div>
                    <div onclick="showStation('${f.id}')" class="cursor-pointer">${pricesHtml}</div>
                </div>`;
        } else {
            let bestCards = '';
            if (db && f.lat && f.lon) {
                const favLat = parseFloat(f.lat);
                const favLon = parseFloat(f.lon);
                let nearbyStations = [];
                for (const [id, s] of Object.entries(db.stations)) {
                    if (!s.lat || !s.lon || !hasTrackedFuel(s)) continue;
                    if (distanceHaversine(favLat, favLon, s.lat, s.lon) <= maxStraightLineKmForRadius()) nearbyStations.push({ id, station: s });
                }
                userFuels.forEach(fuel => {
                    let best = null;
                    for (const ns of nearbyStations) {
                        const d = ns.station.carburants_disponibles[fuel];
                        if (d) {
                            const p = parseFloat(d.prix);
                            if (!best || p < best.prix) best = { prix: p, nom: ns.station.nom_osm || ns.station.ville, id: ns.id };
                        }
                    }
                    if (best) {
                        const stB = db.stations[best.id];
                        const fd = stB && stB.carburants_disponibles ? stB.carburants_disponibles[fuel] : null;
                        const maj = fd ? formatMajHtml(fd) : "";
                        bestCards += `<div onclick="event.stopPropagation(); showStation('${best.id}')" class="bg-green-50 border border-green-200 rounded-lg p-1.5 text-center cursor-pointer hover:shadow-sm transition min-w-0"><div class="text-[10px] font-bold text-green-800">${fuel}</div><div class="text-sm font-black text-green-700">${best.prix.toFixed(3)}€</div>${maj ? `<div class="text-[8px] text-green-600 font-medium leading-tight" translate="no">${maj}</div>` : ''}<div class="text-[9px] text-green-600 truncate">${esc(best.nom)}</div></div>`;
                    }
                });
            }
            const widgetRow = bestCards ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">${bestCards}</div>` : '';
            allHtml += `
                <div class="p-3 bg-indigo-50 border border-indigo-200 rounded-xl hover:shadow-md hover:border-indigo-300 transition group">
                    <div class="flex justify-between items-center">
                        <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="font-bold text-indigo-800 truncate"><i class="fas fa-map-marker-alt mr-2 text-indigo-600"></i>${esc(f.name)}</div>
                            <div class="text-xs text-indigo-700 mt-1">Adresse favorite · ${radiusSettingKmHtml()}</div>
                        </div>
                        <button onclick="event.stopPropagation(); removeFavorite('${f.id}')" class="ml-2 flex-shrink-0 text-yellow-400 hover:text-red-500 transition" title="Retirer des favoris"><i class="fas fa-star text-lg"></i></button>
                    </div>
                    <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="cursor-pointer">${widgetRow}</div>
                </div>`;
        }
    }
    list.innerHTML = allHtml;
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

/**
 * Badge prix dans une liste triée (même carburant) : vert = meilleur de la liste,
 * ambre = proche du minimum, indigo = rappel explicite du prix le plus bas affiché.
 * Colonne largeur fixe + sous-titre sur hauteur fixe pour aligner les cartes entre lignes.
 */
function buildZonePriceListBadge(prixDisplayStr, prixNum, minPrixInList) {
    const col = 'price-list-badge flex flex-col items-stretch justify-center shrink-0 w-[7.5rem] sm:w-[8.5rem] gap-1 self-center';
    const subSlot = (inner) => `<div class="min-h-[2.75rem] flex items-center justify-center px-0.5">${inner}</div>`;
    const placeholder = '<span class="invisible text-[10px] select-none" aria-hidden="true">·</span>';

    if (minPrixInList === null || !Number.isFinite(prixNum)) {
        return {
            markerType: 'station_blue',
            html: `<div class="${col}">
                <div class="font-black text-lg px-2 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 w-full text-center tabular-nums">${prixDisplayStr} €</div>
                ${subSlot(placeholder)}
            </div>`,
        };
    }
    const delta = prixNum - minPrixInList;
    if (delta <= PRICE_EPS) {
        return {
            markerType: 'station_green',
            html: `<div class="${col}">
                <div class="font-black text-lg px-2 sm:px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-900 w-full text-center tabular-nums">${prixDisplayStr} €</div>
                ${subSlot(`<p class="text-[10px] font-semibold text-green-700 text-center leading-tight"><i class="fas fa-trophy text-amber-500 mr-0.5" aria-hidden="true"></i>Meilleur prix affiché</p>`)}
            </div>`,
        };
    }
    const minFmt = formatFrEuros(minPrixInList);
    if (delta <= PRICE_NEAR_MAX) {
        return {
            markerType: 'station_orange',
            html: `<div class="${col}">
                <div class="font-black text-lg px-2 sm:px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-950 w-full text-center tabular-nums">${prixDisplayStr} €</div>
                ${subSlot(`<p class="text-[10px] text-amber-900 font-medium text-center leading-tight">+${formatFrEuros(delta)} € vs le moins cher</p>`)}
            </div>`,
        };
    }
    return {
        markerType: 'station_blue',
        html: `<div class="${col}">
            <div class="font-black text-lg px-2 sm:px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-950 w-full text-center tabular-nums">${prixDisplayStr} €</div>
            ${subSlot(`<p class="text-[10px] text-indigo-800 text-center leading-tight"><span class="font-semibold">Mieux à ${minFmt} €</span> dans cette liste</p>`)}
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
    ['recherche', 'palmares', 'statistiques'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const pane = document.getElementById(`pane-${t}`);
        if(t === tab) {
            btn.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
            btn.classList.remove('text-slate-500');
            pane.classList.remove('hidden');
        } else {
            btn.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
            btn.classList.add('text-slate-500');
            pane.classList.add('hidden');
        }
    });
    if(tab === 'palmares' && palmaresMap) setTimeout(() => palmaresMap.invalidateSize(), 100);
    if(tab === 'statistiques') renderDashboard();
}

function pushNav(state) {
    if (isRestoringNav) return;
    navStack.push(state);
    history.pushState({ idx: navStack.length }, '');
}

function goHome() {
    navStack = [];
    currentProximitySearch = null;
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
        let best = null;
        stations.forEach(s => {
            const d = s.station.carburants_disponibles[fuel];
            if (d && (!best || parseFloat(d.prix) < best.prix)) {
                best = { prix: parseFloat(d.prix), nom: s.station.nom_osm || s.station.ville, addr: `${s.station.adresse}, ${s.station.ville}`, id: s.id };
            }
        });
        if (best) {
            const stBest = db.stations[best.id];
            const fd = stBest && stBest.carburants_disponibles ? stBest.carburants_disponibles[fuel] : null;
            const maj = fd ? formatMajHtml(fd) : "";
            cards += `<div onclick="showStation('${best.id}')" class="bg-green-50 border border-green-200 rounded-xl p-2.5 text-center cursor-pointer hover:shadow-md hover:border-green-300 transition"><div class="text-[11px] font-bold text-green-800 uppercase tracking-wide">${fuel}</div><div class="text-xl font-black text-green-700 my-0.5">${best.prix.toFixed(3)} €</div>${maj ? `<div class="text-[9px] text-green-600/90 font-medium" translate="no"><i class="fas fa-clock mr-0.5"></i>${maj}</div>` : ''}<div class="text-[10px] text-green-600 truncate leading-tight">${esc(best.nom)}</div><div class="text-[9px] text-green-500 truncate leading-tight">${esc(best.addr)}</div></div>`;
        }
    });
    if (!cards) return '';
    return `<div class="mb-5 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4"><h4 class="text-base font-extrabold text-green-800 mb-3 flex items-center"><i class="fas fa-trophy text-yellow-500 mr-2"></i>Les meilleurs prix</h4><div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${cards}</div></div>`;
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
    document.getElementById('btn-favorite-station').classList.add('hidden');
    currentProximitySearch = null;
    currentGeoZone = { type, name, stationIds };

    let stations = stationIds
        .map(id => ({ id, station: db.stations[id] }))
        .filter(s => s.station && hasTrackedFuel(s.station));

    let sortFuel = overrideFuel || userFuels[0] || '';
    if (sortFuel) {
        stations = stations.filter(s => s.station.carburants_disponibles[sortFuel]);
        stations.sort((a, b) => parseFloat(a.station.carburants_disponibles[sortFuel].prix) - parseFloat(b.station.carburants_disponibles[sortFuel].prix));
    }

    const total = stations.length;
    const zoneLabel = type === 'region' ? name : `${name} (département)`;

    let sortOptions = userFuels.map(f => `<option value="${f}" ${sortFuel === f ? 'selected' : ''}>${f}</option>`).join('');

    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
            <div class="bg-gradient-to-r from-indigo-600 to-blue-500 p-4 sm:p-6 text-white text-center">
                <h2 class="text-lg sm:text-2xl font-extrabold mb-1"><i class="fas fa-map-marked-alt mr-2"></i>${esc(zoneLabel)}</h2>
                <p class="text-blue-100 text-xs sm:text-sm">${total} stations trouvées</p>
            </div>
            <div class="p-4 sm:p-6 md:p-8">
                <div id="station-map" class="mb-6 border border-slate-200 rounded-xl overflow-hidden"></div>
                ${buildBestPricesWidget(stations)}
                <div class="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
                    <label class="text-sm font-bold text-slate-700 w-full md:w-auto"><i class="fas fa-sort-amount-down mr-2 text-indigo-500"></i>Trier par prix :</label>
                    <select id="geo-sort-select" onchange="applyGeoSort('${type}', '${name.replace(/'/g, "\\'")}', this.value)" class="min-h-[3rem] py-3 px-3 border border-slate-300 rounded-xl text-base font-medium text-slate-700 bg-white outline-none focus:ring-2 focus:ring-indigo-500 w-full md:w-auto touch-manipulation">
                        ${sortOptions}
                    </select>
                </div>
                <div class="space-y-3 max-h-[min(70dvh,70vh)] overflow-y-auto custom-scrollbar scroll-touch">`;

    let minPrixListe = null;
    if (sortFuel && total > 0) {
        minPrixListe = Math.min(...stations.map(s => parseFloat(s.station.carburants_disponibles[sortFuel].prix)));
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

        let dateMaj = '';
        let fuelForDate = sortFuel || Object.keys(res.station.carburants_disponibles)[0];
        if (fuelForDate && res.station.carburants_disponibles[fuelForDate]) {
            const mj = formatMajHtml(res.station.carburants_disponibles[fuelForDate]);
            if (mj) dateMaj = `<span class="text-[10px] text-slate-400 ml-2 whitespace-nowrap" translate="no"><i class="fas fa-clock mr-0.5"></i>${mj}</span>`;
        }

        html += `
            <div onclick="showStation('${res.id}')" class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-indigo-300 cursor-pointer transition flex justify-between items-center gap-3 group">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-slate-800 text-lg group-hover:text-indigo-600 transition truncate">${esc(res.station.nom_osm) || 'Station-service'}</div>
                    <div class="text-sm text-slate-500 truncate mt-1"><i class="fas fa-map-marker-alt mr-1 text-slate-300"></i>${esc(res.station.adresse)}, ${esc(res.station.code_postal)} ${esc(res.station.ville)}${dateMaj}</div>
                </div>
                ${rightContent}
            </div>`;
    });

    html += `</div></div></div>`;

    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);

    let mapMarkers = [];
    stations.forEach(s => {
        if (s.station.lat && s.station.lon) mapMarkers.push({ type: s.markerType || 'station_blue', lat: s.station.lat, lon: s.station.lon, label: s.station.nom_osm || 'Station-service', adresse: `${s.station.adresse}, ${s.station.ville}`, id: s.id });
    });
    setTimeout(() => initStationMap(mapMarkers, true), 100);
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

    let tableHtml = `<thead class="bg-slate-100 text-slate-700 uppercase text-[10px] sm:text-xs"><tr><th class="px-2 py-2 sm:px-4 sm:py-3 sticky left-0 bg-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] z-10 whitespace-nowrap">Région</th><th class="px-2 py-2 sm:px-4 sm:py-3 whitespace-nowrap">Stations</th>`;
    fuels.forEach(f => {
        const arrow = dashSortFuel === f ? (dashSortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
        const cls = dashSortFuel === f ? 'text-indigo-600' : 'text-slate-400';
        tableHtml += `<th class="px-2 py-2 sm:px-4 sm:py-3 cursor-pointer select-none hover:text-indigo-600 transition whitespace-nowrap" onclick="sortDashboardBy('${f}')">${f} <i class="fas ${arrow} ${cls} text-[10px] ml-0.5 sm:ml-1"></i></th>`;
    });
    tableHtml += `</tr></thead><tbody class="text-sm">`;

    for (const [region, data] of regions) {
        const slug = region.replace(/[^a-zA-Z0-9]/g, '_');
        tableHtml += `<tr class="border-b hover:bg-slate-50 cursor-pointer" onclick="toggleRegionAccordion('${slug}')"><td class="px-2 py-2.5 sm:px-4 sm:py-3 font-bold sticky left-0 bg-white/95 backdrop-blur-sm z-10 max-w-[42vw] sm:max-w-none shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]"><i id="chevron-${slug}" class="fas fa-chevron-right text-xs text-slate-400 mr-1.5 sm:mr-2 transition-transform shrink-0"></i><span class="align-middle">${esc(region)}</span></td><td class="px-2 py-2.5 sm:px-4 sm:py-3 text-center tabular-nums">${data.station_count}</td>`;
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

    if (normQuery.length < 3) { resultsContainer.innerHTML = ''; return; }
    resultsContainer.innerHTML = '<div class="text-center text-slate-400 py-4"><i class="fas fa-spinner fa-spin mr-2"></i> Recherche en cours...</div>';

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
        html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4"><i class="fas fa-map-marked-alt mr-1"></i> Régions</div>`;
        regionResults.forEach(g => {
            html += `
                <div onclick="searchGeoZone('region', '${g.nom.replace(/'/g, "\\'")}')" class="p-4 bg-purple-50 border border-purple-200 rounded-xl hover:shadow-md hover:border-purple-300 cursor-pointer transition flex justify-between items-center group gap-4 mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-purple-800 group-hover:text-purple-600 transition truncate text-lg"><i class="fas fa-map-marked-alt mr-2 text-purple-500"></i>${esc(g.nom)}</div>
                        <div class="text-sm text-purple-600 mt-1">${g.count} stations</div>
                    </div>
                    <i class="fas fa-chevron-right text-purple-300 group-hover:text-purple-500 transition flex-shrink-0"></i>
                </div>
            `;
        });
    }

    if (deptResults.length > 0) {
        html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4"><i class="fas fa-map-pin mr-1"></i> Départements</div>`;
        deptResults.forEach(g => {
            html += `
                <div onclick="searchGeoZone('dept', '${g.nom.replace(/'/g, "\\'")}')" class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-indigo-300 cursor-pointer transition flex justify-between items-center group gap-4 mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-800 group-hover:text-indigo-600 transition truncate text-lg"><i class="fas fa-map-pin mr-2 text-indigo-500"></i>${esc(g.nom)} (${esc(g.code)})</div>
                        <div class="text-sm text-slate-500 mt-1">${esc(g.region)} · ${g.count} stations</div>
                    </div>
                    <i class="fas fa-chevron-right text-slate-300 group-hover:text-indigo-500 transition flex-shrink-0"></i>
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
        stationsHtml += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4 flex justify-between items-center gap-2 min-w-0"><span class="min-w-0 truncate"><i class="fas fa-gas-pump mr-1"></i> Stations-services</span>${searchSourcePill('via data.economie.gouv.fr')}</div>`;
        localResults.forEach(res => {
            const ff = userFuels.find(f => res.station.carburants_disponibles[f]);
            const mj = ff ? formatMajHtml(res.station.carburants_disponibles[ff]) : "";
            stationsHtml += `
                <div onclick="showStation('${res.id}')" class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-indigo-300 cursor-pointer transition flex justify-between items-center group gap-4 mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-800 group-hover:text-indigo-600 transition truncate text-lg">${esc(res.station.nom_osm) || 'Station-service'}</div>
                        <div class="text-sm text-slate-500 truncate mt-1"><i class="fas fa-map-marker-alt mr-1 text-slate-300"></i>${esc(res.station.adresse)}, ${esc(res.station.code_postal)} ${esc(res.station.ville)}</div>
                        ${mj ? `<div class="text-[10px] text-slate-400 mt-0.5" translate="no"><i class="fas fa-clock mr-0.5"></i>${mj}${ff ? ` · ${esc(ff)}` : ''}</div>` : ''}
                    </div>
                    <i class="fas fa-chevron-right text-slate-300 group-hover:text-indigo-500 transition flex-shrink-0"></i>
                </div>
            `;
        });
    }

    try {
        const osmResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=fr&limit=4`, { signal: currentSignal });
        const osmData = await osmResponse.json();

        if (osmData.length > 0) {
            html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4 flex justify-between items-center gap-2 min-w-0"><span class="min-w-0 truncate"><i class="fas fa-map-marked-alt mr-1"></i> Villes & Adresses</span>${searchSourcePill('via OpenStreetMap')}</div>`;
            osmData.forEach(place => {
                const parts = place.display_name.split(',');
                const name = parts[0];
                const desc = parts.slice(1, -2).join(',').trim();
                const isFav = userFavorites.some(f => f.id === `${place.lat}-${place.lon}`);

                html += `
                    <div class="bg-indigo-50 border border-indigo-100 rounded-xl hover:shadow-md hover:border-indigo-300 transition flex items-center group mb-2 overflow-hidden">
                        <div onclick="findStationsNear(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')" class="p-4 flex-1 min-w-0 cursor-pointer flex justify-between items-center">
                            <div class="min-w-0">
                                <div class="font-bold text-indigo-800 group-hover:text-indigo-600 transition truncate text-lg">${esc(name)}</div>
                                <div class="text-xs text-indigo-500 truncate mt-1"><i class="fas fa-search-location mr-1"></i>${esc(desc)}</div>
                            </div>
                            <i class="fas fa-arrow-right text-indigo-300 group-hover:text-indigo-500 transition ml-3"></i>
                        </div>
                        <button onclick="toggleFavoriteAddress(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')" class="p-4 text-xl border-l border-indigo-100 transition hover:bg-indigo-100" title="Ajouter aux lieux favoris">
                            <i class="fas fa-star ${isFav ? 'text-yellow-400' : 'text-indigo-200 hover:text-yellow-400'}"></i>
                        </button>
                    </div>
                `;
            });
        }
    } catch (e) { console.error("OSM API Error", e); }

    html += stationsHtml;

    if (html === '') {
        html = `
            <div class="p-6 bg-slate-50 text-slate-500 rounded-xl text-center border border-slate-200 mt-4">
                <i class="fas fa-filter text-2xl mb-2 text-slate-400 block"></i>
                <b>Aucun résultat trouvé.</b><br>
                <span class="text-sm mt-2 block">Note : les stations-services inactives depuis >7 jours, ou ne proposant pas les carburants que vous avez cochés dans vos paramètres, sont masquées.</span>
            </div>`;
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
    resultsContainer.innerHTML = '<div class="text-center text-indigo-600 py-4 font-bold"><i class="fas fa-compass fa-spin mr-2 text-2xl mb-2"></i><br>Recherche de votre position...</div>';
    
    navigator.geolocation.getCurrentPosition(
        (pos) => findStationsNear(pos.coords.latitude, pos.coords.longitude, "Votre position actuelle"),
        () => resultsContainer.innerHTML = '<div class="p-6 bg-slate-50 text-slate-500 rounded-xl text-center border border-slate-200"><i class="fas fa-exclamation-triangle text-2xl mb-2 text-red-400 block"></i><b>Impossible d\'obtenir votre position.</b></div>'
    );
}

function applyFuelSort(fuel) {
    if (!currentProximitySearch) return;
    renderStationsList(currentProximitySearch.lat, currentProximitySearch.lon, currentProximitySearch.labelTitle, fuel);
}

function findStationsNear(lat, lon, labelTitle) {
    if (!document.getElementById('home-view').classList.contains('hidden')) {
        pushNav({ type: 'home' });
    }
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.removeAttribute('data-current-id');
    document.getElementById('btn-favorite-station').classList.add('hidden');

    currentGeoZone = null;
    currentProximitySearch = { lat, lon, labelTitle };
    renderStationsList(lat, lon, labelTitle, userFuels[0] || "");
}

function renderStationsList(lat, lon, labelTitle, sortFuel) {
    let stationsProches = [];
    for (const [id, stat] of Object.entries(db.stations)) {
        if (!stat.lat || !stat.lon) continue;
        if (!hasTrackedFuel(stat)) continue;

        const dist = distanceHaversine(lat, lon, stat.lat, stat.lon);
        if (dist <= maxStraightLineKmForRadius()) stationsProches.push({ id, dist, station: stat });
    }

    if (sortFuel) {
        stationsProches = stationsProches.filter(s => s.station.carburants_disponibles[sortFuel]);
        stationsProches.sort((a, b) => compareStationEntriesByPriceThenDistance(sortFuel, a, b));
    } else {
        stationsProches.sort((a, b) => a.dist - b.dist);
    }

    const topStations = stationsProches; 

    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
            <div class="bg-gradient-to-r from-indigo-600 to-blue-500 p-4 sm:p-6 text-white text-center">
                <h2 class="text-lg sm:text-2xl font-extrabold"><i class="fas fa-location-arrow mr-2"></i>Stations autour de ${esc(labelTitle)}</h2>
            </div>
            <div class="p-4 sm:p-6 md:p-8">
                <div id="station-map" class="mb-6 border border-slate-200 rounded-xl overflow-hidden"></div>
    `;

    if (topStations.length === 0) {
        html += `<div class="p-6 bg-slate-50 rounded-xl text-center text-slate-500 border border-slate-200">
            <i class="fas fa-filter text-2xl mb-2 text-slate-400 block"></i>
            Aucune station-service dans un rayon d’environ ${radiusSettingKmHtml()} autour du point.<br>
            <span class="text-sm">Modifiez vos paramètres (en haut à droite) pour élargir la recherche ou ajouter des carburants.</span>
        </div>`;
    } else {
        html += buildBestPricesWidget(topStations);
        let sortOptions = userFuels.map(f => `<option value="${f}" ${sortFuel === f ? 'selected' : ''}>${f}</option>`).join('');
        html += `
            <div class="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
                <label class="text-sm font-bold text-slate-700 w-full md:w-auto"><i class="fas fa-sort-amount-down mr-2 text-indigo-500"></i>Tri :</label>
                <select id="sort-fuel-select" onchange="applyFuelSort(this.value)" class="min-h-[3rem] py-3 px-3 border border-slate-300 rounded-xl text-base font-medium text-slate-700 bg-white outline-none focus:ring-2 focus:ring-indigo-500 w-full md:w-auto touch-manipulation">
                    <option value="">Trier par distance</option>
                    ${sortOptions}
                </select>
            </div>
            <div class="space-y-3">
        `;
        
        const total = topStations.length;
        let minPrixRayon = null;
        if (sortFuel && total > 0) {
            minPrixRayon = Math.min(...topStations.map(s => parseFloat(s.station.carburants_disponibles[sortFuel].prix)));
        }

        topStations.forEach((res) => {
            let carbsHtml = "";
            let rightContent = "";

            let distText = `<div class="text-sm text-slate-500 mt-1"><i class="fas fa-route mr-1 text-slate-300"></i>à ${distanceKmSpan(res.dist)}</div>`;

            if (sortFuel) {
                const prix = res.station.carburants_disponibles[sortFuel].prix;
                const prixNum = parseFloat(prix);
                const badge = buildZonePriceListBadge(String(prix), prixNum, minPrixRayon);
                res.markerType = badge.markerType;
                rightContent = badge.html;
                const mj = formatMajHtml(res.station.carburants_disponibles[sortFuel]);
                carbsHtml = distText + (mj ? `<div class="text-[10px] text-slate-400 mt-0.5" translate="no"><i class="fas fa-clock mr-0.5"></i>${mj}</div>` : '');
            } else {
                let carbsArray = [];
                for (const [c, d] of Object.entries(res.station.carburants_disponibles)) {
                    if(userFuels.includes(c)) {
                        const mj = formatMajHtml(d);
                        carbsArray.push(`<span class="font-semibold">${c}</span> ${d.prix}€${mj ? `<span class="text-slate-400 font-normal text-[10px] ml-0.5" translate="no">(${mj})</span>` : ''}`);
                    }
                }
                carbsHtml = distText + `<div class="text-sm text-slate-600 mt-1.5">${carbsArray.join(' <span class="text-slate-300">·</span> ')}</div>`;
                rightContent = '';
                res.markerType = 'station_blue';
            }
            
            html += `
                <div onclick="showStation('${res.id}')" class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-indigo-300 cursor-pointer transition flex justify-between items-center gap-3 group">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-800 text-lg group-hover:text-indigo-600 transition truncate">${esc(res.station.nom_osm) || 'Station-service'}</div>
                        <div class="text-sm text-slate-500 truncate mt-1"><i class="fas fa-map-marker-alt mr-1 text-slate-300"></i>${esc(res.station.adresse)}, ${esc(res.station.ville)}</div>
                        ${carbsHtml}
                    </div>
                    ${rightContent}
                </div>
            `;
        });
        html += `</div>`;
    }
    html += `</div></div>`;
    
    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);

    let mapMarkers = [{ type: 'search_point', lat: lat, lon: lon, label: '📍 Point de recherche', adresse: labelTitle }];
    topStations.forEach(s => mapMarkers.push({ type: s.markerType || 'station_blue', lat: s.station.lat, lon: s.station.lon, label: s.station.nom_osm || 'Station-service', adresse: `${s.station.adresse}, ${s.station.ville}`, id: s.id }));
    setTimeout(() => initStationMap(mapMarkers, true), 100);
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
        resultsContainer.innerHTML = `<div class="p-6 bg-slate-50 text-slate-500 rounded-xl text-center border border-slate-200"><i class="fas fa-filter text-2xl mb-2 text-slate-400 block"></i><b>Aucune station-service ne propose ce carburant dans cette zone.</b></div>`;
        return;
    }

    if(sort === 'asc') resultats.sort((a, b) => a.prixInfo - b.prixInfo);
    else resultats.sort((a, b) => b.prixInfo - a.prixInfo);
    
    const top10 = resultats.slice(0, 10);

    let html = `<h4 class="font-extrabold text-slate-800 text-lg mb-3 flex items-center"><i class="fas fa-list-ol text-indigo-500 mr-2"></i> Top ${top10.length} :</h4><div class="space-y-3">`;
    top10.forEach((res, index) => {
        let medailleClass = 'bg-white border-slate-200';
        let badge = `<span class="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded-full mr-3 border border-slate-200">#${index+1}</span>`;
        if (sort === 'asc') {
            if (index === 0) { medailleClass = 'bg-yellow-100 border-yellow-400'; badge = `<span class="text-xl mr-3">🥇</span>`; }
            else if (index === 1) { medailleClass = 'bg-slate-100 border-slate-400'; badge = `<span class="text-xl mr-3">🥈</span>`; }
            else if (index === 2) { medailleClass = 'bg-orange-50 border-orange-300'; badge = `<span class="text-xl mr-3">🥉</span>`; }
        }
        
        let colorPrix = sort === 'asc' ? 'text-green-600' : 'text-red-600';
        const carbEnt = res.station.carburants_disponibles[carb];
        const majP = carbEnt ? formatMajHtml(carbEnt) : "";
        
        html += `
            <div onclick="showStation('${res.id}')" class="p-4 border rounded-xl flex items-center cursor-pointer hover:shadow-md hover:border-indigo-300 transition gap-2 group ${medailleClass}">
                ${badge}
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-slate-800 text-lg truncate group-hover:text-indigo-600 transition">${esc(res.station.nom_osm) || 'Station-service'}</div>
                    <div class="text-xs text-slate-500 truncate">${esc(res.station.ville)} (${esc(res.station.code_postal)})</div>
                    ${majP ? `<div class="text-[10px] text-slate-400 mt-0.5" translate="no"><i class="fas fa-clock mr-0.5"></i>${majP}</div>` : ''}
                </div>
                <div class="font-black ${colorPrix} text-xl ml-2 bg-white px-3 py-1 rounded-lg shadow-sm border border-slate-100 flex-shrink-0">${res.prixInfo.toFixed(3)} €</div>
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

        if (currentProximitySearch && currentProximitySearch.lat && currentProximitySearch.lon) {
            centerLat = currentProximitySearch.lat;
            centerLon = currentProximitySearch.lon;
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
                ? '<p class="mt-2 text-xs text-slate-600 leading-snug"><i class="fas fa-info-circle mr-1 text-slate-400" aria-hidden="true"></i>Pas d’autre station avec ce carburant dans la zone utilisée pour la comparaison.</p>'
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
        hintHtml = `<p class="mt-2 text-xs text-green-800 leading-snug"><i class="fas fa-check-circle text-green-600 mr-1" aria-hidden="true"></i>Parmi les stations comparées dans cette zone, c’est l’un des meilleurs prix pour ce carburant.</p>`;
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

    document.getElementById('btn-favorite-station').classList.remove('hidden');
    updateStarUI(stationId);
    
    const gmapsLink = getGoogleMapsLink(station.lat, station.lon, `${station.adresse}, ${station.code_postal} ${station.ville}`);
    
    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
            <div class="bg-gradient-to-r from-indigo-600 to-blue-500 p-4 sm:p-6 text-white relative">
                <h2 class="text-xl sm:text-3xl font-extrabold mb-2 sm:mb-3 drop-shadow-md pr-10">${esc(station.nom_osm) || 'Station-service'}</h2>
                <a href="${gmapsLink}" target="_blank" class="inline-flex items-start text-blue-100 hover:text-white transition group text-sm font-medium bg-black/20 px-4 py-3 rounded-xl hover:bg-black/30 w-full md:w-max">
                    <i class="fas fa-directions mr-2 mt-1 group-hover:scale-110 transition-transform flex-shrink-0"></i>
                    <span>${esc(station.adresse)}<br>${esc(station.code_postal)} ${esc(station.ville)}</span>
                </a>
            </div>
            
            <div class="p-4 sm:p-6 md:p-8">
                <div id="station-map" class="mb-6 sm:mb-8 border border-slate-200 rounded-xl overflow-hidden"></div>

                <h3 class="font-bold text-lg text-slate-800 mb-4"><i class="fas fa-gas-pump text-indigo-500 mr-2"></i>Prix à la pompe</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
    `;

    let mapMarkersData = [];
    let alternatives = [];

    if (station.lat && station.lon) {
        mapMarkersData.push({ type: 'station_green', lat: station.lat, lon: station.lon, label: station.nom_osm || 'Ici', adresse: `${station.adresse}, ${station.ville}`, id: stationId });
    }
    if (currentProximitySearch && currentProximitySearch.lat && currentProximitySearch.lon) {
        mapMarkersData.push({ type: 'search_point', lat: currentProximitySearch.lat, lon: currentProximitySearch.lon, label: '📍 Point de recherche initial', adresse: currentProximitySearch.labelTitle });
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
                bestBadgeHtml = `<div class="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-1 rounded mt-2 border border-yellow-300 inline-block"><i class="fas fa-star mr-1"></i>Meilleur prix national</div>`;
            } else if (minReg !== null && prixActuel <= minReg) {
                bestBadgeHtml = `<div class="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-1 rounded mt-2 border border-yellow-300 inline-block"><i class="fas fa-star mr-1"></i>Meilleur prix régional</div>`;
            } else if (minDept !== null && prixActuel <= minDept) {
                bestBadgeHtml = `<div class="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-1 rounded mt-2 border border-yellow-300 inline-block"><i class="fas fa-star mr-1"></i>Meilleur prix départemental</div>`;
            }

            let priceColor = analyse.priceMain || (analyse.isCheapest ? 'text-green-800' : 'text-slate-900');
            let euroColor = analyse.priceEuro || (analyse.isCheapest ? 'text-green-600' : 'text-slate-500');

            html += `
                <div class="p-4 rounded-xl border ${analyse.bg || 'bg-white'} ${analyse.border || 'border-slate-200'} relative overflow-hidden transition-shadow hover:shadow-md">
                    <div class="flex justify-between items-start mb-1 gap-2">
                        <span class="font-bold text-slate-700 text-lg">${carb}</span>
                        <span class="font-black text-xl sm:text-2xl shrink-0 ${priceColor}">${data.prix} <span class="text-base sm:text-lg ${euroColor}">€</span></span>
                    </div>
                    <div class="flex justify-end items-center mt-2">
                        <span class="text-slate-400 text-xs font-medium" translate="no"><i class="fas fa-clock mr-1"></i>${formatMajHtml(data)}</span>
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
        html += `<div class="col-span-1 md:col-span-2 p-6 bg-slate-50 rounded-xl text-center text-slate-500 font-medium border border-slate-200"><i class="fas fa-filter text-2xl mb-2 text-slate-300 block"></i>Aucun prix pour vos carburants favoris.</div>`;
    }
    html += `</div>`; 

    if (alternatives.length > 0) {
        let alternativesTitle = currentGeoZone
            ? `<i class="fas fa-car-side mr-2"></i>Alternatives dans ${esc(currentGeoZone.name)}`
            : currentProximitySearch
            ? `<i class="fas fa-car-side mr-2"></i>Alternatives dans votre zone de recherche`
            : `<i class="fas fa-car-side mr-2"></i>Alternatives à proximité (${radiusSettingKmHtml()})`;
            
        html += `<h3 class="font-bold text-lg text-slate-800 mb-2">${alternativesTitle}</h3><p class="text-sm text-slate-500 mb-4">Stations où vous pouvez payer moins cher pour un ou plusieurs de vos carburants suivis — à titre indicatif dans la zone affichée.</p><div class="space-y-3 mb-8">`;
        let altGroup = {};
        
        alternatives.forEach(alt => {
            if (!altGroup[alt.id]) altGroup[alt.id] = { nom: alt.nom, dist: alt.dist, carbs: [], isBetter: false };
            if (alt.isNew || !alt.isEqual) altGroup[alt.id].isBetter = true; 
            
            let prefix = alt.isNew ? "Non proposé ici, disponible à proximité" : (alt.isEqual ? "Même prix" : "Moins cher");
            altGroup[alt.id].carbs.push(`<span class="font-bold">${alt.carburant}</span> (${alt.prix}€ <span class="italic text-xs">${prefix}</span>)`);
        });

        for (const [altId, info] of Object.entries(altGroup)) {
            let t = !info.isBetter 
                ? { bg: "bg-slate-50", border: "border-slate-300", hoverBg: "hover:bg-slate-100", hoverBorder: "hover:border-slate-400", textMain: "text-slate-700", textSub: "text-slate-500", iconBg: "bg-slate-200", iconText: "text-slate-600", hoverIcon: "group-hover:bg-slate-600", badgeBorder: "border-slate-200", title: "Même prix à proximité" } 
                : { bg: "bg-white", border: "border-green-200", hoverBg: "hover:bg-green-50", hoverBorder: "hover:border-green-400", textMain: "text-green-800", textSub: "text-green-600", iconBg: "bg-green-100", iconText: "text-green-600", hoverIcon: "group-hover:bg-green-500", badgeBorder: "border-green-100", title: "Option intéressante" };

            html += `
                <button onclick="showStation('${altId}')" class="w-full text-left p-4 ${t.bg} border-2 ${t.border} rounded-xl ${t.hoverBg} ${t.hoverBorder} transition shadow-sm flex justify-between items-center group gap-4">
                    <div class="flex-1 min-w-0">
                        <div class="font-extrabold ${t.textMain} text-lg group-hover:opacity-80 transition truncate">${esc(info.nom)}</div>
                        <div class="text-sm font-semibold ${t.textSub} mt-1"><i class="fas fa-route mr-1"></i> à ${distanceKmSpan(info.dist)} d’ici</div>
                        <div class="text-sm text-slate-600 mt-2 bg-white inline-block px-3 py-1.5 rounded-lg border ${t.badgeBorder} truncate max-w-full shadow-sm leading-tight">📉 <b>${t.title} :</b><br> ${info.carbs.join('<br> ')}</div>
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
        html += `<div><h3 class="font-bold text-lg mb-3 text-slate-800"><i class="fas fa-clock text-indigo-500 mr-2"></i>Horaires</h3><div class="bg-slate-50 border border-slate-200 p-4 rounded-xl text-sm">`;
        if (station.horaires.automate_24_24) {
            html += `<div class="text-green-600 font-bold bg-green-50 p-3 rounded-xl border border-green-200"><i class="fas fa-check-circle text-xl mr-2"></i> Automate 24/24</div>`;
        } else {
            html += `<ul class="space-y-2 text-slate-700">`;
            for (const [jour, hor] of Object.entries(station.horaires.jours)) {
                if (hor === "Horaires indisponibles") continue;
                const colorClass = hor !== "Fermé" ? 'text-slate-800' : 'text-red-500 italic';
                html += `<li class="flex border-b border-slate-200 pb-1 last:border-0 last:pb-0"><span class="font-semibold w-28">${jour}</span> <span class="${colorClass}">${hor}</span></li>`;
            }
            html += `</ul>`;
        }
        html += `</div></div>`;
    }

    let aDesRupturesAffichees = false;
    let rupturesHtml = `<div><h3 class="font-bold text-lg mb-3 text-slate-800"><i class="fas fa-ban text-red-500 mr-2"></i>Indisponible</h3><div class="space-y-2">`;
    for (const [carb, data] of Object.entries(station.carburants_en_rupture)) {
        if (!userFuels.includes(carb)) continue;
        aDesRupturesAffichees = true;
        let infoSup = data.motif ? ` (${data.motif})` : '';
        rupturesHtml += `<div class="bg-red-50 border border-red-200 p-3 rounded-xl flex items-center"><div class="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center text-red-500 font-bold flex-shrink-0 mr-3"><i class="fas fa-tint-slash"></i></div><div class="min-w-0"><div class="font-bold text-red-800">${carb}</div><div class="text-xs text-red-600 truncate">Depuis le ${data.debut}${infoSup}</div></div></div>`;
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
        document.getElementById('station-map').innerHTML = '<div class="h-full w-full flex items-center justify-center bg-slate-50 text-slate-400 font-medium rounded-xl border border-slate-200"><i class="fas fa-map-marker-slash mr-2"></i> Coordonnées GPS indisponibles</div>';
        return;
    }

    stationMap = createFrenchLeafletMap('station-map');

    let bounds = [];
    const iconBlue = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconGreen = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconOrange = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconRed = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconBlack = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });

    markersData.forEach(m => {
        if (m.type === 'search_point') {
            L.circle([m.lat, m.lon], { radius: maxStraightLineKmForRadius() * 1000, color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.05, weight: 2, dashArray: '6 4' }).addTo(stationMap);
            L.circleMarker([m.lat, m.lon], { radius: 10, color: '#1e1b4b', fillColor: '#4f46e5', fillOpacity: 0.9, weight: 3 }).bindPopup(`<div class="text-center min-w-[150px]"><b class="text-slate-800 block mb-1">${esc(m.label) || 'Point'}</b><span class="text-xs text-slate-500 block">${esc(m.adresse) || ''}</span><span class="text-xs text-indigo-500 font-bold block mt-1"><span class="distance-km" translate="no">~${userRadius}\u202fkm</span> (estimation trajet)</span></div>`).addTo(stationMap).openPopup();
            bounds.push([m.lat, m.lon]);
            return;
        }
        let icon = iconBlue;
        if (m.type === 'station_green') icon = iconGreen;
        else if (m.type === 'station_orange') icon = iconOrange;
        else if (m.type === 'station_red') icon = iconRed;

        let popupBtn = m.id ? `<button onclick="showStation('${m.id}')" class="mt-2 w-full bg-indigo-600 text-white px-2 py-1.5 rounded-md font-bold text-xs hover:bg-indigo-700 transition"><i class="fas fa-eye mr-1"></i> Voir la station-service</button>` : '';
        let majPopup = '';
        if (m.id && db.stations[m.id]) {
            const stPop = db.stations[m.id];
            for (const f of userFuels) {
                if (stPop.carburants_disponibles[f]) {
                    const mj = formatMajHtml(stPop.carburants_disponibles[f]);
                    if (mj) { majPopup = `<span class="text-[10px] text-slate-500 leading-tight block mt-1" translate="no"><i class="fas fa-clock mr-0.5"></i>${mj}</span>`; break; }
                }
            }
        }
        let popupText = `<div class="text-center min-w-[150px]"><b class="text-slate-800 block mb-1">${esc(m.label) || 'Point'}</b><span class="text-xs text-slate-500 leading-tight block">${esc(m.adresse) || ''}</span>${majPopup}${popupBtn}</div>`;

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
            if (mj) majLine = `<span class="text-[10px] text-slate-500 block mb-2" translate="no"><i class="fas fa-clock mr-0.5"></i>${mj}</span>`;
        }
        let popupText = `<div class="text-center min-w-[150px]"><b class="text-slate-800 block mb-1">${esc(m.label)}</b><span class="text-xs text-slate-500 leading-tight block mb-2">${esc(m.adresse)}</span><div class="font-black ${colorText} text-lg mb-2">${m.prix.toFixed(3)} €</div>${majLine}<button onclick="showStation('${m.id}')" class="w-full bg-indigo-600 text-white px-2 py-1.5 rounded-md font-bold text-xs hover:bg-indigo-700 transition"><i class="fas fa-eye mr-1"></i> Voir</button></div>`;
        
        L.marker([m.lat, m.lon], { icon }).bindPopup(popupText).addTo(palmaresMap);
        bounds.push([m.lat, m.lon]);
    });

    if (bounds.length > 0) palmaresMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
}
