// freshness.js — Ancienneté des prix : filtre (préférence maxAge), badges et libellés.
// Seuils : < 7 j aucun badge · 7–14 j ambre · 15–29 j rouge · ≥ 30 j rouge « > 1 mois ».
import { prefs } from './state.js';
import { ago, DAY_MS } from './helpers.js';

export const freshDays = e => (e && Number.isFinite(e.t) ? Math.floor((Date.now() - e.t) / DAY_MS) : null);
// Un prix est masqué s'il a plus de `maxAge` jours révolus (0 = jamais masqué).
export function isExpired(e, maxAge = prefs.maxAge) {
  if (!maxAge || maxAge <= 0) return false;
  const d = freshDays(e);
  return d === null || d > maxAge;
}
// Prix visible (présent et assez récent) d'un carburant pour une station.
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
// Libellé lisible : « mis à jour il y a 3 h » / « … le 12/11 à 08:15 ».
export function freshText(e) {
  if (!e || !Number.isFinite(e.t)) return 'date inconnue';
  const d = new Date(e.t);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const days = freshDays(e);
  if (days < 2) return `${ago(e.t)} · ${hm}`;
  return `${ago(e.t)} · ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })}`;
}
export const freshCls = e => { const d = freshDays(e); return d === null || d >= 15 ? 'old' : d >= 7 ? 'warn' : ''; };
