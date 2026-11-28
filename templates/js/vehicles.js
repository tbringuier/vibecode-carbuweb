// vehicles.js — Profils véhicules (paramètres) : carburants compatibles + réservoir pour estimer le plein.
import { state, prefs, FUELS, ICONS, saveVehicles, setActiveV, setFuels } from './state.js';
import { $, E, ICON, toast } from './helpers.js';
import { TouchDragReorder } from './drag-drop.js';

let onChange = () => {};
export function onVehiclesChange(fn) { onChange = fn; }

export function renderVList() {
  const c = $('vlist'); if (!c) return;
  state.vehicleDnD?.destroy(); state.vehicleDnD = null;
  if (!prefs.vehicles.length) {
    c.innerHTML = '<p class="m-sec-desc">Ajoutez votre véhicule : ses carburants seront présélectionnés et le prix du plein estimé partout.</p>';
    return;
  }
  c.innerHTML = prefs.vehicles.map((v, i) => `<div class="v-item${prefs.activeV === v.id ? ' is-active' : ''}" data-di="${i}">
      <button type="button" class="fav-h" aria-label="Déplacer ${E(v.name)}" title="Glisser pour réordonner">${ICON.drag}</button>
      <div class="v-body"><div class="v-name">${E(v.icon)} ${E(v.name)}${prefs.activeV === v.id ? ' <span class="badge badge-ok">actif</span>' : ''}</div>
        <div class="v-pills">${v.fuels.map(f => `<span class="v-pill"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${E(f)}</span>`).join('')}${v.tank ? `<span class="v-pill">${v.tank} L</span>` : ''}</div></div>
      <button type="button" class="btn btn-g btn-i btn-sm" data-act="v-edit" data-id="${E(v.id)}" aria-label="Modifier ${E(v.name)}" title="Modifier">${ICON.edit}</button>
      <button type="button" class="btn btn-g btn-i btn-sm btn-danger" data-act="v-del" data-id="${E(v.id)}" aria-label="Supprimer ${E(v.name)}" title="Supprimer">${ICON.trash}</button>
    </div>`).join('');
  if (prefs.vehicles.length > 1) state.vehicleDnD = new TouchDragReorder(c, { onReorder: (from, to) => { const [it] = prefs.vehicles.splice(from, 1); prefs.vehicles.splice(to, 0, it); saveVehicles(); renderVList(); onChange(); } });
}

export function openVForm(id) {
  state.editVId = id || null;
  const ex = id ? prefs.vehicles.find(v => v.id === id) : null;
  $('vform').classList.remove('hidden');
  $('v-add-btn').classList.add('hidden');
  $('vform-title').textContent = ex ? `Modifier « ${ex.name} »` : 'Nouveau véhicule';
  $('v-name').value = ex ? ex.name : '';
  $('v-tank').value = ex?.tank || '';
  ['v-name-err', 'v-fuels-err', 'v-tank-err'].forEach(x => $(x).classList.add('hidden'));
  ['v-name', 'v-tank'].forEach(x => $(x).classList.remove('inp-err'));
  const icon = ex ? ex.icon : ICONS[0];
  $('v-icons').innerHTML = ICONS.map(ic => `<button type="button" data-act="v-icon" data-ic="${ic}" aria-pressed="${ic === icon}" aria-label="Icône ${ic}">${ic}</button>`).join('');
  const sel = ex ? ex.fuels : prefs.fuels.length < FUELS.length ? prefs.fuels : [];
  $('v-fuels').innerHTML = FUELS.map(f => `<label class="fuel-tg"><input type="checkbox" value="${f}" class="vcb"${sel.includes(f) ? ' checked' : ''}><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</label>`).join('');
  $('v-name').focus();
}
export function pickIcon(btn) { btn.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn))); }
export function closeVForm() { state.editVId = null; $('vform').classList.add('hidden'); $('v-add-btn').classList.remove('hidden'); }

export function saveVForm() {
  ['v-name-err', 'v-fuels-err', 'v-tank-err'].forEach(x => $(x).classList.add('hidden'));
  ['v-name', 'v-tank'].forEach(x => $(x).classList.remove('inp-err'));
  const name = $('v-name').value.trim().slice(0, 30);
  const icon = document.querySelector('#v-icons [aria-pressed="true"]')?.dataset.ic || ICONS[0];
  const fuels = FUELS.filter(f => document.querySelector(`.vcb[value="${f}"]`)?.checked);
  const ts = $('v-tank').value.trim();
  let tank = null, ok = true;
  if (ts) { const n = parseInt(ts, 10); if (!Number.isFinite(n) || n < 1 || n > 999) { $('v-tank').classList.add('inp-err'); $('v-tank-err').classList.remove('hidden'); ok = false; } else tank = n; }
  if (!name) { $('v-name').classList.add('inp-err'); $('v-name-err').classList.remove('hidden'); ok = false; }
  if (!fuels.length) { $('v-fuels-err').classList.remove('hidden'); ok = false; }
  if (!ok) return;
  let id = state.editVId;
  if (id) Object.assign(prefs.vehicles.find(x => x.id === id) || {}, { name, icon, fuels, tank });
  else { id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); prefs.vehicles.push({ id, name, icon, fuels, tank }); }
  saveVehicles();
  // Un véhicule créé ou modifié devient le profil actif : ses carburants s'appliquent tout de suite.
  setActiveV(id); setFuels(fuels);
  closeVForm(); renderVList(); onChange();
  toast(`${icon} ${name} activé`);
}

export function delV(id) {
  const i = prefs.vehicles.findIndex(x => x.id === id); if (i < 0) return;
  const [v] = prefs.vehicles.splice(i, 1);
  const wasActive = prefs.activeV === id;
  if (wasActive) setActiveV(null);
  saveVehicles(); renderVList(); onChange();
  toast(`« ${v.name} » supprimé`, { label: 'Annuler', fn: () => { prefs.vehicles.splice(Math.min(i, prefs.vehicles.length), 0, v); saveVehicles(); if (wasActive) setActiveV(id); renderVList(); onChange(); } });
}
