// state.js — Constantes, état d'exécution et préférences persistées (localStorage).
// Toute lecture du stockage est validée : une valeur corrompue (édition manuelle, ancienne
// version, quota) ne doit jamais empêcher l'application de démarrer.

export const FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"];
export const ICONS = ['🚗', '🚙', '🚛', '🏍️', '🚐', '🚌', '⛽'];

// Clés localStorage (rien n'est envoyé à un serveur, aucun cookie).
export const LS = {
  r: 'carbuRadius', f: 'carbuFavorites', v: 'carbuVehicles', av: 'carbuActiveVehicle',
  fs: 'carbuFuelSel', w: 'carbuWelcome', ma: 'carbuMaxAge', hp: 'carbuHistory',
  ds: 'carbuDataSaver', th: 'carbuTheme', rc: 'carbuRecent', nav: 'carbuNavApp', ms: 'carbuMapStyle'
};
// Applications de navigation proposées par « Y aller » ('ask' = demander à chaque fois).
export const NAV_APPS = ['waze', 'gmaps', 'apple', 'geo'];
// Anciennes clés sans interface : purgées au démarrage.
const LEGACY_KEYS = ['carbuFuels'];

export const PRICE_EPS = 0.0005, PRICE_NEAR = 0.03;
export const ROUTE_F = 1.25;               // distance routière ≈ distance à vol d'oiseau × 1,25
export const RADIUS_MIN = 1, RADIUS_MAX = 50, RADIUS_DEFAULT = 10;
export const MAX_AGE_DEFAULT = 14, MAX_AGE_OPTIONS = [14, 30, 60, 0];
export const REFRESH_MS = 20 * 60 * 1000;  // revalidation (requête conditionnelle : ~0 octet si inchangé)
export const PAGE = 40;                    // lignes rendues par lot dans les listes
export const RECENT_MAX = 8;
const HIST_DEFAULT = { period: '1y', cmp: true };
const HIST_PERIODS = ['1m', '3m', '1y', '5y', '10y', 'all'];
const cleanHist = v => (v && typeof v === 'object' ? {
  period: HIST_PERIODS.includes(v.period) ? v.period : HIST_DEFAULT.period,
  cmp: typeof v.cmp === 'boolean' ? v.cmp : HIST_DEFAULT.cmp
} : { ...HIST_DEFAULT });

// ---------------------------------------------------------------------------
// Stockage
// ---------------------------------------------------------------------------

let storageOk = true;
function read(key) { try { return localStorage.getItem(key); } catch { storageOk = false; return null; } }
function readJSON(key) { const raw = read(key); if (raw == null) return undefined; try { return JSON.parse(raw); } catch { return undefined; } }
export function write(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch { storageOk = false; return false; }
}
export const storageAvailable = () => storageOk;

const clampInt = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const finite = v => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
export const fuelList = v => (Array.isArray(v) ? FUELS.filter(f => v.includes(f)) : []);

