import { state, prefs, setRadius, setMaxAge, setTheme, setDataSaver, setNavApp, setMapStyle, exportPrefs, importPrefs, resetStorage, storageAvailable, REFRESH_MS } from './state.js?v=1795897500';
import { $, fmtInt, ago, toast, plural } from './helpers.js?v=1795897500';
import { loadData, invalidateDerived, stationCount } from './data.js?v=1795897500';
import { clearHistCache } from './history.js?v=1795897500';
import { renderVList, closeVForm } from './vehicles.js?v=1795897500';
import { rerender } from './navigation.js?v=1795897500';
import { openDialog, closeDialog, isOpen } from './dialog.js?v=1795897500';
import { availableApps, APPS, refreshGoButtons } from './directions.js?v=1795897500';
export function openSettings() { syncSettings(); renderVList(); openDialog('settings-modal'); }
export function closeSettings() { if (!isOpen('settings-modal')) return; closeVForm(); closeDialog('settings-modal'); }
function syncSettings() {
  $('rslider').value = prefs.radius;
  $('rval').textContent = `${prefs.radius} km`;
  document.querySelectorAll('input[name="maxAge"]').forEach(r => { r.checked = +r.value === prefs.maxAge; });
  document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = r.value === prefs.theme; });
  $('ds-toggle').checked = prefs.dataSaver;
  $('nav-opts').innerHTML = ['ask', ...availableApps()].map(a => `<label class="opt"><input type="radio" name="navApp" value="${a}" data-change="nav-app"${prefs.navApp === a || (a === 'ask' && !availableApps().includes(prefs.navApp)) ? ' checked' : ''}> ${a === 'ask' ? 'Me demander' : APPS[a].name}</label>`).join('');
  document.querySelectorAll('input[name="mapStyle"]').forEach(r => { r.checked = r.value === prefs.mapStyle; });
  const nf = prefs.favs.length, nv = prefs.vehicles.length, nr = prefs.recent.length;
  $('storage-info').innerHTML = storageAvailable()
    ? `Sur cet appareil : <b>${plural(nf, 'favori', 'favoris')}</b>, <b>${plural(nv, 'véhicule', 'véhicules')}</b>, ${plural(nr, 'élément récent', 'éléments récents')} et vos réglages. Rien n’est envoyé à un serveur et aucun cookie n’est utilisé.`
    : '<b>Stockage local indisponible</b> (navigation privée ?) : vos favoris et réglages ne seront pas conservés après fermeture.';
}
let radiusT = null;
export function onDefaultRadius(el) {
  $('rval').textContent = `${el.value} km`;
  clearTimeout(radiusT);
  radiusT = setTimeout(() => { setRadius(el.value); rerender(); }, 250);
}
export function onMaxAge(el) { setMaxAge(el.value); invalidateDerived('stats'); rerender(); }
export function onTheme(el) { setTheme(el.value); applyTheme(); rerender(); }
export function onNavApp(el) { setNavApp(el.value); refreshGoButtons(); }
export function onMapStyle(el) { setMapStyle(el.value); rerender(); }
export function onDataSaver(el) { setDataSaver(el.checked); scheduleRefresh(); rerender(); toast(el.checked ? 'Économie de données activée' : 'Économie de données désactivée'); }
export function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prefs.theme);
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#0b0d12' : '#ffffff'));
}
export function exportData() {
  const blob = new Blob([JSON.stringify(exportPrefs(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `carbuweb-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Sauvegarde téléchargée');
}
export function importData() { $('import-file').click(); }
export async function onImportFile(el) {
  const file = el.files?.[0]; el.value = '';
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('Fichier trop volumineux');
    const r = importPrefs(JSON.parse(await file.text()));
    applyTheme(); syncSettings(); renderVList(); rerender();
    toast(`Restauré : ${plural(r.favs, 'favori', 'favoris')}, ${plural(r.vehicles, 'véhicule', 'véhicules')}`);
  } catch (e) { toast(`Import impossible : ${e.message || 'fichier invalide'}`); }
}
export function resetAll() {
  if (!confirm('Effacer toutes les données de Carbu’Web sur cet appareil ?\n\nFavoris, véhicules, récents et réglages seront supprimés. Pensez à « Sauvegarder » avant si besoin.')) return;
  resetStorage();
  location.replace(location.pathname);
}
export async function refreshData({ manual = false } = {}) {
  if (!state.db) return;
  const btn = $('btn-refresh'); btn?.classList.add('is-busy');
  try {
    const changed = await loadData();
    if (changed) { clearHistCache(); rerender(); toast('Prix mis à jour'); }
    else if (manual) toast('Les prix sont déjà à jour');
    syncFooter();
  } catch (e) {
    console.warn('refresh', e);
    if (e.code === 'format') toast('Une nouvelle version de Carbu’Web est disponible', { label: 'Recharger', fn: () => location.reload() });
    else if (manual) toast('Connexion impossible, réessayez plus tard');
  } finally { btn?.classList.remove('is-busy'); }
}
export const refreshEvery = () => (prefs.dataSaver ? 2 * 3600 * 1000 : REFRESH_MS);
export function scheduleRefresh() {
  clearInterval(state.refreshT);
  state.refreshT = prefs.dataSaver ? null : setInterval(() => { if (!document.hidden) refreshData(); }, REFRESH_MS);
}
export function syncFooter() {
  const db = state.db; if (!db) return;
  $('ft-count').textContent = fmtInt(stationCount());
  const t = Date.parse(db.updated);
  const chip = $('data-age');
  if (chip && Number.isFinite(t)) {
    chip.textContent = `Prix mis à jour ${ago(t)}`;
    chip.title = `Dernier prix relevé : ${db.updatedLabel} — toucher pour vérifier les mises à jour`;
  }
  const ft = $('footer-fuel-data-datetime');
  if (ft && db.updatedLabel) { ft.textContent = db.updatedLabel; ft.setAttribute('datetime', db.updated); }
}