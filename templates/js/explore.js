// explore.js — Onglet Explorer : prix moyens nationaux, évolution par zone, classement, tableau régional.
import { state, prefs, FUELS, PAGE } from './state.js';
import { $, E, fmtP, fmtInt, notice, plural } from './helpers.js';
import { deptsOfRegion, zoneStats, regionStations, deptByCode, stationCount } from './data.js';
import { visiblePrice } from './freshness.js';
import { listHtml, markersFor } from './lists.js';
import { mapSlot, renderMap } from './map.js';
import { renderZoneHistory, decorateTeaser } from './history.js';
import { zoneHash } from './navigation.js';

// Sélection courante de l'Explorer (gardée pendant la session).
function ex() { return (state.exp ||= { fuel: prefs.fuels[0] || FUELS[0], region: '', dept: '', sort: 'asc' }); }

export function renderExplorer() {
  const e = ex();
  renderTeaser();
  const fuelSel = $('exp-fuel'), regSel = $('exp-region'), deptSel = $('exp-dept'), sortSel = $('exp-sort');
  fuelSel.innerHTML = FUELS.map(f => `<option value="${f}"${f === e.fuel ? ' selected' : ''}>${f}</option>`).join('');
  regSel.innerHTML = '<option value="">France entière</option>' + state.db.regions.slice().sort((a, b) => a.localeCompare(b, 'fr')).map(r => `<option value="${E(r)}"${r === e.region ? ' selected' : ''}>${E(r)}</option>`).join('');
  fillDepts();
  sortSel.value = e.sort;
  renderRanking();
  renderZoneHistory();
  renderRegTable();
}

function fillDepts() {
  const e = ex(), s = $('exp-dept');
  if (!e.region) { s.innerHTML = '<option value="">Tous</option>'; s.disabled = true; e.dept = ''; return; }
  s.innerHTML = '<option value="">Tous</option>' + deptsOfRegion(e.region).map(d => `<option value="${d.code}"${d.code === e.dept ? ' selected' : ''}>${E(d.name)} (${d.code})</option>`).join('');
  s.disabled = false;
}

