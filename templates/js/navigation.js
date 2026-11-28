// navigation.js — Routeur par fragment d'URL : chaque écran a une adresse partageable,
// « retour » (bouton ou geste) restaure l'écran précédent et sa position de défilement.
//
//   #                      accueil (onglet Recherche)   #explorer · #favoris
//   #s/<id>                fiche station
//   #p/<lat>,<lon>/<nom>   stations autour d'un point
//   #z/r/<région>          stations d'une région      #z/d/<code>   d'un département
import { state } from './state.js';
import { $, E, ICON, toast } from './helpers.js';
import { destroyMap } from './map.js';

export const TABS = ['recherche', 'explorer', 'favoris'];
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };

export function parseHash(h = location.hash) {
  const [a, ...rest] = h.replace(/^#\/?/, '').split('/');
  if (a === 'explorer' || a === 'favoris') return { view: 'home', tab: a };
  if (a === 's' && rest[0]) return { view: 'station', id: dec(rest[0]) };
  if (a === 'p' && rest[0]) {
    const [lat, lon] = rest[0].split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { view: 'near', lat, lon, label: dec(rest.slice(1).join('/')) || 'Lieu' };
  }
  if (a === 'z' && (rest[0] === 'r' || rest[0] === 'd') && rest[1]) return { view: 'zone', kind: rest[0], key: dec(rest.slice(1).join('/')) };
  return { view: 'home', tab: 'recherche' };
}
export const stationHash = id => `#s/${encodeURIComponent(id)}`;
export const nearHash = (lat, lon, label) => `#p/${(+lat).toFixed(5)},${(+lon).toFixed(5)}/${encodeURIComponent(label || '')}`;
export const zoneHash = (kind, key) => `#z/${kind}/${encodeURIComponent(key)}`;

// Vues enregistrées par app.js (évite les imports circulaires) : {home(tab), station(r), near(r), zone(r)}.
let views = {};
export function registerViews(v) { views = v; }
// Appelé à chaque changement d'écran (lien, retour, geste, GPS) : ferme les fenêtres ouvertes.
let onLeave = () => {};
export function onScreenChange(fn) { onLeave = fn; }

let depth = history.state?.d || 0;
history.scrollRestoration = 'manual';

export function go(hash, { replace = false } = {}) {
  // Même écran (ex. « Rechercher » touché depuis l'accueil) : remonter en haut, sans empiler l'historique.
  if (!replace && JSON.stringify(parseHash(hash)) === JSON.stringify(parseHash())) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (replace) history.replaceState({ d: depth }, '', hash || location.pathname);
  else {
    history.replaceState({ ...(history.state || {}), d: depth, y: window.scrollY }, '');
    depth++;
    history.pushState({ d: depth }, '', hash);
  }
  render();
}
export function back() { if (depth > 0) history.back(); else go('#', { replace: true }); }
export function initRouter() {
  window.addEventListener('popstate', e => { depth = e.state?.d || 0; render({ scroll: e.state?.y ?? 0 }); });
}

let lastKey = '';
// Rend la route courante. `keep` : même écran redessiné (filtres changés) — garder le défilement.
export function render({ scroll = 0, keep = false } = {}) {
  if (!state.db) return;
  const r = parseHash();
  const key = JSON.stringify(r);
  if (key !== lastKey) { state.listLimit = 0; state.expLimit = 0; onLeave(); }
  const same = key === lastKey;
  lastKey = key;
  state.route = r;
  const y = keep || same ? window.scrollY : scroll;
  const home = r.view === 'home';
  $('home-view').classList.toggle('hidden', !home);
  $('detail-view').classList.toggle('hidden', home);
  Object.keys(state.maps).forEach(destroyMap);
  syncNav(home ? r.tab : null);
  if (home) { state.origin = null; views.home?.(r.tab); setTitle(''); }
  else {
    $('d-actions').innerHTML = '';
    $('d-sub').textContent = '';
    views[r.view]?.(r);
  }
  requestAnimationFrame(() => window.scrollTo(0, y));
}
export const rerender = () => render({ keep: true });

function syncNav(tab) {
  for (const t of TABS) {
    for (const el of [$(`tab-${t}`), $(`bn-${t}`)]) {
      if (!el) continue;
      if (t === tab) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
  }
}

// En-tête des écrans de détail.
export function setHeader(title, sub = '', actions = '') {
  $('d-title').textContent = title;
  $('d-sub').textContent = sub;
  $('d-actions').innerHTML = actions;
  setTitle(title);
}
export function setTitle(t) { document.title = t ? `${t} · Carbu'Web` : 'Carbu’Web — Prix des carburants en France'; }

export const starBtn = (on, label) => `<button type="button" class="btn btn-g btn-i${on ? ' btn-star-on' : ''}" data-act="fav-current" aria-pressed="${on}" aria-label="${on ? 'Retirer' : 'Ajouter'} ${E(label)} ${on ? 'des' : 'aux'} favoris" title="${on ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${on ? ICON.star : ICON.starO}</button>`;
export const shareBtn = () => `<button type="button" class="btn btn-g btn-i" data-act="share" aria-label="Partager cette page" title="Partager">${ICON.share}</button>`;

export async function share() {
  const url = location.href, title = document.title;
  try {
    if (navigator.share) { await navigator.share({ title, url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Lien copié');
  } catch (e) { if (e?.name !== 'AbortError') toast('Partage impossible'); }
}
