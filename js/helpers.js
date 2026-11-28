import { ROUTE_F, state } from './state.js?v=1795897500';
export const E = s => (s == null || s === '' ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
export const norm = t => (t ? String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-'’]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim() : '');
const NF_P = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const NF_1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF_2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF_I = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const NBSP = ' ';
export const fmtInt = n => (Number.isFinite(+n) ? NF_I.format(Math.trunc(+n)) : '');
export const fmtP = v => { const n = +v; return Number.isFinite(n) ? NF_P.format(n) : '—'; };
export const fmtEur = v => fmtP(v) + NBSP + '€';
export const fmtEur2 = v => (Number.isFinite(+v) ? NF_2.format(+v) + NBSP + '€' : '—');
export function fmtCts(d) {
  const c = Math.round(d * 1000) / 10;
  if (Math.abs(c) < 0.05) return '=' + NBSP + '0' + NBSP + 'ct';
  return (c > 0 ? '+' : '−') + NF_1.format(Math.abs(c)) + NBSP + 'ct';
}
export const fmtPct = r => (r > 0 ? '+' : r < 0 ? '−' : '') + NF_1.format(Math.abs(r * 100)) + NBSP + '%';
export const fmtKm = k => '~' + NF_1.format(Math.round(k * ROUTE_F * 10) / 10) + NBSP + 'km';
export const plural = (n, one, many) => `${fmtInt(n)}${NBSP}${n > 1 ? many : one}`;
export const DAY_MS = 86400000;
export const todayDay = () => { const n = new Date(); return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS); };
export const fmtDay = (d, o) => new Date(d * DAY_MS).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
export const longDay = d => fmtDay(d, { day: 'numeric', month: 'long', year: 'numeric' });
export const shortDay = d => fmtDay(d, { day: 'numeric', month: 'short', year: 'numeric' });
const RTF = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' });
export function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'à l’instant';
  if (s < 3600) return RTF.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return RTF.format(-Math.round(s / 3600), 'hour');
  const d = Math.round(s / 86400);
  return d < 45 ? RTF.format(-d, 'day') : RTF.format(-Math.round(d / 30), 'month');
}
export function hav(a1, o1, a2, o2) {
  const R = 6371, rad = Math.PI / 180, dA = (a2 - a1) * rad, dO = (o2 - o1) * rad;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export const crowKm = roadKm => roadKm / ROUTE_F;
export const NEAR_KM = 6;
const TC_LOW = new Set(['de', 'du', 'le', 'la', 'les', 'des', 'en', 'sur', 'sous', 'aux', 'et', 'ou', 'a', 'à', 'l', 'd', 'lès', 'lez']);
export function titleCase(s) {
  if (!s) return '';
  const lo = s.toLowerCase();
  if (lo !== s && s !== s.toUpperCase()) return s;  // déjà en casse mixte : respecter la source
  return lo.replace(/[^\s\-'’]+/g, (w, i) => (i > 0 && TC_LOW.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
}
export const $ = id => document.getElementById(id);
export const notice = (t, b, cls = '') => `<div class="notice ${cls}"><b>${E(t)}</b>${b ? `<span>${b}</span>` : ''}</div>`;
export const loader = t => `<div class="inline-loader"><div class="spinner" aria-hidden="true"></div><p>${E(t)}</p></div>`;
export function toast(m, action) {
  const el = $('toast'); if (!el) return;
  el.textContent = m;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-btn'; b.textContent = action.label;
    b.addEventListener('click', () => { el.classList.remove('on'); action.fn(); });
    el.appendChild(b);
  }
  el.classList.toggle('has-action', !!action);
  el.classList.add('on');
  clearTimeout(state.toastT); state.toastT = setTimeout(() => el.classList.remove('on'), action ? 5000 : 2400);
}
export const ICON = {
  star: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  starO: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg>',
  route: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.71 11.29l-9-9a1 1 0 00-1.42 0l-9 9a1 1 0 000 1.42l9 9a1 1 0 001.42 0l9-9a1 1 0 000-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 011-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>',
  share: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.3 3.3 0 000-1.39l7.05-4.11A2.99 2.99 0 1015 5c0 .24.04.47.09.7L8.04 9.81a3 3 0 100 4.38l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1018 16.08z"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  chev: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>',
  sat: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM5 5h3a3 3 0 01-3 3V5zm0 7v-2a5 5 0 005-5h2a7 7 0 01-7 7zm0 6l3.5-4.5 2.5 3 3.5-4.5 4.5 6H5z"/></svg>',
  map: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9a.5.5 0 00-.36.48V20.5a.5.5 0 00.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9a.5.5 0 00.36-.48V3.5a.5.5 0 00-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>',
  clock: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>',
  drag: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 17a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>',
  edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  gps: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.94 3A8.99 8.99 0 0013 3.06V1h-2v2.06A8.99 8.99 0 003.06 11H1v2h2.06A8.99 8.99 0 0011 20.94V23h2v-2.06A8.99 8.99 0 0020.94 13H23v-2h-2.06zM12 19a7 7 0 110-14 7 7 0 010 14z"/></svg>',
  history: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 112.05 4.95l-1.42 1.42A9 9 0 1013 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>'
};