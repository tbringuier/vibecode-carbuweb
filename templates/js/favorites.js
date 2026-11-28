// favorites.js — Favoris : lieux (meilleurs prix dans un rayon) et stations (prix suivis).
// Réordonnables (glisser la poignée, ou flèches ↑/↓ au clavier) ; suppression annulable.
import { state, prefs, saveFavs, favKey, RADIUS_MIN, RADIUS_MAX } from './state.js';
import { $, E, ICON, fmtEur, fmtKm, crowKm, toast, notice } from './helpers.js';
import { station } from './data.js';
import { within, pickBest, ptag, tankTxt } from './prices.js';
import { openBadge } from './hours.js';
import { fuelChips } from './filters.js';
import { TouchDragReorder } from './drag-drop.js';
import { nearHash, stationHash, starBtn } from './navigation.js';

export function isPlaceFav(lat, lon) { const k = favKey(lat, lon); return prefs.favs.some(f => f.type === 'address' && f.id === k); }
export const isStationFav = id => prefs.favs.some(f => f.type === 'station' && f.id === id);

function removeAt(i, label) {
  const [old] = prefs.favs.splice(i, 1);
  saveFavs();
  toast(`${label} retiré des favoris`, { label: 'Annuler', fn: () => { prefs.favs.splice(Math.min(i, prefs.favs.length), 0, old); saveFavs(); afterChange(); } });
}
function afterChange() {
  syncFavButtons();
  if (state.route?.view === 'home' && state.route.tab === 'favoris') renderFavs();
}

export function togglePlace(lat, lon, name) {
  const k = favKey(lat, lon), i = prefs.favs.findIndex(f => f.type === 'address' && f.id === k);
  if (i > -1) removeAt(i, 'Lieu');
  else { prefs.favs.push({ type: 'address', id: k, name: name || 'Lieu', lat: +(+lat).toFixed(5), lon: +(+lon).toFixed(5) }); saveFavs(); toast('Lieu ajouté aux favoris'); }
  afterChange();
}
export function toggleStation(id) {
  const s = station(id);
  const i = prefs.favs.findIndex(f => f.type === 'station' && f.id === id);
  if (i > -1) removeAt(i, 'Station');
  else if (s) { prefs.favs.push({ type: 'station', id, name: s.name, adresse: `${s.addr}, ${s.city}` }); saveFavs(); toast('Station ajoutée aux favoris'); }
  afterChange();
}
// Étoile de l'en-tête (et bouton de la fiche) : agit sur l'écran affiché.
export function toggleCurrent() {
  const r = state.route;
  if (r?.view === 'station') toggleStation(r.id);
  else if (r?.view === 'near') togglePlace(r.lat, r.lon, r.label);
}
export function removeFav(i) { const f = prefs.favs[i]; if (f) { removeAt(i, f.type === 'station' ? 'Station' : 'Lieu'); afterChange(); } }

// Met à jour les étoiles visibles sans redessiner la page (carte et graphique conservés).
export function syncFavButtons() {
  const r = state.route;
  let on = null, label = '';
  if (r?.view === 'station') { on = isStationFav(r.id); label = 'cette station'; }
  else if (r?.view === 'near') { on = isPlaceFav(r.lat, r.lon); label = 'ce lieu'; }
  if (on !== null) {
    const head = document.querySelector('#d-actions [data-act="fav-current"]');
    if (head) head.outerHTML = starBtn(on, label);
    document.querySelectorAll('#d-body [data-act="fav-current"]').forEach(b => {
      b.classList.toggle('btn-star-on', on); b.setAttribute('aria-pressed', String(on));
      b.innerHTML = `${on ? ICON.star : ICON.starO} ${on ? 'Dans vos favoris' : 'Ajouter aux favoris'}`;
    });
  }
  document.querySelectorAll('[data-act="fav-place"]').forEach(b => {
    const v = isPlaceFav(b.dataset.lat, b.dataset.lon);
    b.classList.toggle('btn-star-on', v); b.setAttribute('aria-pressed', String(v)); b.innerHTML = v ? ICON.star : ICON.starO;
    b.setAttribute('aria-label', `${v ? 'Retirer' : 'Ajouter'} ${b.dataset.name} ${v ? 'des' : 'aux'} favoris`);
  });
}

export function adjFavRadius(i, delta) {
  const f = prefs.favs[i]; if (!f || f.type !== 'address') return;
  f.radius = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, (f.radius || prefs.radius) + delta));
  saveFavs(); renderFavs();
}
export function moveFav(i, dir) {
  const j = i + dir; if (j < 0 || j >= prefs.favs.length) return;
  const [it] = prefs.favs.splice(i, 1); prefs.favs.splice(j, 0, it); saveFavs(); renderFavs();
  document.querySelector(`.fav[data-di="${j}"] .fav-h`)?.focus();
}

