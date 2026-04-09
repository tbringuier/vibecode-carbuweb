import { E } from './helpers.js';

export function freshDays(entry) {
  if (!entry) return null;
  const iso = entry.maj_iso || entry.date_maj;
  if (!iso) return null;
  let d;
  try { d = entry.maj_iso ? new Date(entry.maj_iso) : new Date(iso + 'T12:00:00'); } catch (e) { return null; }
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
export function freshPill(entry) {
  const d = freshDays(entry);
  if (d === null) return '<span class="fresh-pill old">?</span>';
  if (d > 30) return '<span class="fresh-pill old">&gt;1 mois</span>';
  if (d > 14) return `<span class="fresh-pill old">${d}j</span>`;
  if (d > 7) return `<span class="fresh-pill warn">${d}j</span>`;
  if (d === 0) return '<span class="fresh-pill fresh">Auj.</span>';
  if (d === 1) return '<span class="fresh-pill fresh">Hier</span>';
  return '';
}
export function freshLabel(entry) {
  const d = freshDays(entry);
  if (d === null) return 'Date inconnue';
  if (d > 30) return 'Plus d\'un mois';
  if (d > 14) return `Il y a ${d} jours`;
  if (d > 7) return `Il y a ${d} jours`;
  if (d > 1) return `Il y a ${d} jours`;
  if (d === 1) return 'Hier';
  return 'Aujourd\'hui';
}
export function majHtml(entry) {
  if (!entry) return '';
  if (entry.maj_iso) { try { const d = new Date(entry.maj_iso); if (!isNaN(d.getTime())) return E(d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })); } catch (e) { } }
  return entry.date_maj ? E(entry.date_maj) : '';
}
