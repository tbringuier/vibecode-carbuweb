// Carbu'Web — app.js : point d'entrée (module ES).
// Toutes les interactions passent par délégation d'événements : un élément porte
// data-act="…" (clic), data-change="…" (change) ou data-input="…" (saisie) et le nom
// est résolu dans les tables ci-dessous. Aucun gestionnaire inline, rien sur window.
import { state, prefs, setWelcomed } from './js/state.js';
import { $, E } from './js/helpers.js';
import { loadData } from './js/data.js';
import { go, back, render, rerender, registerViews, initRouter, share, TABS } from './js/navigation.js';
import { onFiltersChange, toggleFuel, allFuels, toggleVehicle, fuelChips } from './js/filters.js';
import { onSearchInput, clearSearch, doSearch, renderRecent, clearRecentList } from './js/search.js';
import { locateMe, primeGeo, renderNear, onRadiusInput, rerenderNearList } from './js/near.js';
import { renderZone } from './js/zone.js';
import { renderStation } from './js/station.js';
import { renderExplorer, onExploreChange, exploreFuel, sortDash, toggleReg, renderRanking } from './js/explore.js';
import { histSet, zoneToggleFuel } from './js/history.js';
import { renderFavs, toggleCurrent, togglePlace, removeFav, adjFavRadius, moveFav } from './js/favorites.js';
import { openVForm, closeVForm, saveVForm, delV, pickIcon, onVehiclesChange } from './js/vehicles.js';
import { openSettings, closeSettings, settingsOpen, trapFocus, onDefaultRadius, onMaxAge, onTheme, onDataSaver, applyTheme, exportData, importData, onImportFile, resetAll, refreshData, refreshEvery, scheduleRefresh, syncFooter } from './js/settings.js';
import { showMapNow } from './js/map.js';

applyTheme();

// ---------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------

function renderHome(tab) {
  for (const t of TABS) $(`pane-${t}`).classList.toggle('hidden', t !== tab);
  if (tab === 'recherche') {
    $('onboard').classList.toggle('hidden', prefs.welcomed);
    $('home-filters').innerHTML = fuelChips();
    if ($('sinput').value.trim()) doSearch(); else { $('sresults').innerHTML = ''; renderRecent(); }
  } else if (tab === 'explorer') renderExplorer();
  else renderFavs();
}
registerViews({ home: renderHome, station: renderStation, near: renderNear, zone: renderZone });

// Filtres carburants / véhicule : la vue courante est redessinée (défilement conservé).
onFiltersChange(() => rerender());
onVehiclesChange(() => rerender());

// ---------------------------------------------------------------------------
// Actions (délégation)
// ---------------------------------------------------------------------------

const d = el => el.dataset;
const CLICK = {
  'locate': () => locateMe(),
  'search-clear': () => clearSearch(),
  'recent-clear': () => clearRecentList(),
  'fuel': el => toggleFuel(d(el).fuel),
  'fuel-all': () => allFuels(),
  'vehicle': el => toggleVehicle(d(el).id),
  'more': el => {
    if (d(el).list === 'explore') { state.expLimit = (state.expLimit || 40) + 40; renderRanking(); }
    else { state.listLimit = (state.listLimit || 40) + 40; if (d(el).list === 'near') rerenderNearList(); else rerender(); }
  },
  'fav-current': () => toggleCurrent(),
  'fav-place': el => togglePlace(+d(el).lat, +d(el).lon, d(el).name),
  'fav-remove': el => removeFav(+d(el).i),
  'fav-radius': el => adjFavRadius(+d(el).i, +d(el).d),
  'share': () => share(),
  'back': () => back(),
  'show-map': el => showMapNow(d(el).map),
  'hist-fuel': el => histSet('fuel', d(el).fuel),
  'hist-period': el => histSet('period', d(el).period),
  'zone-fuel': el => zoneToggleFuel(d(el).fuel),
  'exp-fuel': el => exploreFuel(d(el).fuel),
  'dash-sort': el => sortDash(d(el).fuel),
  'reg-toggle': el => toggleReg(el),
  'settings': () => openSettings(),
  'settings-close': () => closeSettings(),
  'v-add': () => openVForm(),
  'v-edit': el => openVForm(d(el).id),
  'v-del': el => delV(d(el).id),
  'v-icon': el => pickIcon(el),
  'v-save': () => saveVForm(),
  'v-cancel': () => closeVForm(),
  'export': () => exportData(),
  'import': () => importData(),
  'reset': () => resetAll(),
  'refresh': () => refreshData({ manual: true }),
  'reload': () => location.reload(),
  'welcome-ok': () => { setWelcomed(); $('onboard').classList.add('hidden'); $('sinput').focus(); }
};
const CHANGE = {
  'sort': el => { state.sortFuel = el.value; state.listLimit = 0; if (state.route?.view === 'near') rerenderNearList(); else rerender(); },
  'exp': el => onExploreChange(el),
  'hist-gran': el => histSet('gran', el.value),
  'hist-cmp': el => histSet('cmp', el.checked),
  'max-age': el => onMaxAge(el),
  'theme': el => onTheme(el),
  'data-saver': el => onDataSaver(el),
  'import-file': el => onImportFile(el)
};
const INPUT = {
  'search': () => onSearchInput(),
  'radius': el => onRadiusInput(el),
  'default-radius': el => onDefaultRadius(el)
};

document.addEventListener('click', e => {
  // Liens internes (#…) : navigation applicative (historique, défilement restauré).
  const a = e.target.closest('a[href^="#"]');
  if (a?.classList.contains('skip-link')) { e.preventDefault(); $('mc').focus(); $('mc').scrollIntoView(); return; }
  if (a && !e.defaultPrevented && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (settingsOpen()) closeSettings();
    go(a.getAttribute('href') === '#' ? '#' : a.getAttribute('href'));
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = CLICK[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); CHANGE[el?.dataset.change]?.(el); });
document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); INPUT[el?.dataset.input]?.(el); });
// Fermer les paramètres en touchant le fond.
$('settings-modal').addEventListener('click', e => { if (e.target.classList.contains('dialog-backdrop')) closeSettings(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && settingsOpen()) { closeSettings(); return; }
  trapFocus(e);
  // Réordonner un favori au clavier : flèches haut/bas sur la poignée.
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.matches?.('#fav-list .fav-h')) {
    e.preventDefault();
    moveFav(+e.target.closest('[data-di]').dataset.di, e.key === 'ArrowUp' ? -1 : 1);
  }
  // « / » place le curseur dans la recherche (bureau).
  if (e.key === '/' && !e.target.closest('input, textarea, select') && state.route?.view === 'home' && state.route.tab === 'recherche') { e.preventDefault(); $('sinput').focus(); }
});
$('sinput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(state.searchT); doSearch(); } });

// Retour sur l'appli après une pause : revalider les prix (requête conditionnelle, ~0 octet si inchangés).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.db && Date.now() - state.lastFetch > refreshEvery()) refreshData();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'auto') { applyTheme(); rerender(); } });

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

initRouter();
(async () => {
  try {
    await loadData();
  } catch (e) {
    $('loading').innerHTML = `<div class="error-block notice"><b>Impossible de charger les prix</b><span>${E(e.message || 'Erreur réseau')}</span><button type="button" class="btn btn-p btn-sm" data-act="reload">Réessayer</button></div>`;
    return;
  }
  $('loading').classList.add('hidden');
  syncFooter();
  render();
  primeGeo();
  scheduleRefresh();
  // Anciennes versions : un service worker de cache a existé, s'assurer qu'il a disparu.
  navigator.serviceWorker?.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
})();
