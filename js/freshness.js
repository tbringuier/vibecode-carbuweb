import { prefs } from './state.js?v=1795897500';
import { ago, DAY_MS } from './helpers.js?v=1795897500';
export const freshDays = e => (e && Number.isFinite(e.t) ? Math.floor((Date.now() - e.t) / DAY_MS) : null);
export function isExpired(e, maxAge = prefs.maxAge) {
  if (!maxAge || maxAge <= 0) return false;
  const d = freshDays(e);
  return d === null || d > maxAge;
}
export const visiblePrice = (s, f) => { const e = s?.fuels?.[f]; return e && !isExpired(e) ? e : null; };
export const hasVisibleFuel = (s, fuels) => fuels.some(f => visiblePrice(s, f));
export function freshBadge(e) {
  const d = freshDays(e);
  if (d === null) return '<span class="fresh old">?</span>';
  if (d >= 30) return '<span class="fresh old">&gt;1 mois</span>';
  if (d >= 15) return `<span class="fresh old">${d} j</span>`;
  if (d >= 7) return `<span class="fresh warn">${d} j</span>`;
  return '';
}
export const freshText = e => (e && Number.isFinite(e.t) ? ago(e.t) : 'date inconnue');
export const freshCls = e => { const d = freshDays(e); return d === null || d >= 15 ? 'old' : d >= 7 ? 'warn' : ''; };