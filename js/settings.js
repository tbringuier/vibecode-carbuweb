import { state, LS, radius, setRadius, uFuels, maxAge, setMaxAge, MAX_AGE_OPTIONS } from './state.js';
import { E, fmtInt } from './helpers.js';
import { clearNearCache } from './prices.js';
import { renderVBar, renderVList } from './vehicles.js';
import { renderFavs } from './favorites.js';
import { debouncedSearch } from './search.js';
import { renderList } from './geolocation.js';
import { searchGeo } from './geo-zones.js';
import { renderExploreMap, renderDash } from './explore.js';
import { showStation } from './station.js';
export function toggleSettings() { document.getElementById('settings-modal').classList.toggle('hidden'); }
export function debouncedSave() { clearTimeout(state.saveT); state.saveT = setTimeout(() => { setRadius(+document.getElementById('rslider').value); localStorage.setItem(LS.r, radius); refreshAll(); }, 300); }
export function resetAll() { Object.values(LS).forEach(k => localStorage.removeItem(k)); location.reload(); }
export function dismissOnboard() { document.getElementById('onboard').classList.add('hidden'); localStorage.setItem(LS.w, '1'); }
export function changeMaxAge(val) { const v = parseInt(val, 10); setMaxAge(MAX_AGE_OPTIONS.includes(v) ? v : 14); localStorage.setItem(LS.ma, String(maxAge)); refreshAll(); }
export function refreshActive(o) {
  const reset = o?.reset;
  if (state.proxSearch) { let sf = reset ? (uFuels[0] || '') : (document.getElementById('sort-fuel')?.value || ''); if (sf && !uFuels.includes(sf)) sf = uFuels[0] || ''; withR(() => renderList(state.proxSearch.lat, state.proxSearch.lon, state.proxSearch.label, sf)); }
  else if (state.geoZone) { let gf = reset ? (uFuels[0] || '') : (document.getElementById('geo-sort')?.value || uFuels[0] || ''); if (gf && !uFuels.includes(gf)) gf = uFuels[0] || ''; searchGeo(state.geoZone.type, state.geoZone.name, gf); }
  else if (!document.getElementById('home-view').classList.contains('hidden')) debouncedSearch();
  if (!document.getElementById('pane-explorer').classList.contains('hidden')) { state.chartsInit = false; renderDash(); }
  const sid = document.getElementById('station-view').getAttribute('data-sid');
  if (sid && !document.getElementById('station-view').classList.contains('hidden')) showStation(sid);
}
export function refreshAll() { clearNearCache(); renderVBar(); renderVList(); renderFavs(); syncFooter(); refreshActive({}); }
export function syncFooter() { const el = document.getElementById('ft-count'); if (el && state.db) el.textContent = fmtInt(Object.keys(state.db.stations).length); }
export function withR(fn) { const cr = state.proxSearch?.customR; if (!cr) return fn(); const s = radius; setRadius(cr); try { fn(); } finally { setRadius(s); } }
export async function refreshData() { if (!state.db) return; try { const r = await fetch(`data.json?_=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) return; const n = await r.json(); if (!n?.stations) return; state.db = n; refreshAll(); } catch (e) { console.warn('refresh', e); } }