const opened = [];  // pile : [{id, back}]
export function openDialog(id) {
  const m = document.getElementById(id);
  if (!m || !m.classList.contains('hidden')) return;
  opened.push({ id, back: document.activeElement });
  m.classList.remove('hidden');
  document.body.classList.add('modal-open');
  m.querySelector('.dialog-head button')?.focus();
}
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
export function trapFocus(e) {
  const id = topDialog();
  if (e.key !== 'Tab' || !id) return;
  const f = [...document.getElementById(id).querySelectorAll('button, [href], input, select, textarea')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}