export function renderFavs() {
  $('fav-filters').innerHTML = prefs.favs.length ? fuelChips() : '';
  const list = $('fav-list');
  state.favDnD?.destroy(); state.favDnD = null;
  if (!prefs.favs.length) {
    list.innerHTML = `<div class="empty"><span class="empty-ico" aria-hidden="true">${ICON.star}</span><p class="empty-t">Aucun favori pour l’instant</p><p class="empty-d">Touchez l’étoile ${ICON.starO} d’une station ou d’un lieu pour le retrouver ici en un geste, avec ses prix à jour.</p><a class="btn btn-p btn-sm" href="#">Rechercher une station</a></div>`;
    return;
  }
  list.innerHTML = prefs.favs.map((f, i) => (f.type === 'station' ? stationCard(f, i) : placeCard(f, i))).join('')
    + (prefs.favs.length > 1 ? '<p class="fav-tip">Astuce : maintenez la poignée ⠿ pour réordonner vos favoris.</p>' : '');
  if (prefs.favs.length > 1) state.favDnD = new TouchDragReorder(list, { onReorder: (from, to) => { const [it] = prefs.favs.splice(from, 1); prefs.favs.splice(to, 0, it); saveFavs(); renderFavs(); } });
}

const handle = (i, name) => `<button type="button" class="fav-h" data-di-h="${i}" aria-label="Déplacer ${E(name)} (flèches haut et bas)" title="Glisser pour réordonner">${ICON.drag}</button>`;
const removeBtn = (i, name) => `<button type="button" class="btn btn-g btn-i btn-sm fav-r" data-act="fav-remove" data-i="${i}" aria-label="Retirer ${E(name)} des favoris" title="Retirer">${ICON.close}</button>`;

function stationCard(f, i) {
  const s = station(f.id);
  if (!s) {
    return `<article class="fav fav-off" data-di="${i}"><div class="fav-top">${handle(i, f.name)}<span class="fav-name">${E(f.name || 'Station')}</span>${removeBtn(i, f.name)}</div><p class="fav-sub">${E(f.adresse)}</p>${notice('Absente des données du jour', 'Elle réapparaîtra automatiquement si la source officielle la republie.', 'notice-sm')}</article>`;
  }
  const tags = prefs.fuels.map(fu => ptag(s, fu)).filter(Boolean).join('');
  return `<article class="fav" data-di="${i}">
    <div class="fav-top">${handle(i, s.name)}<a class="fav-name" href="${stationHash(s.id)}"><span class="fav-kind" aria-hidden="true">⛽</span>${E(s.name)}</a>${openBadge(s)}${removeBtn(i, s.name)}</div>
    <p class="fav-sub">${E(s.addr)}, ${E(s.cp)} ${E(s.city)}</p>
    <a class="fav-prices" href="${stationHash(s.id)}" aria-label="Voir la fiche de ${E(s.name)}">${tags || '<span class="u-text-muted">Aucun des carburants choisis ici.</span>'}<span class="fav-go">Fiche ${ICON.chev}</span></a>
  </article>`;
}

function placeCard(f, i) {
  const r = f.radius || prefs.radius;
  const near = within(f.lat, f.lon, crowKm(r));
  const cards = prefs.fuels.map(fu => {
    const b = pickBest(near, fu);
    if (!b) return '';
    const t = tankTxt(b.p);
    return `<a class="best-c" href="${stationHash(b.s.id)}"><span class="best-f"><span class="sw sw-${fu.toLowerCase()}" aria-hidden="true"></span>${fu}</span><span class="best-v">${fmtEur(b.p)}</span><span class="best-n">${E(b.s.name)}</span><span class="best-d">${fmtKm(b.dist)}</span>${t ? `<span class="tank">plein ${t}</span>` : ''}</a>`;
  }).join('');
  return `<article class="fav" data-di="${i}">
    <div class="fav-top">${handle(i, f.name)}<a class="fav-name" href="${nearHash(f.lat, f.lon, f.name)}"><span class="fav-kind" aria-hidden="true">📍</span>${E(f.name)}</a>${removeBtn(i, f.name)}</div>
    ${cards ? `<p class="fav-sub">Meilleurs prix à ${r} km</p><div class="best-g">${cards}</div>` : `<p class="fav-sub">Aucune station avec les carburants choisis à ${r} km.</p>`}
    <div class="fav-foot">
      <div class="stepper" role="group" aria-label="Rayon de recherche de ${E(f.name)}">
        <button type="button" class="btn btn-i btn-sm" data-act="fav-radius" data-i="${i}" data-d="-5" aria-label="Réduire le rayon"${r <= RADIUS_MIN ? ' disabled' : ''}>−</button>
        <span class="stepper-v">${r} km</span>
        <button type="button" class="btn btn-i btn-sm" data-act="fav-radius" data-i="${i}" data-d="5" aria-label="Augmenter le rayon"${r >= RADIUS_MAX ? ' disabled' : ''}>+</button>
      </div>
      <a class="btn btn-p btn-sm" href="${nearHash(f.lat, f.lon, f.name)}">Voir toutes les stations ${ICON.chev}</a>
    </div>
  </article>`;
}