// Filtres (délégation : data-change="exp").
export function onExploreChange(el) {
  const e = ex();
  if (el.id === 'exp-fuel') {
    e.fuel = el.value;
    if (!state.zoneFuels || state.zoneFuels.length <= 1) state.zoneFuels = [e.fuel];
    syncTeaser();
  } else if (el.id === 'exp-region') { e.region = el.value; e.dept = ''; fillDepts(); }
  else if (el.id === 'exp-dept') e.dept = el.value;
  else if (el.id === 'exp-sort') e.sort = el.value;
  state.expLimit = 0;
  renderRanking();
  if (el.id !== 'exp-sort') renderZoneHistory();
}
export function exploreFuel(f) {
  const e = ex(); e.fuel = f; state.zoneFuels = [f]; state.expLimit = 0;
  $('exp-fuel').value = f;
  syncTeaser();
  renderRanking(); renderZoneHistory();
  $('exp-filters')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTeaser() {
  const st = zoneStats().fr;
  const cards = FUELS.filter(f => st[f].n).map(f => `<button type="button" class="teaser-card" data-act="exp-fuel" data-fuel="${f}" aria-pressed="${f === ex().fuel}"><span class="teaser-card-f"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</span><span class="teaser-card-v">${fmtP(st[f].avg)}<span class="teaser-card-u"> €/L</span></span><span class="teaser-card-t"></span><span class="teaser-card-n">${fmtInt(st[f].n)} stations · mini ${fmtP(st[f].min)}</span></button>`).join('');
  $('home-teaser').innerHTML = `<div class="sec-h"><h2 id="home-teaser-t" class="sec-l">Prix moyens en France aujourd’hui</h2><span class="sec-count">${plural(stationCount(), 'station', 'stations')}</span></div><div class="teaser-grid">${cards}</div>`;
  decorateTeaser();
}

// Cartes de prix moyens : la carte du carburant choisi reste mise en avant.
function syncTeaser() { document.querySelectorAll('.teaser-card[data-fuel]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.fuel === ex().fuel))); }

function zoneList() {
  const e = ex();
  if (e.dept) return deptByCode(e.dept)?.stations || [];
  if (e.region) return regionStations(e.region);
  return state.db.list;
}

export function renderRanking() {
  const e = ex();
  const items = [];
  for (const s of zoneList()) { const p = visiblePrice(s, e.fuel); if (p) items.push({ s, dist: NaN, p: p.p }); }
  items.sort((a, b) => (e.sort === 'asc' ? a.p - b.p : b.p - a.p));
  const zone = e.dept ? `${deptByCode(e.dept)?.name || ''}` : e.region || 'France';
  const link = e.dept ? zoneHash('d', e.dept) : e.region ? zoneHash('r', e.region) : '';
  $('palmares-count').textContent = items.length ? `${plural(items.length, 'station', 'stations')} · ${zone}` : '';
  $('palmares-link').innerHTML = link ? `<a class="btn btn-sm" href="${link}">Ouvrir ${E(zone)} en liste complète</a>` : '';
  const lim = Math.max(PAGE, state.expLimit || 0);
  // Podium : les 3 moins chères en vert (ou les 3 plus chères en rouge si l'ordre est inversé).
  const top = e.sort === 'asc' ? 'cheap' : 'dear';
  $('palmares-results').innerHTML = listHtml(items, e.fuel, { key: 'explore', ranks: true, showDist: false, limit: lim, classOf: (_, i) => (i < 3 ? top : ''), empty: notice('Aucun résultat', 'Changez de carburant ou de zone.') });
  $('palmares-map-w').innerHTML = mapSlot('explore-map', 'd-map d-map-sticky');
  const mk = markersFor(items, e.fuel, 50);
  mk.forEach((m, i) => { m.cls = i < 3 ? top : ''; m.rank = String(i + 1); });
  renderMap('explore-map', mk);
}

// ---------------------------------------------------------------------------
// Tableau régional (moyennes sur les prix visibles), départements dépliables
// ---------------------------------------------------------------------------

export function sortDash(f) {
  const d = state.dashSort;
  if (d.fuel === f) d.dir = d.dir === 'asc' ? 'desc' : 'asc'; else { d.fuel = f; d.dir = 'asc'; }
  renderRegTable();
}
export function toggleReg(btn) {
  const key = btn.dataset.reg;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  document.querySelectorAll(`tr[data-parent="${CSS.escape(key)}"]`).forEach(r => r.classList.toggle('hidden', !open));
}
function priceCells(z, nat, fs) {
  return fs.map(f => {
    const p = z?.[f]?.avg, na = nat[f].avg;
    let cc = '';
    if (p > 0 && na > 0) { if (p < na - 0.01) cc = ' td-cheap'; else if (p > na + 0.01) cc = ' td-dear'; }
    return `<td class="tnum${cc}">${Number.isFinite(p) ? fmtP(p) : '—'}</td>`;
  }).join('');
}
export function renderRegTable() {
  const st = zoneStats(), nat = st.fr, fs = FUELS.filter(f => nat[f].n);
  const { fuel: sf, dir } = state.dashSort;
  const regs = state.db.regions.slice();
  if (sf) regs.sort((a, b) => { const va = st.reg[a]?.[sf]?.avg || 99, vb = st.reg[b]?.[sf]?.avg || 99; return dir === 'asc' ? va - vb : vb - va; });
  else regs.sort((a, b) => a.localeCompare(b, 'fr'));
  let t = '<caption class="sr-only">Prix moyens par région ; dépliez une région pour voir ses départements</caption><thead><tr><th scope="col" class="th-s">Région</th><th scope="col" class="tnum">Stations</th>';
  for (const f of fs) {
    const on = sf === f;
    t += `<th scope="col" class="tnum"${on ? ` aria-sort="${dir === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" class="th-btn" data-act="dash-sort" data-fuel="${f}">${f}<span class="th-ar" aria-hidden="true">${on ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
  }
  t += '</tr></thead><tbody>';
  regs.forEach((r, i) => {
    t += `<tr class="tr-reg"><td class="td-s"><button type="button" class="reg-btn" data-act="reg-toggle" data-reg="r${i}" aria-expanded="false">${E(r)}</button></td><td class="tnum">${fmtInt(st.counts.reg[r] || 0)}</td>${priceCells(st.reg[r], nat, fs)}</tr>`;
    for (const d of deptsOfRegion(r)) {
      t += `<tr class="tdept hidden" data-parent="r${i}"><td class="td-s"><a href="${zoneHash('d', d.code)}">${E(d.name)} <span class="u-text-faint">${d.code}</span></a></td><td class="tnum">${fmtInt(st.counts.dep[d.name] || 0)}</td>${priceCells(st.dep[d.name], nat, fs)}</tr>`;
    }
  });
  t += `</tbody><tfoot><tr><td class="td-s">France</td><td class="tnum">${fmtInt(st.counts.fr)}</td>${fs.map(f => `<td class="tnum">${fmtP(nat[f].avg)}</td>`).join('')}</tr></tfoot>`;
  $('table-regions').innerHTML = t;
}
