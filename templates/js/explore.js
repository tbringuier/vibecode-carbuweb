import { state, FUELS, maxAge } from './state.js';
import { E, fmtEur, fmtInt, notice, titleCase, stationName } from './helpers.js';
import { isExpired } from './freshness.js';
import { mkMap, mkIcon } from './map.js';
import { ptag } from './prices.js';
import { fuelColor, renderZoneHistory } from './history.js';

const L = window.L;
const Chart = window.Chart;

export function populateFuels() { const s = document.getElementById('exp-fuel'); if (!s) return; s.innerHTML = FUELS.map(f => `<option>${f}</option>`).join(''); }
export function populateRegions() { const s = document.getElementById('exp-region'); if (!s || !state.db) return; const rs = Object.keys(state.db.region_index || {}).filter(r => r !== 'Inconnue').sort((a, b) => a.localeCompare(b, 'fr')); s.innerHTML = '<option value="">France entière</option>' + rs.map(r => `<option value="${E(r)}">${E(r)}</option>`).join(''); }
export function updateDeptFilter() {
  const rg = document.getElementById('exp-region').value, s = document.getElementById('exp-dept');
  if (!rg) { s.innerHTML = '<option value="">Tous</option>'; s.disabled = true; onZoneChange(); return; }
  const ds = Object.entries(state.db.dept_index).filter(([, d]) => d.region === rg).sort((a, b) => a[1].nom.localeCompare(b[1].nom, 'fr'));
  s.innerHTML = '<option value="">Tous</option>' + ds.map(([c, d]) => `<option value="${E(d.nom)}">${E(d.nom)} (${E(c)})</option>`).join('');
  s.disabled = false;
  onZoneChange();
}
// Zone changée (région / département) : classement et évolution suivent la même sélection.
export function onZoneChange() { findCheapest(); renderZoneHistory(); }
// Carburant changé : l'évolution suit tant qu'elle n'affiche qu'un carburant.
export function onFuelChange() {
  findCheapest();
  const f = document.getElementById('exp-fuel')?.value;
  if (f && (!state.zoneFuels || state.zoneFuels.length <= 1)) { state.zoneFuels = [f]; renderZoneHistory(); }
}

export function renderExploreMap() {
  const el = document.getElementById('palmares-map');
  el.classList.remove('hidden');
  if (!state.exploreMap) {
    state.exploreMap = mkMap('palmares-map');
    state.exploreMap.setView([46.6, 2.5], 6);
    state.exploreMarkers = L.layerGroup().addTo(state.exploreMap);
  }
  setTimeout(() => state.exploreMap.invalidateSize(), 100);
}

export function findCheapest() {
  const fuel = document.getElementById('exp-fuel').value;
  const sort = document.getElementById('exp-sort').value;
  const rg = document.getElementById('exp-region').value;
  const dept = document.getElementById('exp-dept').value;
  const sts = [];
  for (const [id, s] of Object.entries(state.db.stations)) {
    const e = s.carburants_disponibles[fuel];
    if (!e || isExpired(e, maxAge)) continue;
    if (rg && s.region !== rg) continue;
    if (dept && s.departement !== dept) continue;
    sts.push({ id, station: s, prix: parseFloat(e.prix) });
  }
  sts.sort((a, b) => sort === 'asc' ? a.prix - b.prix : b.prix - a.prix);
  const top = sts.slice(0, 50);
  const c = document.getElementById('palmares-results');
  const cnt = document.getElementById('palmares-count');
  if (cnt) cnt.textContent = sts.length ? `${top.length} sur ${fmtInt(sts.length)} station${sts.length > 1 ? 's' : ''}` : '';
  if (!top.length) { c.innerHTML = notice('Aucun résultat', 'Changez de carburant ou élargissez la zone.'); state.exploreMarkers?.clearLayers(); return; }
  let h = '<div class="card card-list">';
  top.forEach((r, i) => {
    const s = r.station;
    const cls = sort === 'asc' && i < 3 ? 'cheap' : sort === 'desc' && i < 3 ? 'dear' : '';
    const h24 = s.horaires?.automate_24_24 ? '<span class="b24-sm">ouvert 24/7</span>' : '';
    h += `<div class="s-item" role="button" tabindex="0" onclick="showStation('${r.id}')"><div class="s-rank">${i + 1}</div><div class="s-info"><div class="s-name">${E(stationName(s))}${h24}</div><div class="s-addr">${E(titleCase(s.adresse))}, ${E(s.code_postal)} ${E(titleCase(s.ville))}</div></div>${ptag(r.id, fuel, s.carburants_disponibles[fuel], cls)}</div>`;
  });
  h += '</div>';
  c.innerHTML = h;

  if (state.exploreMarkers) {
    state.exploreMarkers.clearLayers();
    const icons = { cheap: mkIcon('green'), dear: mkIcon('red'), def: mkIcon('blue') };
    const bounds = [];
    top.forEach((s, i) => {
      if (!s.station.lat || !s.station.lon) return;
      const ic = sort === 'asc' && i < 3 ? icons.cheap : sort === 'desc' && i < 3 ? icons.dear : icons.def;
      const pop = `<div class="pop-body"><b>${i + 1}. ${E(stationName(s.station))}</b><br><span class="pop-meta">${E(titleCase(s.station.ville))}</span><br><b>${fmtEur(s.prix)}</b><br><button type="button" class="pop-btn" onclick="showStation('${s.id}')">Voir la station</button></div>`;
      L.marker([s.station.lat, s.station.lon], { icon: ic }).bindPopup(pop).addTo(state.exploreMarkers);
      bounds.push([s.station.lat, s.station.lon]);
    });
    if (bounds.length) state.exploreMap.fitBounds(bounds, { padding: [25, 25], maxZoom: 11 });
  }
}

