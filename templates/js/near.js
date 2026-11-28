// near.js — Géolocalisation et écran « stations autour d'un point » (#p/lat,lon/nom).
import { state, prefs, pushRecent, setRadius, saveFavs, favKey } from './state.js';
import { $, E, notice, loader, crowKm, plural } from './helpers.js';
import { within } from './prices.js';
import { fuelChips, radiusControl } from './filters.js';
import { sortFuelFor, sortItems, sortSelect, listHtml, bestBand, markersFor } from './lists.js';
import { mapSlot, renderMap } from './map.js';
import { go, nearHash, setHeader, starBtn, shareBtn } from './navigation.js';

const ME = 'Ma position';
const GEO_MAX_AGE = 5 * 60 * 1000;

// Demande la position (boot : silencieuse, pour proposer « autour de moi » sans attendre).
export function primeGeo() {
  if (!navigator.geolocation || !navigator.permissions) return;
  navigator.permissions.query({ name: 'geolocation' }).then(p => {
    if (p.state !== 'granted') return;
    navigator.geolocation.getCurrentPosition(pos => { state.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: Date.now() }; }, () => {}, { timeout: 8000, maximumAge: GEO_MAX_AGE });
  }).catch(() => {});
}

let locateReq = 0;
export function locateMe() {
  const out = $('sresults');
  const req = ++locateReq;
  // Une position obtenue tard ne doit pas arracher l'utilisateur à l'écran qu'il a ouvert entre-temps.
  const still = () => req === locateReq && state.route?.view === 'home' && state.route.tab === 'recherche';
  if (!navigator.geolocation) { out.innerHTML = notice('Géolocalisation non disponible', 'Votre navigateur ne permet pas d’obtenir votre position : cherchez une ville ou un code postal.'); return; }
  if (state.geo && Date.now() - state.geo.t < GEO_MAX_AGE) { go(nearHash(state.geo.lat, state.geo.lon, ME)); return; }
  out.innerHTML = loader('Localisation en cours…');
  navigator.geolocation.getCurrentPosition(
    p => { state.geo = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }; if (!still()) return; out.innerHTML = ''; go(nearHash(state.geo.lat, state.geo.lon, ME)); },
    err => {
      if (!still()) return;
      const msg = err?.code === 1
        ? 'L’accès à la position a été refusé. Autorisez-le dans les réglages du navigateur, ou cherchez une ville.'
        : 'Position introuvable pour le moment. Réessayez, ou cherchez une ville ou un code postal.';
      out.innerHTML = notice('Position non disponible', E(msg));
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
  );
}

// Favori « lieu » au même endroit : son rayon personnalisé s'applique.
const placeFav = r => prefs.favs.find(f => f.type === 'address' && f.id === favKey(r.lat, r.lon));
const radiusOf = r => placeFav(r)?.radius ?? prefs.radius;

export function renderNear(r) {
  const fav = placeFav(r), radius = radiusOf(r);
  state.origin = { lat: r.lat, lon: r.lon, label: r.label };
  if (r.label !== ME) pushRecent({ t: 'p', lat: r.lat, lon: r.lon, label: r.label });
  setHeader(r.label, `Stations à ${radius} km (route)`, starBtn(!!fav, 'ce lieu') + shareBtn());
  const fuel = sortFuelFor(true);
  $('d-body').innerHTML = `<div class="toolbar card">
      ${fuelChips()}
      <div class="toolbar-row">
        ${radiusControl('near-r', radius, fav?.radius ? 'favori' : '')}
        <div class="sort-w">${sortSelect('near-sort', fuel, true)}</div>
      </div>
    </div>
    <div class="split">
      <div class="split-side">${mapSlot('near-map', 'd-map d-map-sticky')}</div>
      <div class="split-main" id="near-results" aria-live="polite"></div>
    </div>`;
  renderNearResults(r);
}

function renderNearResults(r) {
  const radius = radiusOf(r), km = crowKm(radius);
  const fuel = sortFuelFor(true);
  const all = within(r.lat, r.lon, km);
  const items = sortItems(all, fuel);
  const box = $('near-results'); if (!box) return;
  const empty = notice('Aucune station dans ce rayon', fuel ? `Aucune station ne propose ${E(fuel)} à moins de ${radius} km. Élargissez le rayon ci-dessus.` : 'Élargissez le rayon ci-dessus.');
  box.innerHTML = `${bestBand(all)}
    <div class="list-h"><h2 class="sec-l">${fuel ? `Classées par prix ${E(fuel)}` : 'Classées par distance'}</h2><span class="count">${plural(items.length, 'station', 'stations')}</span></div>
    ${listHtml(items, fuel, { key: 'near', empty })}`;
  renderMap('near-map', markersFor(items, fuel), { center: { lat: r.lat, lon: r.lon, label: r.label, radiusKm: km } });
}

// Curseur de rayon : libellé immédiat, liste recalculée après une courte pause.
let radiusT = null;
export function onRadiusInput(el) {
  const v = +el.value;
  const out = $(`${el.id}-v`); if (out) out.textContent = `${v} km`;
  clearTimeout(radiusT);
  radiusT = setTimeout(() => {
    const r = state.route; if (r?.view !== 'near') return;
    const fav = placeFav(r);
    if (fav?.radius) { fav.radius = v; saveFavs(); } else setRadius(v);
    state.listLimit = 0;
    $('d-sub').textContent = `Stations à ${v} km (route)`;
    renderNearResults(r);
  }, 220);
}

export function rerenderNearList() { if (state.route?.view === 'near') renderNearResults(state.route); }
