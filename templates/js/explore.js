import { state, FUELS, maxAge } from './state.js';
import { E, notice, titleCase, stationName } from './helpers.js';
import { freshPill, isExpired } from './freshness.js';
import { mkMap, mkIcon } from './map.js';

const L = window.L;
const Chart = window.Chart;

export function populateFuels() { const s = document.getElementById('exp-fuel'); if (!s) return; s.innerHTML = FUELS.map(f => `<option>${f}</option>`).join(''); }
export function populateRegions() { const s = document.getElementById('exp-region'); if (!s || !state.db) return; const rs = Object.keys(state.db.region_index || {}).filter(r => r !== 'Inconnue').sort(); s.innerHTML = '<option value="">France entière</option>' + rs.map(r => `<option value="${r}">${r}</option>`).join(''); }
export function updateDeptFilter() {
  const rg = document.getElementById('exp-region').value, s = document.getElementById('exp-dept');
  if (!rg) { s.innerHTML = '<option value="">Tous</option>'; findCheapest(); return; }
  const ds = Object.entries(state.db.dept_index).filter(([, d]) => d.region === rg).sort((a, b) => a[1].nom.localeCompare(b[1].nom));
  s.innerHTML = '<option value="">Tous</option>' + ds.map(([, d]) => `<option value="${d.nom}">${d.nom}</option>`).join('');
  findCheapest();
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
  if (!top.length) { c.innerHTML = notice('Aucun résultat', 'Changez de carburant ou élargissez la zone.'); return; }
  let h = '<div class="card card-list">';
  top.forEach((r, i) => {
    const s = r.station;
    const cls = sort === 'asc' && i < 3 ? 'cheap' : sort === 'desc' && i < 3 ? 'dear' : '';
    const fp = freshPill(s.carburants_disponibles[fuel]);
    const h24 = s.horaires?.automate_24_24 ? '<span class="b24-sm">24h</span>' : '';
    h += `<div class="s-item" role="button" tabindex="0" onclick="showStation('${r.id}')"><div class="s-rank">${i + 1}</div><div class="s-info"><div class="s-name">${E(stationName(s))}${h24}</div><div class="s-addr">${E(titleCase(s.adresse))}, ${E(s.code_postal)} ${E(titleCase(s.ville))}</div></div><div class="ptag ${cls}"><span class="ptag-f">${fuel}</span><span class="ptag-v">${r.prix.toFixed(3)}€</span>${fp}</div></div>`;
  });
  h += '</div>';
  c.innerHTML = h;

  if (state.exploreMarkers) {
    state.exploreMarkers.clearLayers();
    const icons = { cheap: mkIcon('green'), mid: mkIcon('orange'), dear: mkIcon('red'), def: mkIcon('blue') };
    top.forEach((s, i) => {
      if (!s.station.lat || !s.station.lon) return;
      const ic = sort === 'asc' && i < 3 ? icons.cheap : sort === 'desc' && i < 3 ? icons.dear : icons.def;
      const pop = `<b>${E(stationName(s.station))}</b><br>${E(titleCase(s.station.ville))}<br><b>${s.prix.toFixed(3)}\u202f€</b><br><button type="button" class="pop-btn" onclick="showStation('${s.id}')">Voir</button>`;
      L.marker([s.station.lat, s.station.lon], { icon: ic }).bindPopup(pop).addTo(state.exploreMarkers);
    });
    if (top.some(s => s.station.lat && s.station.lon)) {
      const bounds = top.filter(s => s.station.lat && s.station.lon).map(s => [s.station.lat, s.station.lon]);
      state.exploreMap.fitBounds(bounds, { padding: [25, 25], maxZoom: 11 });
    }
  }
}

