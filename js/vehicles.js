import { state, FUELS, ICONS, LS, uFuels, setUFuels, vehicles, setVehicles, activeV, setActiveV, saveVehicles } from './state.js';
import { E, notice } from './helpers.js';
import { clearNearCache } from './prices.js';
import { TouchDragReorder } from './drag-drop.js';
import { renderFavs } from './favorites.js';
import { refreshActive, refreshAll } from './settings.js';
export function applyV() {
  if (!vehicles.length) { setActiveV(null); localStorage.removeItem(LS.av); localStorage.removeItem(LS.fl); setUFuels([...FUELS]); return; }
  if (activeV) { const v = vehicles.find(x => x.id === activeV); if (v) { setUFuels([...v.fuels]); return; } setActiveV(null); localStorage.removeItem(LS.av); }
  setUFuels(JSON.parse(localStorage.getItem(LS.fl)) || [...FUELS]);
}
export function switchV(id) {
  if (id === activeV) return;
  setActiveV(id); if (id) localStorage.setItem(LS.av, id); else localStorage.removeItem(LS.av);
  applyV(); clearNearCache(); renderVBar(); renderFavs(); refreshActive({ reset: true });
}
export function renderVBar() {
  const bar = document.getElementById('vbar'), list = document.getElementById('vbar-list');
  if (!bar || !list) return;
  if (!vehicles.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  list.innerHTML = `<button type="button" onclick="switchV(null)" aria-pressed="${!activeV}" class="chip">Tous</button>` +
    vehicles.map(v => `<button type="button" onclick="switchV('${v.id}')" aria-pressed="${activeV === v.id}" class="chip">${E(v.icon)} ${E(v.name)}</button>`).join('');
}
export function renderVList() {
  const c = document.getElementById('vlist'); if (!c) return;
  if (!vehicles.length) { c.innerHTML = notice('Aucun véhicule', 'Ajoutez-en un pour filtrer les carburants et estimer le plein.'); if (state.vehicleDnD) { state.vehicleDnD.destroy(); state.vehicleDnD = null; } return; }
  c.innerHTML = vehicles.map((v, i) => {
    const fs = v.fuels.map(f => `<span class="v-pill">${E(f)}</span>`).join('');
    const tankPill = v.tank ? `<span class="v-pill">${v.tank}\u202fL</span>` : '';
    const activeCls = activeV === v.id ? ' is-active' : '';
    return `<div data-di="${i}" class="fav${activeCls}">
      <span class="fav-h" title="Déplacer">⠿</span>
      <div class="u-grow"><div class="fav-n">${E(v.icon)} ${E(v.name)}</div><div class="v-pills">${fs}${tankPill}</div></div>
      <button type="button" class="btn btn-g btn-i btn-sm" onclick="openVForm('${v.id}')" aria-label="Modifier">✏️</button>
      <button type="button" class="btn btn-g btn-i btn-sm btn-danger" onclick="delV('${v.id}')" aria-label="Supprimer">✕</button>
    </div>`;
  }).join('');
  if (state.vehicleDnD) state.vehicleDnD.destroy(); state.vehicleDnD = null;
  if (vehicles.length > 1) state.vehicleDnD = new TouchDragReorder(c, { onReorder: (f, t) => { const [it] = vehicles.splice(f, 1); vehicles.splice(t, 0, it); saveVehicles(); renderVList(); renderVBar(); } });
}
export function openVForm(id) {
  state.editVId = id || null;
  document.getElementById('vform').classList.remove('hidden');
  document.getElementById('v-add-btn')?.classList.add('hidden');
  const ex = id ? vehicles.find(v => v.id === id) : null;
  document.getElementById('v-name').value = ex ? ex.name : '';
  document.getElementById('v-tank').value = ex?.tank || '';
  ['v-name-err', 'v-fuels-err', 'v-tank-err'].forEach(x => document.getElementById(x)?.classList.add('hidden'));
  ['v-name', 'v-tank'].forEach(x => document.getElementById(x)?.classList.remove('inp-err'));
  const si = ex ? ex.icon : ICONS[0];
  document.getElementById('v-icons').innerHTML = ICONS.map(ic => `<button type="button" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('sel'));this.classList.add('sel')" data-ic="${ic}" class="${ic === si ? 'sel' : ''}">${ic}</button>`).join('');
  const sf = ex ? ex.fuels : [];
  document.getElementById('v-fuels').innerHTML = FUELS.map(f => `<label class="fuel-tg${sf.includes(f) ? ' sel' : ''}"><input type="checkbox" value="${f}" class="vcb" ${sf.includes(f) ? 'checked' : ''} onchange="this.closest('.fuel-tg').classList.toggle('sel',this.checked)">${f}</label>`).join('');
  document.getElementById('v-name').focus();
}
export function closeVForm() { state.editVId = null; document.getElementById('vform').classList.add('hidden'); document.getElementById('v-add-btn')?.classList.remove('hidden'); }
export function saveVForm() {
  ['v-name-err', 'v-fuels-err', 'v-tank-err'].forEach(x => document.getElementById(x)?.classList.add('hidden'));
  ['v-name', 'v-tank'].forEach(x => document.getElementById(x)?.classList.remove('inp-err'));
  const name = document.getElementById('v-name').value.trim();
  const icon = document.querySelector('#v-icons button.sel')?.dataset.ic || '🚗';
  const fuels = [...document.querySelectorAll('.vcb:checked')].map(c => c.value);
  const ts = document.getElementById('v-tank').value.trim();
  let tank = null, bad = false;
  if (ts) { const n = parseInt(ts, 10); if (!Number.isFinite(n) || n < 1 || n > 999) bad = true; else tank = n; }
  let ok = true;
  if (!name) { document.getElementById('v-name').classList.add('inp-err'); document.getElementById('v-name-err').classList.remove('hidden'); ok = false; }
  if (!fuels.length) { document.getElementById('v-fuels-err').classList.remove('hidden'); ok = false; }
  if (bad) { document.getElementById('v-tank').classList.add('inp-err'); document.getElementById('v-tank-err').classList.remove('hidden'); ok = false; }
  if (!ok) return;
  if (state.editVId) { const v = vehicles.find(x => x.id === state.editVId); if (v) { v.name = name; v.icon = icon; v.fuels = fuels; v.tank = tank; } if (activeV === state.editVId) applyV(); }
  else vehicles.push({ id: 'v' + Date.now() + Math.random().toString(36).slice(2, 6), name, icon, fuels, tank });
  saveVehicles(); closeVForm(); refreshAll();
}
export function delV(id) { const v = vehicles.find(x => x.id === id); if (!v || !confirm(`Supprimer « ${v.name} » ?`)) return; setVehicles(vehicles.filter(x => x.id !== id)); saveVehicles(); if (activeV === id || !vehicles.length) { setActiveV(null); localStorage.removeItem(LS.av); applyV(); } refreshAll(); }