// Validation des enregistrements (également utilisée par l'import de sauvegarde).
export function cleanFav(f) {
  if (!f || typeof f !== 'object') return null;
  if (f.type === 'station' && /^\d{4,10}$/.test(String(f.id))) {
    return { type: 'station', id: String(f.id), name: str(f.name, 120), adresse: str(f.adresse, 200) };
  }
  if (f.type === 'address') {
    const lat = +f.lat, lon = +f.lon;
    if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const o = { type: 'address', id: favKey(lat, lon), name: str(f.name, 120) || 'Lieu', lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
    if (f.radius != null) o.radius = clampInt(f.radius, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT);
    return o;
  }
  return null;
}
export function cleanVehicle(v) {
  if (!v || typeof v !== 'object' || !v.id) return null;
  const fuels = fuelList(v.fuels);
  if (!fuels.length) return null;
  const tank = v.tank == null || v.tank === '' ? null : clampInt(v.tank, 1, 999, null);
  return { id: str(String(v.id), 40), name: str(v.name, 30) || 'Véhicule', icon: ICONS.includes(v.icon) ? v.icon : ICONS[0], fuels, tank };
}
// Même précision que l'adresse #p/lat,lon (5 décimales ≈ 1 m) : un lieu favori se reconnaît depuis son lien.
export const favKey = (lat, lon) => `${(+lat).toFixed(5)}-${(+lon).toFixed(5)}`;
const dedupe = (arr, key) => { const seen = new Set(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const listOf = (v, clean, key) => dedupe((Array.isArray(v) ? v : []).map(clean).filter(Boolean), key);
function cleanRecent(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.t === 's' && /^\d{4,10}$/.test(String(r.id))) return { t: 's', id: String(r.id) };
  if (r.t === 'p' && finite(+r.lat) && finite(+r.lon)) return { t: 'p', lat: +r.lat, lon: +r.lon, label: str(r.label, 120) || 'Lieu' };
  return null;
}
const recentKey = r => (r.t === 's' ? 's' + r.id : 'p' + favKey(r.lat, r.lon));

// ---------------------------------------------------------------------------
// Préférences (lues une fois au chargement du module)
// ---------------------------------------------------------------------------

const saveDataHint = typeof navigator !== 'undefined' && !!navigator.connection?.saveData;

export const prefs = {
  radius: clampInt(read(LS.r), RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT),
  maxAge: (() => { const v = parseInt(read(LS.ma), 10); return MAX_AGE_OPTIONS.includes(v) ? v : MAX_AGE_DEFAULT; })(),
  fuels: (() => { const v = fuelList(readJSON(LS.fs)); return v.length ? v : [...FUELS]; })(),
  favs: listOf(readJSON(LS.f), cleanFav, f => f.type + f.id),
  vehicles: listOf(readJSON(LS.v), cleanVehicle, v => v.id),
  activeV: read(LS.av) || null,
  hist: cleanHist(readJSON(LS.hp)),
  dataSaver: (() => { const v = read(LS.ds); return v == null ? saveDataHint : v === '1'; })(),
  theme: (() => { const v = read(LS.th); return v === 'light' || v === 'dark' ? v : 'auto'; })(),
  recent: listOf(readJSON(LS.rc), cleanRecent, recentKey).slice(0, RECENT_MAX),
  navApp: (() => { const v = read(LS.nav); return NAV_APPS.includes(v) ? v : 'ask'; })(),
  mapStyle: read(LS.ms) === 'sat' ? 'sat' : 'plan',
  welcomed: !!read(LS.w)
};
if (prefs.activeV && !prefs.vehicles.some(v => v.id === prefs.activeV)) prefs.activeV = null;
LEGACY_KEYS.forEach(k => write(k, null));

export const saveFavs = () => write(LS.f, prefs.favs);
export const saveVehicles = () => write(LS.v, prefs.vehicles);
export const saveRecent = () => write(LS.rc, prefs.recent);
export function setRadius(r) { prefs.radius = clampInt(r, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT); write(LS.r, String(prefs.radius)); }
export function setMaxAge(v) { prefs.maxAge = MAX_AGE_OPTIONS.includes(+v) ? +v : MAX_AGE_DEFAULT; write(LS.ma, String(prefs.maxAge)); }
export function setFuels(list) { const v = fuelList(list); if (!v.length) return false; prefs.fuels = v; write(LS.fs, v); return true; }
export function setActiveV(id) { prefs.activeV = id || null; write(LS.av, prefs.activeV); }
export function setHist(v) { prefs.hist = cleanHist({ ...prefs.hist, ...v }); write(LS.hp, prefs.hist); }
export function setDataSaver(on) { prefs.dataSaver = !!on; write(LS.ds, on ? '1' : '0'); }
export function setTheme(t) { prefs.theme = t === 'light' || t === 'dark' ? t : 'auto'; write(LS.th, prefs.theme === 'auto' ? null : prefs.theme); }
export function setNavApp(a) { prefs.navApp = NAV_APPS.includes(a) ? a : 'ask'; write(LS.nav, prefs.navApp === 'ask' ? null : prefs.navApp); }
export function setMapStyle(s) { prefs.mapStyle = s === 'sat' ? 'sat' : 'plan'; write(LS.ms, prefs.mapStyle === 'sat' ? 'sat' : null); }
export function setWelcomed() { prefs.welcomed = true; write(LS.w, '1'); }
export function pushRecent(r) {
  const c = cleanRecent(r); if (!c) return;
  const k = recentKey(c);
  prefs.recent = [c, ...prefs.recent.filter(x => recentKey(x) !== k)].slice(0, RECENT_MAX);
  saveRecent();
}
export function clearRecent() { prefs.recent = []; saveRecent(); }
export function resetStorage() { Object.values(LS).forEach(k => write(k, null)); }

// Sauvegarde / restauration manuelle (fichier JSON) : favoris, véhicules et réglages.
export function exportPrefs() {
  return { app: 'carbuweb', v: 1, exported: new Date().toISOString(), radius: prefs.radius, maxAge: prefs.maxAge, fuels: prefs.fuels, favorites: prefs.favs, vehicles: prefs.vehicles, activeVehicle: prefs.activeV, history: prefs.hist, dataSaver: prefs.dataSaver, theme: prefs.theme, navApp: prefs.navApp, mapStyle: prefs.mapStyle };
}
export function importPrefs(doc) {
  if (!doc || doc.app !== 'carbuweb') throw new Error('Fichier non reconnu');
  const favs = listOf(doc.favorites, cleanFav, f => f.type + f.id);
  const vehicles = listOf(doc.vehicles, cleanVehicle, v => v.id);
  prefs.favs = favs; saveFavs();
  prefs.vehicles = vehicles; saveVehicles();
  setActiveV(vehicles.some(v => v.id === doc.activeVehicle) ? doc.activeVehicle : null);
  if (doc.radius != null) setRadius(doc.radius);
  if (doc.maxAge != null) setMaxAge(doc.maxAge);
  if (!setFuels(doc.fuels)) setFuels(FUELS);
  if (doc.history && typeof doc.history === 'object') setHist(doc.history);
  if (typeof doc.dataSaver === 'boolean') setDataSaver(doc.dataSaver);
  if (doc.theme) setTheme(doc.theme);
  if (doc.navApp) setNavApp(doc.navApp);
  if (doc.mapStyle) setMapStyle(doc.mapStyle);
  return { favs: favs.length, vehicles: vehicles.length };
}

// ---------------------------------------------------------------------------
// État d'exécution (jamais persisté)
// ---------------------------------------------------------------------------

export const state = {
  db: null,               // données hydratées (data.js)
  dataVersion: 0,         // incrémenté à chaque nouvelle donnée (invalide les caches dérivés)
  lastFetch: 0,
  route: null,            // route affichée (navigation.js)
  origin: null,           // dernier point de recherche {lat, lon, label} : distances sur la fiche station
  geo: null,              // position GPS connue {lat, lon}
  sortFuel: null,         // tri des listes (carburant ou '' = distance)
  listLimit: 0,           // nombre de lignes affichées (pagination « Voir plus »)
  expLimit: 0,
  maps: {},               // cartes Leaflet par conteneur
  charts: {},             // graphiques Chart.js par clé
  histCache: new Map(), histReq: 0, zoneReq: 0,
  dashSort: { fuel: null, dir: 'asc' },
  searchAC: null, searchT: null, toastT: null, refreshT: null,
  favDnD: null, vehicleDnD: null, editVId: null
};
