import { state } from './state.js?v=1795897500';
import { $, E, notice, plural, fmtEur, fmtInt } from './helpers.js?v=1795897500';
import { regionStations, deptByCode, deptsOfRegion, zoneStats } from './data.js?v=1795897500';
import { fuelChips } from './filters.js?v=1795897500';
import { sortFuelFor, sortItems, sortSelect, listHtml, bestBand, markersFor } from './lists.js?v=1795897500';
import { mapSlot, renderMap } from './map.js?v=1795897500';
import { setHeader, shareBtn, zoneHash } from './navigation.js?v=1795897500';
const MAP_MAX = 200;
function resolve(r) {
  if (r.kind === 'r') { const st = regionStations(r.key); return st.length ? { title: r.key, sub: 'Région', stations: st, region: r.key } : null; }
  const d = deptByCode(r.key);
  return d ? { title: `${d.name} (${d.code})`, sub: d.region ? `Département · ${d.region}` : 'Département', stations: d.stations, dept: d } : null;
}
export function renderZone(r) {
  const z = resolve(r);
  if (!z) { setHeader('Zone introuvable'); $('d-body').innerHTML = notice('Zone introuvable', 'Ce lien ne correspond à aucune région ni aucun département.'); return; }
  state.origin = null;
  setHeader(z.title, z.sub, shareBtn());
  const fuel = sortFuelFor(false);
  const items = sortItems(z.stations.map(s => ({ s, dist: NaN })), fuel);
  const stats = zoneStats();
  const zs = z.dept ? stats.dep[z.dept.name] : stats.reg[z.region];
  const avg = zs?.[fuel]?.avg;
  const nav = z.region
    ? `<nav class="zone-nav" aria-label="Départements"><span class="chips-lbl">Départements</span><div class="chips">${deptsOfRegion(z.region).map(d => `<a class="chip" href="${zoneHash('d', d.code)}">${E(d.name)} <span class="chip-n">${d.code}</span></a>`).join('')}</div></nav>`
    : z.dept.region ? `<nav class="zone-nav" aria-label="Région"><a class="chip" href="${zoneHash('r', z.dept.region)}">← Toute la région ${E(z.dept.region)}</a></nav>` : '';
  $('d-body').innerHTML = `<div class="toolbar card">
      ${fuelChips()}
      <div class="toolbar-row"><div class="zone-kpi"><b>${plural(z.stations.length, 'station', 'stations')}</b>${Number.isFinite(avg) ? ` · prix moyen ${E(fuel)} <b>${fmtEur(avg)}</b>` : ''}</div><div class="sort-w">${sortSelect('zone-sort', fuel, false)}</div></div>
      ${nav}
    </div>
    ${bestBand(z.stations.map(s => ({ s, dist: NaN })))}
    <div class="split">
      <div class="split-side">${mapSlot('zone-map', 'd-map d-map-sticky')}</div>
      <div class="split-main">
        <div class="list-h"><h2 class="sec-l">Classées par prix ${E(fuel)}</h2><span class="count">${fmtInt(items.length)} / ${plural(z.stations.length, 'station', 'stations')}</span></div>
        ${listHtml(items, fuel, { key: 'zone', ranks: true, showDist: false, empty: notice('Aucune station ne propose ce carburant', 'Choisissez un autre carburant ci-dessus.') })}
      </div>
    </div>`;
  renderMap('zone-map', markersFor(items, fuel, MAP_MAX));
}