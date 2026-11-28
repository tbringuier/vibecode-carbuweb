// dialog.js — Fenêtres modales (<div role="dialog"> dans un conteneur .hidden) : ouverture,
// fermeture, focus piégé, retour du focus à l'élément d'origine. Utilisé par les réglages et « Y aller ».
const opened = [];  // pile : [{id, back}]

export function openDialog(id) {
  const m = document.getElementById(id);
  if (!m || !m.classList.contains('hidden')) return;
  opened.push({ id, back: document.activeElement });
  m.classList.remove('hidden');
  document.body.classList.add('modal-open');
  m.querySelector('.dialog-head button')?.focus();
}

// `focusEl` : élément à focaliser après fermeture (sinon l'élément d'origine, ou le contenu principal
// si celui-ci a été redessiné entre-temps).
export function closeDialog(id = opened[opened.length - 1]?.id, focusEl = null) {
  const i = opened.findIndex(o => o.id === id);
  if (i < 0) return;
  const [{ back }] = opened.splice(i, 1);
  document.getElementById(id)?.classList.add('hidden');
  if (!opened.length) document.body.classList.remove('modal-open');
  const target = [focusEl, back].find(el => el && document.contains(el));
  if (target) target.focus(); else document.getElementById('mc')?.focus({ preventScroll: true });
}

export const topDialog = () => opened[opened.length - 1]?.id || null;
export const isOpen = id => opened.some(o => o.id === id);

// Garde le focus clavier dans la fenêtre du dessus (Tab / Maj+Tab).
export function trapFocus(e) {
  const id = topDialog();
  if (e.key !== 'Tab' || !id) return;
  const f = [...document.getElementById(id).querySelectorAll('button, [href], input, select, textarea')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
