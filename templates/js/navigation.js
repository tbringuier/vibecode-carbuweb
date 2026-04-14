import { state, favs } from './state.js';
import { coord } from './helpers.js';
import { renderFavs, favKey, toggleFavAddr } from './favorites.js';
import { renderExploreMap, renderDash, findCheapest } from './explore.js';
import { findNear } from './geolocation.js';
import { searchGeo } from './geo-zones.js';

export function switchTab(tab) {
  const sv = document.getElementById('station-view');
  if (sv && !sv.classList.contains('hidden')) goHome();
  document.getElementById('home-view')?.classList.toggle('fav-tab', tab === 'favoris');
  ['recherche', 'explorer', 'favoris'].forEach(t => {
    document.getElementById(`tab-${t}`)?.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    const p = document.getElementById(`pane-${t}`);
    if (p) { if (t === tab) p.classList.remove('hidden'); else p.classList.add('hidden'); }
  });
  ['recherche', 'explorer', 'favoris'].forEach(t => document.getElementById(`bn-${t}`)?.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
  if (tab === 'explorer') { renderExploreMap(); findCheapest(); renderDash(); }
}

export function pushNav(s) { if (state.isRestoring) return; state.navStack.push(s); history.pushState({ idx: state.navStack.length }, ''); }

export function goHome() {
  state.navStack = []; state.proxSearch = null; state.detailAnchor = null; state.geoZone = null;
  document.getElementById('station-view').classList.add('hidden');
  document.getElementById('station-view').removeAttribute('data-sid');
  document.getElementById('home-view').classList.remove('hidden');
  document.getElementById('btn-fav-header').hidden = true;
  renderFavs();
}

export function goBack() { if (state.navStack.length) history.back(); else goHome(); }

export function initPopstate() {
  window.addEventListener('popstate', () => {
    if (!state.navStack.length) { goHome(); return; }
    const p = state.navStack.pop(); state.isRestoring = true;
    try {
      if (p.type === 'prox') findNear(p.lat, p.lon, p.label);
      else if (p.type === 'geo') searchGeo(p.gType, p.name);
      else goHome();
    } finally {
      state.isRestoring = false;
    }
  });
}

export function handleHeaderFav() {
  if (!state.proxSearch) return;
  const a = coord(state.proxSearch.lat), o = coord(state.proxSearch.lon);
  if (Number.isFinite(a) && Number.isFinite(o)) { toggleFavAddr(a, o, state.proxSearch.label || 'Lieu'); syncHeaderFav(); }
}

const STAR_SVG_FILLED = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const STAR_SVG_EMPTY = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

export function syncHeaderFav() {
  const btn = document.getElementById('btn-fav-header');
  if (!btn) return;
  const sv = document.getElementById('station-view');
  const sid = sv?.getAttribute('data-sid');
  if (sid) { btn.hidden = true; return; }
  if (state.proxSearch) {
    const a = coord(state.proxSearch.lat), o = coord(state.proxSearch.lon);
    if (Number.isFinite(a) && Number.isFinite(o)) {
      btn.hidden = false;
      const k = favKey(a, o), is = k && favs.some(f => f.type === 'address' && favKey(f.lat, f.lon) === k);
      btn.innerHTML = is ? STAR_SVG_FILLED : STAR_SVG_EMPTY;
      btn.classList.toggle('btn-star-on', !!is);
      btn.setAttribute('aria-label', is ? 'Retirer ce lieu des favoris' : 'Ajouter ce lieu aux favoris');
      return;
    }
  }
  btn.hidden = true;
}
