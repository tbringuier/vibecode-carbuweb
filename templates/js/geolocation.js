import { state, radius, uFuels, PRICE_EPS, PRICE_NEAR } from './state.js';
import { E, hav, maxKm, fmtKm, hasFuel, notice, titleCase } from './helpers.js';
import { pClass, pickBest, tankInline } from './prices.js';
import { freshPill } from './freshness.js';
import { initMap } from './map.js';
import { pushNav, syncHeaderFav } from './navigation.js';
import { withR } from './settings.js';

export function geolocateMe() {
  if (!navigator.geolocation) { alert("Géolocalisation non supportée."); return; }
  document.getElementById('sresults').innerHTML = '<div style="padding:1.5rem;text-align:center"><div class="spinner"></div><div style="margin-top:.375rem;font-size:.75rem;font-weight:600">Localisation…</div></div>';
  navigator.geolocation.getCurrentPosition(p => findNear(p.coords.latitude, p.coords.longitude, "Votre position"), () => { document.getElementById('sresults').innerHTML = notice('Position non disponible', 'Vérifiez les autorisations GPS.'); });
}
export function findNear(lat, lon, label, customR) {
  if (!document.getElementById('home-view').classList.contains('hidden')) pushNav({ type: 'home' });
  document.getElementById('home-view').classList.add('hidden');
  const sv = document.getElementById('station-view'); sv.classList.remove('hidden'); sv.removeAttribute('data-sid');
  state.geoZone = null; state.detailAnchor = null;
  state.proxSearch = { lat, lon, label, customR: customR || null };
  withR(() => renderList(lat, lon, label, uFuels[0] || ''));
}
export function applySort(fuel) { if (!state.proxSearch) return; withR(() => renderList(state.proxSearch.lat, state.proxSearch.lon, state.proxSearch.label, fuel)); }
export function renderList(lat, lon, label, sortFuel) {
  document.getElementById('stitle').textContent = label || 'Résultats';
  const mk = maxKm(); let sts = [];
  for (const [id, s] of Object.entries(state.db.stations)) { if (!s.lat || !s.lon || !hasFuel(s)) continue; const d = hav(lat, lon, s.lat, s.lon); if (d <= mk) sts.push({ id, station: s, dist: d }); }
  if (sortFuel) { sts = sts.filter(s => s.station.carburants_disponibles[sortFuel]); sts.sort((a, b) => { const pa = parseFloat(a.station.carburants_disponibles[sortFuel].prix), pb = parseFloat(b.station.carburants_disponibles[sortFuel].prix); return Math.abs(pa - pb) > PRICE_EPS ? pa - pb : a.dist - b.dist; }); } else sts.sort((a, b) => a.dist - b.dist);
  const opts = `<option value="" ${!sortFuel ? 'selected' : ''}>Distance</option>` + uFuels.map(f => `<option value="${f}" ${sortFuel === f ? 'selected' : ''}>${f}</option>`).join('');
  let minP = null; if (sortFuel && sts.length) minP = Math.min(...sts.map(s => parseFloat(s.station.carburants_disponibles[sortFuel].prix)));
  const allR = []; for (const [id, s] of Object.entries(state.db.stations)) { if (!s.lat || !s.lon || !hasFuel(s)) continue; if (hav(lat, lon, s.lat, s.lon) <= mk) allR.push({ id, station: s }); }
  const bw = bestWidget(allR);
  let h = `<div id="station-map" class="d-map"></div>${bw}<div style="display:flex;flex-wrap:wrap;gap:.375rem;align-items:flex-end;margin-bottom:.625rem"><div style="flex:1;min-width:8rem"><label class="lbl" for="sort-fuel">Trier par</label><select id="sort-fuel" class="inp" onchange="applySort(this.value)">${opts}</select></div><div style="font-size:.75rem;color:var(--t2);padding:.375rem 0">${sts.length} station${sts.length > 1 ? 's' : ''} · ~${radius}\u202fkm</div></div><div class="card" style="padding:0">`;
  if (!sts.length) h += notice('Aucune station', sortFuel ? `Pas de ${sortFuel} dans ce rayon.` : 'Élargissez le rayon.');
  const markers = [{ type: 'search_point', lat, lon, label }];
  sts.forEach(r => {
    const s = r.station; let ph = '', mmk = 'station_blue';
    if (sortFuel && s.carburants_disponibles[sortFuel]) {
      const p = parseFloat(s.carburants_disponibles[sortFuel].prix), d = minP !== null ? p - minP : null;
      let cls = ''; if (d !== null && d <= PRICE_EPS) { cls = 'cheap'; mmk = 'station_green'; } else if (d !== null && d <= PRICE_NEAR) { cls = 'mid'; mmk = 'station_orange'; }
      const fp = freshPill(s.carburants_disponibles[sortFuel]);
      ph = `<div class="ptag ${cls}"><span class="ptag-f">${sortFuel}</span><span class="ptag-v">${s.carburants_disponibles[sortFuel].prix}€</span>${fp}</div>`;
    } else { ph = uFuels.filter(f => s.carburants_disponibles[f]).map(f => { const cls = pClass(r.id, f, s.carburants_disponibles[f].prix), fp = freshPill(s.carburants_disponibles[f]); return `<div class="ptag ${cls}"><span class="ptag-f">${f}</span><span class="ptag-v">${s.carburants_disponibles[f].prix}€</span>${fp}</div>`; }).join(''); }
    const h24 = s.horaires?.automate_24_24 ? '<span class="b24-sm">24h</span>' : '';
    h += `<div class="s-item" onclick="showStation('${r.id}')"><div class="s-info"><div class="s-name">${E(s.nom_osm) || 'Station'}${h24}</div><div class="s-addr">${E(titleCase(s.adresse))}, ${E(s.code_postal)} ${E(titleCase(s.ville))}</div><div class="tank" style="margin-top:.125rem">${fmtKm(r.dist)}</div></div><div class="s-prices">${ph}</div></div>`;
    if (s.lat && s.lon) markers.push({ type: mmk, lat: s.lat, lon: s.lon, label: s.nom_osm || 'Station', adresse: `${s.adresse}, ${s.ville}`, id: r.id });
  });
  h += '</div>';
  document.getElementById('scontent').innerHTML = h; window.scrollTo(0, 0);
  setTimeout(() => initMap(markers, true), 80); syncHeaderFav();
}
export function bestWidget(sts) {
  let c = ''; uFuels.forEach(f => { const b = pickBest(sts, f); if (b) c += `<div class="best-c" onclick="showStation('${b.id}')"><div class="best-f">${f}</div><div class="best-v">${b.prix.toFixed(3)}€</div>${tankInline(b.prix)}<div class="best-n">${E(b.nom)}</div></div>`; });
  return c ? `<div class="sec-l">Meilleurs prix</div><div class="best-g">${c}</div>` : '';
}
