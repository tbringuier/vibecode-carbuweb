// prices.js — Classement local des prix (cheap/mid/dear), voisinage, estimation du plein, étiquettes.
import { state, prefs, PRICE_EPS, PRICE_NEAR } from './state.js';
import { E, hav, fmtP, fmtEur2, NEAR_KM } from './helpers.js';
import { visiblePrice, freshBadge } from './freshness.js';

// ---------------------------------------------------------------------------
// Voisinage (stations à moins de NEAR_KM), mis en cache par version de données
// ---------------------------------------------------------------------------

const nearCache = new Map();
let nearVersion = -1;
export function neighbours(s) {
  if (nearVersion !== state.dataVersion) { nearCache.clear(); nearVersion = state.dataVersion; }
  if (nearCache.has(s.id)) return nearCache.get(s.id);
  const out = [];
  // Pré-filtre en degrés (évite ~10 000 calculs trigonométriques par station).
  const dLat = NEAR_KM / 111, dLon = NEAR_KM / (111 * Math.cos(s.lat * Math.PI / 180));
  for (const o of state.db.list) {
    if (o === s || Math.abs(o.lat - s.lat) > dLat || Math.abs(o.lon - s.lon) > dLon) continue;
    const d = hav(s.lat, s.lon, o.lat, o.lon);
    if (d <= NEAR_KM) out.push({ s: o, dist: d });
  }
  out.sort((a, b) => a.dist - b.dist);
  nearCache.set(s.id, out);
  return out;
}

// Stations dans un rayon (km à vol d'oiseau) autour d'un point, avec distance.
export function within(lat, lon, km) {
  const dLat = km / 111, dLon = km / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const out = [];
  for (const s of state.db.list) {
    if (Math.abs(s.lat - lat) > dLat || Math.abs(s.lon - lon) > dLon) continue;
    const d = hav(lat, lon, s.lat, s.lon);
    if (d <= km) out.push({ s, dist: d });
  }
  return out;
}

// Rang local d'un prix : {rank, of, min} parmi la station et ses voisines proposant ce carburant.
export function localRank(s, fuel) {
  const e = visiblePrice(s, fuel); if (!e) return null;
  let rank = 1, of = 1, min = e.p;
  for (const { s: o } of neighbours(s)) {
    const oe = visiblePrice(o, fuel); if (!oe) continue;
    of++;
    if (oe.p < e.p - PRICE_EPS) rank++;
    if (oe.p < min) min = oe.p;
  }
  return { rank, of, min };
}
// Classe de prix relative au voisinage.
export function pClass(s, fuel) {
  const r = localRank(s, fuel);
  if (!r || r.of < 2) return '';
  return classFor(visiblePrice(s, fuel).p - r.min);
}
export const classFor = d => (d <= PRICE_EPS ? 'cheap' : d <= PRICE_NEAR ? 'mid' : 'dear');

// Meilleur prix d'un carburant parmi des candidats [{s, dist}] (égalité : le plus proche).
export function pickBest(cands, fuel) {
  let b = null;
  for (const c of cands) {
    const e = visiblePrice(c.s, fuel); if (!e) continue;
    const d = Number.isFinite(c.dist) ? c.dist : 0;
    if (!b || e.p < b.p - PRICE_EPS || (Math.abs(e.p - b.p) <= PRICE_EPS && d < b.dist)) b = { p: e.p, s: c.s, dist: d };
  }
  return b;
}

// ---------------------------------------------------------------------------
// Plein estimé (réservoir du véhicule actif)
// ---------------------------------------------------------------------------

export const tankSize = () => prefs.vehicles.find(v => v.id === prefs.activeV)?.tank || null;
export function tankTxt(p) { const t = tankSize(); return t && Number.isFinite(p) ? fmtEur2(p * t) : ''; }

// ---------------------------------------------------------------------------
// Étiquettes prix des listes
// ---------------------------------------------------------------------------

// Étiquette principale : carburant, prix, badge d'ancienneté. `cls` imposé, sinon classement local.
export function ptag(s, fuel, cls) {
  const e = visiblePrice(s, fuel);
  if (!e) return '';
  const c = cls ?? pClass(s, fuel);
  return `<span class="ptag ${c}"><span class="ptag-f">${E(fuel)}</span><span class="ptag-v">${fmtP(e.p)} €</span>${freshBadge(e)}</span>`;
}
// Ligne secondaire compacte : autres carburants sélectionnés (« SP98 1,963 · E10 1,843 »).
export function minorPrices(s, fuels) {
  const parts = [];
  for (const f of fuels) { const e = visiblePrice(s, f); if (e) parts.push(`<span class="mp"><span class="mp-f">${E(f)}</span> ${fmtP(e.p)}</span>`); }
  return parts.join('');
}