export function renderDash() {
  if (!state.chartsInit) {
    state.chartsInit = true;
    if (state.chartP) { state.chartP.destroy(); state.chartP = null; }
    if (state.chartF) { state.chartF.destroy(); state.chartF = null; }
    const d = state.db.dashboard, fs = Object.keys(d.national.avg_prices).filter(f => d.national.avg_prices[f] > 0);
    const cols = ['#4361ee', '#2ec4b6', '#ff9f1c', '#e63946', '#7209b7', '#06d6a0'];
    state.chartP = new Chart(document.getElementById('chart-prices'), { type: 'bar', data: { labels: fs, datasets: [{ label: '€/L', data: fs.map(f => d.national.avg_prices[f]), backgroundColor: cols }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } } });
    state.chartF = new Chart(document.getElementById('chart-fuels'), { type: 'pie', data: { labels: fs, datasets: [{ data: fs.map(f => d.national.fuel_presence[f]), backgroundColor: cols }] }, options: { responsive: true, maintainAspectRatio: false } });
  }
  renderRegTable();
}
export function sortDash(f) { if (state.dashSortFuel === f) state.dashSortDir = state.dashSortDir === 'asc' ? 'desc' : 'asc'; else { state.dashSortFuel = f; state.dashSortDir = 'asc'; } renderRegTable(); }
export function toggleReg(r) { document.querySelectorAll(`.dr-${CSS.escape(r)}`).forEach(x => x.classList.toggle('hidden')); }
export function renderRegTable() {
  const d = state.db.dashboard, fs = Object.keys(d.national.avg_prices).filter(f => d.national.avg_prices[f] > 0);
  let regs = Object.entries(d.regional).filter(([r]) => r !== 'Inconnue');
  if (state.dashSortFuel) regs.sort((a, b) => { const va = a[1].avg_prices[state.dashSortFuel] || 999, vb = b[1].avg_prices[state.dashSortFuel] || 999; return state.dashSortDir === 'asc' ? va - vb : vb - va; }); else regs.sort((a, b) => a[0].localeCompare(b[0]));
  let t = `<thead><tr><th class="th-s">Région</th><th>Nb</th>`;
  fs.forEach(f => { const ar = state.dashSortFuel === f ? (state.dashSortDir === 'asc' ? ' ↑' : ' ↓') : ''; t += `<th class="tsort" onclick="sortDash('${f}')">${f}${ar}</th>`; }); t += '</tr></thead><tbody>';
  for (const [r, data] of regs) {
    const sl = r.replace(/[^a-zA-Z0-9]/g, '_');
    t += `<tr onclick="toggleReg('${sl}')"><td class="td-s">${E(r)}</td><td class="tnum">${data.station_count}</td>`;
    fs.forEach(f => {
      const p = data.avg_prices[f], na = d.national.avg_prices[f];
      let cc = '';
      if (p > 0 && na > 0) {
        if (p < na - 0.01) cc = ' td-cheap';
        else if (p > na + 0.01) cc = ' td-dear';
      }
      t += `<td class="tnum${cc}">${p > 0 ? p.toFixed(3) + '\u202f€' : '—'}</td>`;
    });
    t += '</tr>';
    if (d.departemental) Object.entries(d.departemental).filter(([, x]) => x.region === r).sort((a, b) => a[1].nom.localeCompare(b[1].nom)).forEach(([, dp]) => {
      t += `<tr class="tdept dr-${sl} hidden"><td class="td-s">${E(dp.nom)}</td><td class="tnum">${dp.station_count}</td>`;
      fs.forEach(f => {
        const p = dp.avg_prices[f], na = d.national.avg_prices[f];
        let cc = '';
        if (p > 0 && na > 0) {
          if (p < na - 0.01) cc = ' td-cheap';
          else if (p > na + 0.01) cc = ' td-dear';
        }
        t += `<td class="tnum${cc}">${p > 0 ? p.toFixed(3) + '\u202f€' : '—'}</td>`;
      });
      t += '</tr>';
    });
  }
  t += '</tbody>'; document.getElementById('table-regions').innerHTML = t;
}