// Barres horizontales fines (une couleur par carburant, la même partout dans le site).
function barChart(canvas, fuels, values, fmt) {
  const cs = getComputedStyle(document.documentElement);
  const txt = cs.getPropertyValue('--t2').trim(), grid = cs.getPropertyValue('--bl').trim();
  return new Chart(canvas, {
    type: 'bar',
    data: { labels: fuels, datasets: [{ data: values, backgroundColor: fuels.map(fuelColor), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.7, categoryPercentage: 0.85 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.raw) } } },
      scales: {
        x: { beginAtZero: true, ticks: { color: txt, maxTicksLimit: 5 }, grid: { color: grid }, border: { display: false } },
        y: { ticks: { color: txt }, grid: { display: false } }
      }
    }
  });
}

export function renderDash() {
  if (!state.chartsInit) {
    state.chartsInit = true;
    if (state.chartP) { state.chartP.destroy(); state.chartP = null; }
    if (state.chartF) { state.chartF.destroy(); state.chartF = null; }
    const d = state.db.dashboard, fs = FUELS.filter(f => d.national.avg_prices[f] > 0);
    if (Chart) {
      state.chartP = barChart(document.getElementById('chart-prices'), fs, fs.map(f => d.national.avg_prices[f]), fmtEur);
      state.chartF = barChart(document.getElementById('chart-fuels'), fs, fs.map(f => d.national.fuel_presence[f] || 0), v => `${fmtInt(v)} stations`);
    }
  }
  renderRegTable();
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  state.chartsInit = false;
  if (state.db && !document.getElementById('pane-explorer')?.classList.contains('hidden')) renderDash();
});
export function sortDash(f) { if (state.dashSortFuel === f) state.dashSortDir = state.dashSortDir === 'asc' ? 'desc' : 'asc'; else { state.dashSortFuel = f; state.dashSortDir = 'asc'; } renderRegTable(); }
export function toggleReg(r, row) {
  const rows = document.querySelectorAll(`.dr-${CSS.escape(r)}`);
  const open = rows[0]?.classList.contains('hidden');
  rows.forEach(x => x.classList.toggle('hidden', !open));
  row?.querySelector('.reg-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function priceCells(avg, nat, fs) {
  return fs.map(f => {
    const p = avg[f], na = nat[f];
    let cc = '';
    if (p > 0 && na > 0) { if (p < na - 0.01) cc = ' td-cheap'; else if (p > na + 0.01) cc = ' td-dear'; }
    return `<td class="tnum${cc}">${p > 0 ? fmtEur(p) : '—'}</td>`;
  }).join('');
}
export function renderRegTable() {
  const d = state.db.dashboard, nat = d.national.avg_prices, fs = FUELS.filter(f => nat[f] > 0);
  const regs = Object.entries(d.regional).filter(([r]) => r !== 'Inconnue');
  if (state.dashSortFuel) regs.sort((a, b) => { const va = a[1].avg_prices[state.dashSortFuel] || 999, vb = b[1].avg_prices[state.dashSortFuel] || 999; return state.dashSortDir === 'asc' ? va - vb : vb - va; });
  else regs.sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  let t = '<caption class="sr-only">Prix moyens par région ; dépliez une région pour voir ses départements</caption><thead><tr><th scope="col" class="th-s">Région</th><th scope="col" class="tnum">Stations</th>';
  fs.forEach(f => {
    const on = state.dashSortFuel === f;
    const sortAttr = on ? ` aria-sort="${state.dashSortDir === 'asc' ? 'ascending' : 'descending'}"` : '';
    t += `<th scope="col" class="tnum"${sortAttr}><button type="button" class="th-btn" onclick="sortDash('${f}')">${f}<span class="th-ar" aria-hidden="true">${on ? (state.dashSortDir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
  });
  t += '</tr></thead><tbody>';
  for (const [r, data] of regs) {
    const sl = r.replace(/[^a-zA-Z0-9]/g, '_');
    t += `<tr class="tr-reg" onclick="toggleReg('${sl}',this)"><td class="td-s"><button type="button" class="reg-btn" aria-expanded="false">${E(r)}</button></td><td class="tnum">${fmtInt(data.station_count)}</td>${priceCells(data.avg_prices, nat, fs)}</tr>`;
    if (d.departemental) Object.values(d.departemental).filter(x => x.region === r).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).forEach(dp => {
      t += `<tr class="tdept dr-${sl} hidden"><td class="td-s">${E(dp.nom)}</td><td class="tnum">${fmtInt(dp.station_count)}</td>${priceCells(dp.avg_prices, nat, fs)}</tr>`;
    });
  }
  t += `</tbody><tfoot><tr><td class="td-s">France</td><td class="tnum">${fmtInt(Object.keys(state.db.stations).length)}</td>${fs.map(f => `<td class="tnum">${fmtEur(nat[f])}</td>`).join('')}</tr></tfoot>`;
  document.getElementById('table-regions').innerHTML = t;
}
