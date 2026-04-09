import { state, favs, uFuels, PRICE_EPS } from './state.js';
import { E, coord, hav, fmtKm, notice, titleCase } from './helpers.js';
import { nearby, pClass, pickBest, tankHtml, tankInline } from './prices.js';
import { freshPill, freshLabel, majHtml } from './freshness.js';
import { initMap } from './map.js';
import { pushNav } from './navigation.js';

export function showStation(sid) {
  const station = state.db.stations[sid]; if (!station) return;
  if (!document.getElementById('home-view').classList.contains('hidden')) pushNav({ type: 'home' });
  document.getElementById('home-view').classList.add('hidden');
  const sv = document.getElementById('station-view'); sv.classList.remove('hidden'); sv.setAttribute('data-sid', sid);
  document.getElementById('stitle').textContent = station.nom_osm || 'Station';
  document.getElementById('btn-fav-header').hidden = true;

  const mm = []; if (station.lat && station.lon) mm.push({ type: 'station_blue', lat: station.lat, lon: station.lon, label: station.nom_osm || 'Station', id: sid });
  const origin = getOrigin(); if (origin) mm.push({ type: 'search_point', lat: origin.lat, lon: origin.lon, label: origin.label });

  const isFav = favs.some(f => f.id === sid);
  let h = `<div id="station-map" class="d-map"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
      <div style="font-size:.75rem;color:var(--t2)">${E(titleCase(station.adresse))}, ${E(station.code_postal)} ${E(titleCase(station.ville))}${station.url_osm ? ` · <a href="${E(station.url_osm)}" target="_blank" rel="noopener">OSM</a>` : ''}${station.lat && station.lon ? ` · <a href="https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}" target="_blank" rel="noopener">Itinéraire</a>` : ''}</div>
      <button class="btn btn-sm" onclick="toggleFavStation()" style="${isFav ? 'color:#eab308' : ''}">★ ${isFav ? 'Retirer' : 'Favoris'}</button>
    </div>`;

  h += '<div class="p-grid">';
  let hasP = false;
  const st = station;
  const nIds = nearby(sid);
  const nSts = nIds.map(id => {
    const s = state.db.stations[id];
    const d = (st.lat && st.lon && s.lat && s.lon) ? hav(st.lat, st.lon, s.lat, s.lon) : Infinity;
    return { id, station: s, dist: d };
  });
  const alts = [];

  uFuels.forEach(fuel => {
    const d = station.carburants_disponibles[fuel];
    if (!d) {
      const b = pickBest(nSts, fuel);
      if (b) alts.push({ fuel, prix: b.prix, id: b.id, nom: b.nom, dist: b.dist, isNew: true });
      return;
    }
    hasP = true;
    const cls = pClass(sid, fuel, d.prix), mj = majHtml(d), fp = freshPill(d), fl = freshLabel(d);
    const b = pickBest(nSts, fuel);
    if (b && (b.prix < parseFloat(d.prix) - PRICE_EPS || (Math.abs(b.prix - parseFloat(d.prix)) <= PRICE_EPS && b.dist < 0.5)))
      alts.push({ fuel, prix: b.prix, id: b.id, nom: b.nom, dist: b.dist, isNew: false });
    let cmp = '';
    const mp = state.db.stats?.min_prices;
    if (mp) {
      const nm = mp.national?.[fuel], rm = mp.regional?.[station.region]?.[fuel], p = parseFloat(d.prix);
      if (Number.isFinite(nm) && Number.isFinite(p)) { const diff = p - nm; cmp = `<div style="font-size:.5rem;color:var(--t3);margin-top:.125rem">Min. nat. ${nm.toFixed(3)}€ (${diff > 0 ? '+' : ''}${diff.toFixed(3)})</div>`; }
      if (Number.isFinite(rm) && Number.isFinite(p) && rm !== nm) { const diff = p - rm; cmp += `<div style="font-size:.5rem;color:var(--t3)">Min. rég. ${rm.toFixed(3)}€ (${diff > 0 ? '+' : ''}${diff.toFixed(3)})</div>`; }
    }
    h += `<div class="p-card ${cls}"><div class="p-card-f">${fuel}</div><div class="p-card-v">${d.prix}<span class="p-card-u"> €/L</span></div>${tankHtml(parseFloat(d.prix))}<div class="p-card-d">${mj ? `Maj. ${mj}` : ''} ${fp}</div><div style="font-size:.5625rem;color:var(--t3);margin-top:.125rem">${E(fl)}</div>${cmp}</div>`;
  });
  if (!hasP) h += `<div style="grid-column:1/-1">${notice('Aucun prix', '')}</div>`;
  h += '</div>';

  if (alts.length) {
    h += '<div class="sec-l">Alternatives proches</div>';
    const grp = {};
    alts.forEach(a => {
      if (!grp[a.id]) grp[a.id] = { nom: a.nom, dist: a.dist, fuels: [], better: false };
      if (a.isNew || a.prix < parseFloat(station.carburants_disponibles[a.fuel]?.prix || 999)) grp[a.id].better = true;
      grp[a.id].fuels.push(`${a.fuel} ${a.prix.toFixed(3)}€${a.isNew ? ' (nouveau)' : ' (−)'}`);
    });
    const sorted = Object.entries(grp).sort((a, b) => a[1].dist - b[1].dist);
    for (const [aid, info] of sorted) {
      const dk = Number.isFinite(info.dist) ? ` · ${fmtKm(info.dist)}` : '';
      h += `<div class="alt${info.better ? ' better' : ''}" onclick="showStation('${aid}')"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.8125rem">${E(info.nom)}</div><div style="font-size:.6875rem;color:var(--t2);margin-top:.0625rem">${info.fuels.join(' · ')}${dk}</div></div><span style="color:var(--t3)">→</span></div>`;
    }
  }

  const hasH = station.horaires.automate_24_24 || Object.values(station.horaires.jours).some(v => v !== "Horaires indisponibles");
  if (hasH) {
    h += '<div class="sec-l">Horaires</div>';
    if (station.horaires.automate_24_24) h += '<div class="b24">Automate 24h/24</div>';
    else { h += '<ul class="hours-list">'; for (const [j, hr] of Object.entries(station.horaires.jours)) { if (hr === "Horaires indisponibles") continue; h += `<li><span class="h-day">${j}</span><span class="${hr === 'Fermé' ? 'h-closed' : ''}">${hr}</span></li>`; } h += '</ul>'; }
  }

  const rpts = Object.entries(station.carburants_en_rupture).filter(([c]) => uFuels.includes(c));
  if (rpts.length) { h += '<div class="sec-l">Indisponibles</div>'; rpts.forEach(([f, d]) => { h += `<div class="rupt"><b style="color:var(--rd)">${E(f)}</b> <span style="font-size:.6875rem;color:var(--t2);margin-left:.25rem">depuis ${E(d.debut)}${d.motif ? ' (' + E(d.motif) + ')' : ''}</span></div>`; }); }

  document.getElementById('scontent').innerHTML = h; window.scrollTo(0, 0);
  setTimeout(() => initMap(mm, false), 80);
}

export function getOrigin() {
  if (state.proxSearch) { const a = coord(state.proxSearch.lat), o = coord(state.proxSearch.lon); if (Number.isFinite(a) && Number.isFinite(o)) return { lat: a, lon: o, label: state.proxSearch.label || '' }; }
  if (state.detailAnchor) { const a = coord(state.detailAnchor.lat), o = coord(state.detailAnchor.lon); if (Number.isFinite(a) && Number.isFinite(o)) return { lat: a, lon: o, label: state.detailAnchor.label || '' }; }
  return null;
}
