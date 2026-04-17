import { ROUTE_F, radius, uFuels, state } from './state.js';
export const E = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
export const norm = t => t ? t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-']/g, " ").toLowerCase().replace(/\s+/g, " ").trim() : "";
export const fmtInt = n => { const v = typeof n === 'number' ? n : parseInt(String(n).replace(/\u202f/g, ''), 10); return Number.isFinite(v) ? String(Math.trunc(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') : ''; };
export const coord = v => { if (typeof v === 'number' && Number.isFinite(v)) return v; const n = parseFloat(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
export function hav(a1, o1, a2, o2) { const R = 6371, dA = (a2 - a1) * Math.PI / 180, dO = (o2 - o1) * Math.PI / 180; const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dO / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
export const maxKm = () => radius / ROUTE_F;
export const maxKmFav = f => (f?.radius && Number.isFinite(+f.radius)) ? +f.radius / ROUTE_F : maxKm();
export const fmtKm = k => '~' + String((Math.round(k * ROUTE_F * 10) / 10).toFixed(1)).replace('.', ',') + '\u202fkm';
export const nearKm = () => Math.min(11, Math.max(4, maxKm()));
export const hasFuel = s => s?.carburants_disponibles && Object.keys(s.carburants_disponibles).some(c => uFuels.includes(c));
const TC_LOW = new Set(['de','du','le','la','les','des','en','sur','sous','aux','et','ou','a','l','d']);
export const titleCase = s => { if (!s) return ''; const lo = s.toLowerCase(); if (lo === s) return s; return lo.replace(/\S+/g, (w, i) => (i > 0 && TC_LOW.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)); };
export const stationName = s => s.nom_osm || ('Station\u00a0\u00b7 ' + (titleCase(s.ville) || 'Inconnue'));
export const notice = (t, b) => `<div class="notice"><b>${t}</b>${b ? `<span>${b}</span>` : ''}</div>`;
export function toast(m) { const el = document.getElementById('toast'); if (!el) return; el.textContent = m; el.classList.add('on'); clearTimeout(state.toastT); state.toastT = setTimeout(() => el.classList.remove('on'), 2200); }