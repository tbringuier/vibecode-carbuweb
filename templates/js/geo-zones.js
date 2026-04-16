import { state, uFuels, PRICE_EPS, PRICE_NEAR, maxAge } from './state.js';
import { E, hasFuel, notice, titleCase, stationName } from './helpers.js';
import { pClass, tankInline } from './prices.js';
import { freshPill, isExpired } from './freshness.js';
import { initMap } from './map.js';
import { pushNav, syncHeaderFav } from './navigation.js';
import { bestWidget } from './geolocation.js';

export function searchGeo(type, name, fuel) {
  let sids = [];
  if (type === 'region' && state.db.region_index[name]) sids = state.db.region_index[name].stations;
  else if (type === 'dept') {
    for (const [, d] of Object.entries(state.db.dept_index)) if (d.nom === name) { sids = d.stations; break; }
  }
  if (!sids.length) return;
  if (!document.getElementById('home-view').classList.contains('hidden')) pushNav({ type: 'home' });
  document.getElementById('home-view').classList.add('hidden');
  const sv = document.getElementById('station-view');
  sv.classList.remove('hidden');
  sv.removeAttribute('data-sid');
  state.detailAnchor = null;
  state.proxSearch = null;
  state.geoZone = { type, name, stationIds: sids };
  const isActive = (st) => uFuels.some(f => st.carburants_disponibles[f] && !isExpired(st.carburants_disponibles[f], maxAge));
  const all = sids.map(id => ({ id, station: state.db.stations[id], dist: 0 })).filter(s => s.station && isActive(s.station));
  let sf = fuel || uFuels[0] || '';
  let sts = [...all];
  if (sf) {
    sts = sts.filter(s => s.station.carburants_disponibles[sf] && !isExpired(s.station.carburants_disponibles[sf], maxAge));
    sts.sort((a, b) => parseFloat(a.station.carburants_disponibles[sf].prix) - parseFloat(b.station.carburants_disponibles[sf].prix));
  }
  const zl = type === 'region' ? name : `${name} (dép.)`;
  document.getElementById('stitle').textContent = zl;
  const opts = uFuels.map(f => `<option value="${f}" ${sf === f ? 'selected' : ''}>${f}</option>`).join('');
  let minP = null;
  if (sf && sts.length) minP = Math.min(...sts.map(s => parseFloat(s.station.carburants_disponibles[sf].prix)));
  const safeName = name.replace(/'/g, "\\'");
  let h = `<div class="zone-h"><h2>${E(zl)}</h2><div class="zone-m">${all.length} stations</div></div><div id="station-map" class="d-map"></div>${bestWidget(all)}<div class="sort-bar"><div class="field"><label class="lbl" for="geo-sort">Trier par</label><select id="geo-sort" onchange="searchGeo('${type}','${safeName}',this.value)" class="inp">${opts}</select></div><div class="count">${sts.length} station${sts.length > 1 ? 's' : ''}</div></div><div class="card card-list">`;
  if (all.length && !sts.length) h += notice('Aucune station ne propose ce carburant', '');
  sts.forEach(r => {
    const s = r.station;
    let ph = '';
    let mmk = 'station_blue';
    if (sf && s.carburants_disponibles[sf]) {
      const p = parseFloat(s.carburants_disponibles[sf].prix);
      const d = minP !== null ? p - minP : null;
      let cls = '';
      if (d !== null && d <= PRICE_EPS) { cls = 'cheap'; mmk = 'station_green'; }
      else if (d !== null && d <= PRICE_NEAR) { cls = 'mid'; mmk = 'station_orange'; }
      const fp = freshPill(s.carburants_disponibles[sf]);
      ph = `<div class="ptag ${cls}"><span class="ptag-f">${sf}</span><span class="ptag-v">${s.carburants_disponibles[sf].prix}€</span>${fp}${tankInline(parseFloat(s.carburants_disponibles[sf].prix))}</div>`;
    } else {
      ph = uFuels.filter(f => s.carburants_disponibles[f] && !isExpired(s.carburants_disponibles[f], maxAge)).map(f => {
        const cls = pClass(r.id, f, s.carburants_disponibles[f].prix);
        const fp = freshPill(s.carburants_disponibles[f]);
        return `<div class="ptag ${cls}"><span class="ptag-f">${f}</span><span class="ptag-v">${s.carburants_disponibles[f].prix}€</span>${fp}${tankInline(parseFloat(s.carburants_disponibles[f].prix))}</div>`;
      }).join('');
    }
    r.mk = mmk;
    const h24 = s.horaires?.automate_24_24 ? '<span class="b24-sm">ouvert 24/7</span>' : '';
    h += `<div class="s-item" role="button" tabindex="0" onclick="showStation('${r.id}')"><div class="s-info"><div class="s-name">${E(stationName(s))}${h24}</div><div class="s-addr">${E(titleCase(s.adresse))}, ${E(s.code_postal)} ${E(titleCase(s.ville))}</div></div><div class="s-prices">${ph}</div></div>`;
  });
  h += '</div>';
  document.getElementById('scontent').innerHTML = h;
  window.scrollTo(0, 0);
  const src = sts.length ? sts : all;
  const mm = src.filter(s => s.station.lat && s.station.lon).map(s => ({ type: s.mk || 'station_blue', lat: s.station.lat, lon: s.station.lon, label: stationName(s.station), adresse: `${s.station.adresse}, ${s.station.ville}`, id: s.id }));
  setTimeout(() => initMap(mm, true), 80);
  syncHeaderFav();
}
