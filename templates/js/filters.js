// filters.js — Sélection des carburants (multi), véhicule actif et rayon : contrôles partagés par
// l'accueil, les listes et les favoris. Toute modification redessine la vue courante.
import { prefs, FUELS, setFuels, setActiveV, RADIUS_MIN, RADIUS_MAX } from './state.js';
import { E, toast } from './helpers.js';

let onChange = () => {};
export function onFiltersChange(fn) { onChange = fn; }

export function fuelChips(label = 'Carburants') {
  const v = prefs.vehicles.find(x => x.id === prefs.activeV);
  const chips = FUELS.map(f => {
    const on = prefs.fuels.includes(f);
    return `<button type="button" class="chip chip-fuel" data-act="fuel" data-fuel="${f}" aria-pressed="${on}"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</button>`;
  }).join('');
  const all = prefs.fuels.length === FUELS.length;
  const vchips = prefs.vehicles.length ? `<div class="chips vchips" role="group" aria-label="Véhicule">${prefs.vehicles.map(x => `<button type="button" class="chip chip-v" data-act="vehicle" data-id="${E(x.id)}" aria-pressed="${prefs.activeV === x.id}" title="${E(x.fuels.join(', '))}${x.tank ? ` · ${x.tank} L` : ''}"><span aria-hidden="true">${E(x.icon)}</span>${E(x.name)}</button>`).join('')}</div>` : '';
  return `<div class="filterbar">
    ${vchips}
    <div class="fchips-row"><span class="chips-lbl" aria-hidden="true">${E(label)}</span>
      <div class="chips fchips" role="group" aria-label="${E(label)} affichés">${chips}${all ? '' : '<button type="button" class="chip chip-ghost" data-act="fuel-all">Tous</button>'}</div>
    </div>
    ${v ? `<p class="filter-note">Profil <b>${E(v.icon)} ${E(v.name)}</b>${v.tank ? ` · plein estimé sur ${v.tank} L` : ''}</p>` : ''}
  </div>`;
}

export function toggleFuel(f) {
  if (!FUELS.includes(f)) return;
  const on = prefs.fuels.includes(f);
  if (on && prefs.fuels.length === 1) { toast('Gardez au moins un carburant'); return; }
  setFuels(on ? prefs.fuels.filter(x => x !== f) : [...prefs.fuels, f]);
  onChange('fuels');
}
export function allFuels() { setFuels(FUELS); onChange('fuels'); }

// Un véhicule applique ses carburants (et son réservoir pour le plein estimé) ; re-toucher le désactive.
export function toggleVehicle(id) {
  if (prefs.activeV === id) { setActiveV(null); toast('Profil véhicule désactivé'); }
  else {
    const v = prefs.vehicles.find(x => x.id === id); if (!v) return;
    setActiveV(id); setFuels(v.fuels);
  }
  onChange('vehicle');
}

// Curseur de rayon inline (listes de proximité, favoris).
export function radiusControl(id, value, note = '') {
  return `<div class="rng-inline">
    <label class="rng-l" for="${id}">Rayon</label>
    <input type="range" id="${id}" min="${RADIUS_MIN}" max="${RADIUS_MAX}" step="1" value="${value}" data-input="radius" aria-describedby="${id}-v">
    <output id="${id}-v" class="rng-v" for="${id}">${value} km</output>
    ${note ? `<span class="rng-note">${E(note)}</span>` : ''}
  </div>`;
}
