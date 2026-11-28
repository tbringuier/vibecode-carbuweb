import { prefs, setNavApp, NAV_APPS } from './state.js?v=1795897500';
import { $, E, ICON, toast } from './helpers.js?v=1795897500';
import { station } from './data.js?v=1795897500';
import { openDialog, closeDialog } from './dialog.js?v=1795897500';
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isApple = /iPhone|iPad|iPod|Macintosh/.test(UA);
const isAndroid = /Android/.test(UA);
export const APPS = {
  waze: { name: 'Waze', url: (lat, lon) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes` },
  gmaps: { name: 'Google Maps', url: (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving` },
  apple: { name: 'Apple Plans', url: (lat, lon) => `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d` },
  geo: { name: 'Autre application GPS', url: (lat, lon, label) => `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label || 'Station')})` }
};
export const availableApps = () => [...(isApple ? ['apple', 'waze', 'gmaps'] : ['waze', 'gmaps', 'apple']), ...(isAndroid ? ['geo'] : [])].filter(a => NAV_APPS.includes(a));
const savedApp = () => (prefs.navApp !== 'ask' && availableApps().includes(prefs.navApp) ? prefs.navApp : null);
const appLink = (app, s, cls, inner) => `<a class="${cls}" href="${E(APPS[app].url(s.lat, s.lon, s.name))}"${app === 'geo' ? '' : ' target="_blank" rel="noopener"'} data-act="go-app" data-app="${app}">${inner}</a>`;
export function goButton(s, size = '') {
  const app = savedApp();
  const inner = app
    ? `<span class="go-split">${appLink(app, s, `btn btn-p${size}`, `${ICON.route} Y aller <span class="go-with">· ${E(APPS[app].name)}</span>`)}<button type="button" class="btn btn-p${size} go-more" data-act="go" data-id="${E(s.id)}" aria-label="Choisir une autre application de navigation" title="Autre application">▾</button></span>`
    : `<button type="button" class="btn btn-p${size}" data-act="go" data-id="${E(s.id)}">${ICON.route} Y aller</button>`;
  return `<span class="go-wrap" data-go-id="${E(s.id)}" data-go-size="${size}">${inner}</span>`;
}
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