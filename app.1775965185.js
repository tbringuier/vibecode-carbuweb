import { state, LS, REFRESH_MS, radius } from './js/state.js';
import { E } from './js/helpers.js';
import { switchTab, goBack, goHome, handleHeaderFav, initPopstate } from './js/navigation.js';
import { toggleSettings, debouncedSave, resetAll, dismissOnboard, refreshData, syncFooter } from './js/settings.js';
import { geolocateMe, findNear, applySort } from './js/geolocation.js';
import { debouncedSearch } from './js/search.js';
import { searchGeo } from './js/geo-zones.js';
import { showStation } from './js/station.js';
import { populateFuels, populateRegions, updateDeptFilter, findCheapest, sortDash, toggleReg, renderExploreMap, renderDash } from './js/explore.js';
import { toggleFavAddr, toggleFavStation, removeFav, adjFavR, findNearFav, showStationFav, renderFavs } from './js/favorites.js';
import { applyV, switchV, openVForm, closeVForm, saveVForm, delV, renderVBar, renderVList } from './js/vehicles.js';
Object.assign(window, {
  switchTab, goBack, goHome, handleHeaderFav, toggleSettings,
  debouncedSave, resetAll, dismissOnboard, geolocateMe,
  debouncedSearch, findNear, applySort, searchGeo, showStation,
  populateFuels, populateRegions, updateDeptFilter, findCheapest,
  sortDash, toggleReg, toggleFavAddr, toggleFavStation, removeFav,
  adjFavR, findNearFav, showStationFav, switchV, openVForm,
  closeVForm, saveVForm, delV
});
initPopstate();
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById('rslider').value = radius;
  document.getElementById('rval').innerText = radius;
  document.getElementById('rslider').addEventListener('input', e => { document.getElementById('rval').innerText = e.target.value; debouncedSave(); });
  try {
    state.db = await (await fetch(`data.json?_=${Date.now()}`, { cache: 'no-store' })).json();
    applyV(); renderVBar(); renderVList();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    if (localStorage.getItem(LS.w) || localStorage.getItem(LS.f) || localStorage.getItem(LS.v)) document.getElementById('onboard').classList.add('hidden');
    populateRegions(); populateFuels(); renderFavs(); syncFooter();
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    if ('caches' in window) caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
    state.refreshT = setInterval(refreshData, REFRESH_MS);
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div class="notice" style="max-width:20rem;margin:2rem auto"><b>Impossible de charger les données</b><span>${E(e.message)}</span><br><button class="btn btn-p btn-sm" onclick="location.reload()" style="margin-top:.5rem">Recharger</button></div>`;
  }
});