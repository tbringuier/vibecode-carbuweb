// Carbu'Web — app.js (2026) — ES module entry point

import { state, LS, REFRESH_MS, radius, maxAge } from './js/state.js';
import { E } from './js/helpers.js';
import { switchTab, goBack, goHome, handleHeaderFav, initPopstate, syncHeaderFav } from './js/navigation.js';
import { toggleSettings, debouncedSave, resetAll, dismissOnboard, refreshData, syncFooter, changeMaxAge } from './js/settings.js';
import { geolocateMe, findNear, applySort } from './js/geolocation.js';
import { debouncedSearch, renderHomeTeaser, jumpToExplorer } from './js/search.js';
import { searchGeo } from './js/geo-zones.js';
import { showStation } from './js/station.js';
import { populateFuels, populateRegions, updateDeptFilter, findCheapest, sortDash, toggleReg } from './js/explore.js';
import { toggleFavAddr, toggleFavStation, removeFav, adjFavR, findNearFav, showStationFav, renderFavs } from './js/favorites.js';
import { applyV, switchV, openVForm, closeVForm, saveVForm, delV, renderVBar, renderVList } from './js/vehicles.js';

Object.assign(window, {
  switchTab, goBack, goHome, handleHeaderFav, toggleSettings,
  debouncedSave, resetAll, dismissOnboard, geolocateMe,
  debouncedSearch, findNear, applySort, searchGeo, showStation,
  populateFuels, populateRegions, updateDeptFilter, findCheapest,
  sortDash, toggleReg, toggleFavAddr, toggleFavStation, removeFav,
  adjFavR, findNearFav, showStationFav, switchV, openVForm,
  closeVForm, saveVForm, delV, jumpToExplorer, changeMaxAge, syncHeaderFav
});

initPopstate();

// Clavier : Échap ferme les paramètres, Entrée/Espace activent les éléments role="button" générés par les templates.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = document.getElementById('settings-modal');
    if (m && !m.classList.contains('hidden')) { toggleSettings(); return; }
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLElement
    && e.target.tagName !== 'BUTTON' && e.target.getAttribute('role') === 'button') {
    e.preventDefault();
    e.target.click();
  }
});

// PWA remise au premier plan après une longue pause : rafraîchir sans attendre le prochain tick d'interval.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.db && Date.now() - state.lastFetch > REFRESH_MS) refreshData();
});

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById('rslider').value = radius;
  document.getElementById('rval').innerText = radius;
  document.getElementById('rslider').addEventListener('input', e => { document.getElementById('rval').innerText = e.target.value; debouncedSave(); });
  const ageR = document.querySelector(`input[name="maxAge"][value="${maxAge}"]`);
  if (ageR) ageR.checked = true;
  try {
    state.db = await (await fetch(`data.json?_=${Date.now()}`, { cache: 'no-store' })).json();
    state.lastFetch = Date.now();
    applyV(); renderVBar(); renderVList();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    if (localStorage.getItem(LS.w)) document.getElementById('onboard').classList.add('hidden');
    populateRegions(); populateFuels(); renderFavs(); renderHomeTeaser(); syncFooter();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => { state.geoReady = { lat: p.coords.latitude, lon: p.coords.longitude }; },
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    if ('caches' in window) caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
    state.refreshT = setInterval(refreshData, REFRESH_MS);
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div class="error-block notice"><b>Impossible de charger les données</b><span>${E(e.message || 'Erreur réseau')}</span><button type="button" class="btn btn-p btn-sm" onclick="location.reload()">Recharger</button></div>`;
  }
});
