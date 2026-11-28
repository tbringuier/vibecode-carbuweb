// directions.js — « Y aller » : ouvre l'itinéraire dans Waze, Google Maps, Apple Plans ou l'application GPS
// par défaut (Android). Omnicanal : Waze, Google Maps et Apple Plans sont proposés sur tous les appareils
// (application installée ou version web), dans un ordre adapté à l'appareil. Le choix peut être mémorisé.
import { prefs, setNavApp, NAV_APPS } from './state.js';
import { $, E, ICON, toast } from './helpers.js';
import { station } from './data.js';
import { openDialog, closeDialog } from './dialog.js';

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isApple = /iPhone|iPad|iPod|Macintosh/.test(UA);
const isAndroid = /Android/.test(UA);

export const APPS = {
  waze: { name: 'Waze', url: (lat, lon) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes` },
  gmaps: { name: 'Google Maps', url: (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving` },
  apple: { name: 'Apple Plans', url: (lat, lon) => `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d` },
  geo: { name: 'Autre application GPS', url: (lat, lon, label) => `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label || 'Station')})` }
};
// Apple Plans en premier sur iPhone / iPad / Mac ; « Autre application GPS » (lien geo:) seulement sur
// Android, le seul système qui le confie à l'application de navigation choisie par l'utilisateur.
export const availableApps = () => [...(isApple ? ['apple', 'waze', 'gmaps'] : ['waze', 'gmaps', 'apple']), ...(isAndroid ? ['geo'] : [])].filter(a => NAV_APPS.includes(a));
const savedApp = () => (prefs.navApp !== 'ask' && availableApps().includes(prefs.navApp) ? prefs.navApp : null);

// Lien vers une application (s'ouvre hors de Carbu'Web ; geo: reste dans l'onglet pour déclencher l'appli).
const appLink = (app, s, cls, inner) => `<a class="${cls}" href="${E(APPS[app].url(s.lat, s.lon, s.name))}"${app === 'geo' ? '' : ' target="_blank" rel="noopener"'} data-act="go-app" data-app="${app}">${inner}</a>`;

// Bouton « Y aller » d'une station : direct si une application est mémorisée, sinon choix.
export function goButton(s, size = '') {
  const app = savedApp();
  const inner = app
    ? `<span class="go-split">${appLink(app, s, `btn btn-p${size}`, `${ICON.route} Y aller <span class="go-with">· ${E(APPS[app].name)}</span>`)}<button type="button" class="btn btn-p${size} go-more" data-act="go" data-id="${E(s.id)}" aria-label="Choisir une autre application de navigation" title="Autre application">▾</button></span>`
    : `<button type="button" class="btn btn-p${size}" data-act="go" data-id="${E(s.id)}">${ICON.route} Y aller</button>`;
  return `<span class="go-wrap" data-go-id="${E(s.id)}" data-go-size="${size}">${inner}</span>`;
}

// Redessine les boutons visibles après un changement d'application mémorisée.
export function refreshGoButtons() {
  document.querySelectorAll('.go-wrap[data-go-id]').forEach(w => {
    const s = station(w.dataset.goId);
    if (s) w.outerHTML = goButton(s, w.dataset.goSize || '');
  });
}

export function openGoSheet(id) {
  const s = station(id);
  if (!s) return;
  const saved = savedApp();
  $('go-body').dataset.id = s.id;
  $('go-body').innerHTML = `<p class="go-dest"><b>${E(s.name)}</b><span>${E(s.addr)}${s.addr ? ', ' : ''}${E(s.cp)} ${E(s.city)}</span></p>
    <div class="go-apps">${availableApps().map(a => appLink(a, s, `go-app${a === saved ? ' is-saved' : ''}`, `<span class="go-ico go-ico-${a}" aria-hidden="true">${ICON.route}</span><span>${E(APPS[a].name)}</span>${a === saved ? '<span class="go-tag">par défaut</span>' : ''}${ICON.chev}`)).join('')}</div>
    <label class="hist-toggle"><input type="checkbox" id="go-remember"> <span>Toujours ouvrir l’application choisie</span></label>
    <p class="m-sec-desc">${saved ? `Actuellement : ${E(APPS[saved].name)} par défaut. ` : ''}Modifiable à tout moment dans Réglages.</p>`;
  openDialog('go-sheet');
}

// Clic sur une application : mémoriser si demandé (ou garder le choix existant), puis laisser le lien s'ouvrir.
// Case non cochée = choix ponctuel : la préférence existante n'est pas modifiée.
export function onGoApp(el) {
  if (!el.closest('#go-sheet')) return;
  const app = el.dataset.app;
  const id = $('go-body').dataset.id;
  if ($('go-remember')?.checked && prefs.navApp !== app) {
    setNavApp(app);
    toast(`${APPS[app].name} s’ouvrira directement la prochaine fois`);
    refreshGoButtons();
  }
  closeDialog('go-sheet', document.querySelector(`.go-wrap[data-go-id="${CSS.escape(id)}"] a, .go-wrap[data-go-id="${CSS.escape(id)}"] button`));
}
