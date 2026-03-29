import { state, uFuels, favs } from './state.js';
import { norm, E, notice, hasFuel } from './helpers.js';
import { pClass } from './prices.js';
import { freshPill } from './freshness.js';
import { favKey, toggleFavAddr } from './favorites.js';
import { findNear } from './geolocation.js';
import { searchGeo } from './geo-zones.js';
import { coord } from './helpers.js';

export function debouncedSearch() { clearTimeout(state.searchTimeout); state.searchTimeout = setTimeout(doSearch, 400); }
export async function doSearch() {
  if (state.searchAC) state.searchAC.abort(); state.searchAC = new AbortController();
  const sig = state.searchAC.signal, q = document.getElementById('sinput').value, n = norm(q), res = document.getElementById('sresults');
  state.proxSearch = null; state.detailAnchor = null;
  if (n.length < 3) { res.innerHTML = ''; return; }
  res.innerHTML = '<div style="padding:1.5rem;text-align:center"><div class="spinner"></div><div style="margin-top:.375rem;font-size:.75rem;font-weight:600">Recherche…</div></div>';
  let h = '';
  let regs = [], depts = [];
  const isCode = /^\d{2,3}$/.test(n);
  if (isCode && state.db.dept_index[n]) { const d = state.db.dept_index[n]; depts.push({ code: n, nom: d.nom, region: d.region, count: d.stations.length }); }
  if (!isCode) {
    for (const [c, d] of Object.entries(state.db.dept_index)) if (d.nom_norm.includes(n)) depts.push({ code: c, nom: d.nom, region: d.region, count: d.stations.length });
    for (const [, r] of Object.entries(state.db.region_index)) if (r.nom_norm.includes(n)) regs.push({ nom: r.nom, count: r.stations.length });
  }
  if (regs.length) { h += '<div class="sec-l">Régions</div>'; regs.forEach(g => { h += `<div class="s-item" onclick="searchGeo('region','${g.nom.replace(/'/g, "\\'")}')"><div class="s-info"><div class="s-name">${E(g.nom)}</div><div class="s-addr">${g.count} stations</div></div><span style="color:var(--t3)">→</span></div>`; }); }
  if (depts.length) { h += '<div class="sec-l">Départements</div>'; depts.forEach(g => { h += `<div class="s-item" onclick="searchGeo('dept','${g.nom.replace(/'/g, "\\'")}')"><div class="s-info"><div class="s-name">${E(g.nom)} (${E(g.code)})</div><div class="s-addr">${E(g.region)} · ${g.count} stations</div></div><span style="color:var(--t3)">→</span></div>`; }); }
  let local = [];
  if (!isCode && state.db.cp_index[n]) state.db.cp_index[n].forEach(id => { if (hasFuel(state.db.stations[id])) local.push({ id, station: state.db.stations[id] }); });
  else if (!isCode) { for (const [id, d] of Object.entries(state.db.recherche_texte)) { if (d.texte_norm.includes(n) && hasFuel(state.db.stations[id])) local.push({ id, station: state.db.stations[id] }); if (local.length > 80) break; } }
  let sHtml = '';
  if (local.length) {
    sHtml += `<div class="sec-l" style="display:flex;justify-content:space-between">Stations <span class="pill">data.gouv</span></div>`;
    local.forEach(r => { const pCol = searchPrices(r.id, r.station); sHtml += `<div class="s-item" onclick="showStation('${r.id}')"><div class="s-info"><div class="s-name">${E(r.station.nom_osm) || 'Station'}</div><div class="s-addr">${E(r.station.adresse)}, ${E(r.station.code_postal)} ${E(r.station.ville)}</div></div><div class="s-prices">${pCol}</div></div>`; });
  }
  try {
    const or = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=fr&limit=4`, { signal: sig });
    const od = await or.json();
    if (od.length) {
      h += `<div class="sec-l" style="display:flex;justify-content:space-between">Villes & adresses <span class="pill">OSM</span></div>`;
      od.forEach(p => {
        const nm = p.display_name.split(',')[0], desc = p.display_name.split(',').slice(1, -2).join(',').trim();
        const k = favKey(p.lat, p.lon), is = k && favs.some(f => f.type === 'address' && favKey(f.lat, f.lon) === k);
        h += `<div class="s-item" style="gap:.375rem"><div class="s-info" onclick="findNear(${p.lat},${p.lon},'${nm.replace(/'/g, "\\'")}')"><div class="s-name">${E(nm)}</div><div class="s-addr">${E(desc)}</div></div><button class="btn btn-g btn-i" onclick="event.stopPropagation();toggleFavAddr(${p.lat},${p.lon},'${nm.replace(/'/g, "\\'")}')" style="color:${is ? '#eab308' : 'var(--t3)'};font-size:1.125rem">★</button></div>`;
      });
    }
  } catch (e) { if (e.name !== 'AbortError') console.error('OSM', e); }
  h += sHtml;
  if (!h) h = notice('Aucun résultat', 'Essayez un autre mot-clé.');
  if (!sig.aborted) res.innerHTML = h;
}
export function searchPrices(sid, st) {
  const fs = uFuels.filter(f => st.carburants_disponibles[f]);
  if (!fs.length) return '<span style="color:var(--t3)">→</span>';
  return fs.map(f => { const d = st.carburants_disponibles[f], cls = pClass(sid, f, d.prix), fp = freshPill(d); return `<div class="ptag ${cls}"><span class="ptag-f">${f}</span><span class="ptag-v">${d.prix}€</span>${fp}</div>`; }).join('');
}
