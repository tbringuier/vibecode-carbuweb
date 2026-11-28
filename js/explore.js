import { state, prefs, PAGE } from './state.js?v=1795897500';
import { $, E, fmtP, fmtInt, notice, plural } from './helpers.js?v=1795897500';
import { deptsOfRegion, zoneStats, regionStations, deptByCode } from './data.js?v=1795897500';
import { visiblePrice } from './freshness.js?v=1795897500';
import { fuelChips } from './filters.js?v=1795897500';
import { listHtml, markersFor, sortFuelFor, sortSelect } from './lists.js?v=1795897500';
import { mapSlot, renderMap } from './map.js?v=1795897500';
import { renderZoneHistory, decorateTeaser } from './history.js?v=1795897500';
import { zoneHash } from './navigation.js?v=1795897500';
function ex() { return (state.exp ||= { region: '', dept: '', sort: 'asc' }); }
export function renderExplorer() {
  const e = ex();
  renderTeaser();
  $('exp-fuels').innerHTML = fuelChips();
  $('exp-region').innerHTML = '<option value="">France entière</option>' + state.db.regions.slice().sort((a, b) => a.localeCompare(b, 'fr')).map(r => `<option value="${E(r)}"${r === e.region ? ' selected' : ''}>${E(r)}</option>`).join('');
  fillDepts();
  $('exp-rank-w').innerHTML = sortSelect('exp-rank', sortFuelFor(false), false, 'Classer par', 'exp-rank');
  $('exp-sort').value = e.sort;
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
export function onExploreChange(el) {
  const e = ex();
  if (el.id === 'exp-region') { e.region = el.value; e.dept = ''; fillDepts(); }
  else if (el.id === 'exp-dept') e.dept = el.value;
  else if (el.id === 'exp-sort') e.sort = el.value;
  state.expLimit = 0;
  renderRanking();
  if (el.id !== 'exp-sort') renderZoneHistory();
}
function renderTeaser() {
  const st = zoneStats().fr;
  const cards = prefs.fuels.filter(f => st[f].n).map(f => `<div class="teaser-card" data-fuel="${f}"><span class="teaser-card-f"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</span><span class="teaser-card-v">${fmtP(st[f].avg)}<span class="teaser-card-u"> €/L</span></span><span class="teaser-card-t"></span><span class="teaser-card-n">Le moins cher : ${fmtP(st[f].min)} €</span><span class="teaser-card-n">${plural(st[f].n, 'station', 'stations')}</span></div>`).join('');
  $('home-teaser').innerHTML = `<h2 id="home-teaser-t" class="sec-l">Prix moyens en France aujourd’hui</h2><div class="teaser-grid">${cards}</div>`;
  decorateTeaser();
}
function zoneList() {
  const e = ex();
  if (e.dept) return deptByCode(e.dept)?.stations || [];
  if (e.region) return regionStations(e.region);
  return state.db.list;
}
export function renderRanking() {
  const e = ex(), fuel = sortFuelFor(false);
  const items = [];
  for (const s of zoneList()) { const p = visiblePrice(s, fuel); if (p) items.push({ s, dist: NaN, p: p.p }); }
  items.sort((a, b) => (e.sort === 'asc' ? a.p - b.p : b.p - a.p));
  const zone = e.dept ? `${deptByCode(e.dept)?.name || ''}` : e.region || 'France entière';
  const link = e.dept ? zoneHash('d', e.dept) : e.region ? zoneHash('r', e.region) : '';
  $('ranking-t').textContent = `${e.sort === 'asc' ? 'Les moins chères' : 'Les plus chères'} · ${fuel}`;
  $('palmares-count').textContent = items.length ? `${plural(items.length, 'station', 'stations')} · ${zone}` : '';
  $('palmares-link').innerHTML = link ? `<a class="btn btn-sm" href="${link}">Voir toutes les stations · ${E(zone)}</a>` : '';
  const lim = Math.max(PAGE, state.expLimit || 0);
  const top = e.sort === 'asc' ? 'cheap' : 'dear';
  $('palmares-results').innerHTML = listHtml(items, fuel, { key: 'explore', ranks: true, showDist: false, limit: lim, classOf: (_, i) => (i < 3 ? top : ''), empty: notice('Aucun résultat', 'Choisissez une autre zone ou un autre carburant.') });
  $('palmares-map-w').innerHTML = mapSlot('explore-map', 'd-map d-map-sticky');
  const mk = markersFor(items, fuel, 50);
  mk.forEach((m, i) => { m.cls = i < 3 ? top : ''; m.rank = i < 3 ? String(i + 1) : ''; });
  renderMap('explore-map', mk);
}
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
  const st = zoneStats(), nat = st.fr, fs = prefs.fuels.filter(f => nat[f].n);
  const { dir } = state.dashSort;
  const sf = fs.includes(state.dashSort.fuel) ? state.dashSort.fuel : null;
  const regs = state.db.regions.slice();
  if (sf) regs.sort((a, b) => { const va = st.reg[a]?.[sf]?.avg || 99, vb = st.reg[b]?.[sf]?.avg || 99; return dir === 'asc' ? va - vb : vb - va; });
  else regs.sort((a, b) => a.localeCompare(b, 'fr'));
  let t = '<caption class="sr-only">Prix moyens par région ; dépliez une région pour voir ses départements</caption><thead><tr><th scope="col" class="th-s">Région</th><th scope="col" class="tnum">Stations</th>';
  for (const f of fs) {
    const on = sf === f;
    t += `<th scope="col" class="tnum"${on ? ` aria-sort="${dir === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" class="th-btn" data-act="dash-sort" data-fuel="${f}" title="Trier par ${f}">${f}<span class="th-ar" aria-hidden="true">${on ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
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