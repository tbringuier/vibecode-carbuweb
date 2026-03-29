import { state, activeV, vehicles, PRICE_EPS, PRICE_NEAR } from './state.js';
import { hav, nearKm } from './helpers.js';

export function tankSize() { if (!activeV) return null; const v = vehicles.find(x => x.id === activeV); return v?.tank || null; }
export function tankStr(p) { const t = tankSize(); if (!t || !Number.isFinite(p)) return null; return (p * t).toFixed(2).replace('.', ','); }
export function tankHtml(p) { const s = tankStr(p); return s ? `<div class="tank">Plein <b>${s}\u202f€</b></div>` : ''; }
export function tankInline(p) { const s = tankStr(p); return s ? ` <span class="tank" style="display:inline">→ <b>${s}\u202f€</b></span>` : ''; }

const nearCache = new Map();
export function clearNearCache() { nearCache.clear(); }

export function nearby(sid) {
  const cap = nearKm(), k = `${sid}|${cap}`;
  if (nearCache.has(k)) return nearCache.get(k);
  const st = state.db.stations[sid]; if (!st?.lat || !st?.lon) { nearCache.set(k, []); return []; }
  const ids = [];
  for (const [id, s] of Object.entries(state.db.stations)) { if (id === sid || !s.lat || !s.lon) continue; if (hav(st.lat, st.lon, s.lat, s.lon) <= cap) ids.push(id); }
  nearCache.set(k, ids); return ids;
}

export function pClass(sid, fuel, prix) {
  const st = state.db.stations[sid]; if (!st?.lat || !st?.lon) return '';
  const p = parseFloat(prix), ns = nearby(sid), ps = [p];
  for (const id of ns) { const s = state.db.stations[id]; if (s.carburants_disponibles[fuel]) ps.push(parseFloat(s.carburants_disponibles[fuel].prix)); }
  if (ps.length < 2) return '';
  const m = Math.min(...ps), d = p - m;
  if (d <= PRICE_EPS) return 'cheap'; if (d <= PRICE_NEAR) return 'mid'; return 'dear';
}

export function pickBest(cands, fuel) {
  let b = null;
  for (const e of cands) {
    const r = e.station.carburants_disponibles[fuel]; if (!r) continue;
    const p = parseFloat(r.prix); if (!Number.isFinite(p)) continue;
    const d = Number.isFinite(e.dist) ? e.dist : 0;
    if (!b || (p - b.prix < -PRICE_EPS) || (Math.abs(p - b.prix) <= PRICE_EPS && d < b.dist))
      b = { prix: p, id: e.id, nom: e.station.nom_osm || e.station.ville, dist: d };
  }
  return b;
}
