// data.js — Chargement économe des données et index dérivés.
//
// Deux fichiers (voir pipeline/export.py) :
//   data.json            prix + ruptures (~160 Ko gzip), revalidé à chaque rafraîchissement ;
//   stations.<hash>.json stations (adresses, horaires…), nom figé par contenu, en cache HTTP.
// Les requêtes sont conditionnelles (ETag) : un rafraîchissement sans nouveauté coûte ~0 octet.
import { state, prefs, FUELS } from './state.js';
import { norm, titleCase } from './helpers.js';
import { isExpired } from './freshness.js';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
let stationsDoc = null, stationsFile = '';

async function getJSON(url, cache = 'no-cache') {
  const r = await fetch(url, { cache });
  if (!r.ok) { const e = new Error(`HTTP ${r.status} (${url})`); e.status = r.status; throw e; }
  return r.json();
}

// Retourne true si de nouvelles données ont été chargées.
export async function loadData() {
  let live = await getJSON('data.json');
  if (live?.v !== 2 || !live.stations) throw new Error('Format de données inattendu');
  if (state.db && live.built === state.db.built && live.stations === stationsFile) { state.lastFetch = Date.now(); return false; }
  if (live.stations !== stationsFile) {
    try {
      stationsDoc = await getJSON(live.stations, 'default');
    } catch (e) {
      // data.json périmé en cache CDN qui référence un fichier stations remplacé : forcer une copie fraîche.
      if (e.status !== 404) throw e;
      live = await getJSON(`data.json?t=${Date.now()}`, 'no-store');
      stationsDoc = await getJSON(live.stations, 'default');
    }
    stationsFile = live.stations;
  }
  if (stationsDoc.s.length !== live.n) throw new Error('Données incohérentes (stations ≠ prix)');
  state.db = hydrate(stationsDoc, live);
  state.dataVersion++;
  state.lastFetch = Date.now();
  derived.clear();
  return true;
}

// ---------------------------------------------------------------------------
// Hydratation : tableaux compacts -> objets station
// ---------------------------------------------------------------------------
// station = { id, name, brand, osm, addr, city, cp, dept, deptCode, region, lat, lon,
//             hours: null | {auto, days:[7 × (null | '' | 'HH:MM-HH:MM,…')]},
//             fuels: {Gazole: {p: 1.789, t: ms}}, rupt: {E85: jour} | null }

function hydrate(sd, live) {
  const regions = sd.regions;
  const depts = sd.depts.map(([name, code, ri]) => ({ name, code, region: regions[ri] || '', stations: [] }));
  const byRegion = new Map(regions.map(r => [r, []]));
  const fuelNames = sd.fuels.map(f => (FUELS.includes(f) ? f : null));
  const t0 = live.t0 * 60000;
  const list = new Array(sd.s.length);
  const byId = new Map();
  for (let i = 0; i < sd.s.length; i++) {
    const [id, b, osm, addr, city, cp, di, lat, lon, h] = sd.s[i];
    const d = depts[di] || { name: '', code: '', region: '', stations: [] };
    const brand = b >= 0 ? sd.brands[b] : '';
    const c = titleCase(city);
    const s = {
      id, brand, osm, cp, lat, lon, addr: titleCase(addr), city: c,
      name: brand || `Station · ${c || 'inconnue'}`,
      dept: d.name, deptCode: d.code, region: d.region,
      hours: decodeHours(h, sd.hours), fuels: {}, rupt: null
    };
    const p = live.p[i] || [];
    for (let k = 0; k + 2 < p.length; k += 3) {
      const f = fuelNames[p[k]];
      if (f) s.fuels[f] = { p: p[k + 1] / 1000, t: t0 + p[k + 2] * 60000 };
    }
    const r = live.r?.[i];
    if (r) { s.rupt = {}; for (let k = 0; k + 1 < r.length; k += 2) { const f = fuelNames[r[k]]; if (f) s.rupt[f] = r[k + 1]; } }
    list[i] = s;
    byId.set(id, s);
    d.stations.push(s);
    byRegion.get(d.region)?.push(s);
  }
  return {
    built: live.built, updated: live.updated, updatedLabel: live.updated_label,
    list, byId, depts: depts.filter(d => d.stations.length), byRegion,
    regions: regions.filter(r => byRegion.get(r)?.length)
  };
}

function decodeHours(h, table) {
  if (!h) return null;
  if (h === 1) return { auto: true, days: null };
  const days = h.slice(1).map(i => (i < 0 ? null : table[i] ?? null));
  return { auto: !!h[0], days };
}
export const dayName = i => DAYS[i];

// ---------------------------------------------------------------------------
// Accès et index (calculés à la demande, invalidés à chaque nouvelle donnée)
// ---------------------------------------------------------------------------

const derived = new Map();
function memo(key, fn) { if (!derived.has(key)) derived.set(key, fn()); return derived.get(key); }
export const invalidateDerived = prefix => { for (const k of [...derived.keys()]) if (!prefix || k.startsWith(prefix)) derived.delete(k); };

export const station = id => state.db?.byId.get(String(id)) || null;
export const stationCount = () => state.db?.list.length || 0;
export const deptByCode = code => state.db?.depts.find(d => d.code === code) || null;
export const deptsOfRegion = r => (state.db?.depts || []).filter(d => d.region === r).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
export const regionStations = r => state.db?.byRegion.get(r) || [];

// Texte de recherche normalisé, construit au premier usage (évite ~50 ms au démarrage).
export const searchIndex = () => memo('search', () => state.db.list.map(s => [norm(`${s.brand} ${s.city} ${s.addr} ${s.cp}`), s]));
export const cpIndex = () => memo('cp', () => { const m = new Map(); for (const s of state.db.list) { if (!m.has(s.cp)) m.set(s.cp, []); m.get(s.cp).push(s); } return m; });
export const zoneIndex = () => memo('zones', () => ({
  regions: state.db.regions.map(r => ({ name: r, n: norm(r), count: regionStations(r).length })),
  depts: state.db.depts.map(d => ({ ...d, n: norm(d.name), count: d.stations.length }))
}));

// Statistiques par zone (moyenne, minimum, nombre de stations) sur les prix visibles
// (filtre d'ancienneté appliqué) : cohérent avec ce que l'utilisateur voit dans les listes.
export function zoneStats() {
  return memo(`stats|${prefs.maxAge}`, () => {
    const mk = () => Object.fromEntries(FUELS.map(f => [f, { sum: 0, n: 0, min: Infinity }]));
    const fr = mk(), reg = {}, dep = {}, counts = { fr: 0, reg: {}, dep: {} };
    for (const s of state.db.list) {
      const r = reg[s.region] ||= mk(), d = dep[s.dept] ||= mk();
      counts.fr++; counts.reg[s.region] = (counts.reg[s.region] || 0) + 1; counts.dep[s.dept] = (counts.dep[s.dept] || 0) + 1;
      for (const f in s.fuels) {
        const e = s.fuels[f]; if (isExpired(e)) continue;
        for (const z of [fr[f], r[f], d[f]]) { z.sum += e.p; z.n++; if (e.p < z.min) z.min = e.p; }
      }
    }
    const fin = o => { for (const f of FUELS) { const z = o[f]; z.avg = z.n ? z.sum / z.n : NaN; if (!z.n) z.min = NaN; } return o; };
    fin(fr); Object.values(reg).forEach(fin); Object.values(dep).forEach(fin);
    return { fr, reg, dep, counts };
  });
}
