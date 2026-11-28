// hours.js — Horaires d'ouverture : statut « ouvert / fermé maintenant » (heure de Paris) et affichage.
// Les horaires viennent de la source officielle : souvent absents (null) ; « automate 24/24 »
// signifie qu'on peut payer par carte à toute heure même hors présence du personnel.
import { E } from './helpers.js';
import { dayName } from './data.js';

const PARIS_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// {day: 0 (lundi)..6, min: minutes depuis minuit} à Paris.
export function parisNow(d = new Date()) {
  const parts = Object.fromEntries(PARIS_FMT.formatToParts(d).map(p => [p.type, p.value]));
  return { day: WD[parts.weekday] ?? 0, min: (+parts.hour % 24) * 60 + +parts.minute };
}

// 'HH:MM-HH:MM,HH:MM-HH:MM' -> [[début, fin], …] en minutes ; 00:00-00:00 et 00:00-23:59 = toute la journée.
function slots(txt) {
  if (!txt) return [];
  return txt.split(',').map(sl => {
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(sl);
    if (!m) return null;
    const a = +m[1] * 60 + +m[2]; let b = +m[3] * 60 + +m[4];
    if (b <= a) b = a === 0 ? 1440 : b + 1440;  // 00:00-00:00 = 24 h ; 22:00-02:00 = passe minuit
    if (b === 1439) b = 1440;
    return [a, b];
  }).filter(Boolean);
}
const hm = m => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`; };
const fullDay = sl => sl.length === 1 && sl[0][0] === 0 && sl[0][1] >= 1440;

// {open: bool, label} ou null si les horaires sont inconnus.
export function openStatus(s, now = parisNow()) {
  const h = s.hours;
  if (!h) return null;
  if (h.auto) return { open: true, label: 'paiement par carte 24h/24', auto: true };
  if (!h.days) return null;
  const today = h.days[now.day];
  if (today === null) return null;
  const sl = slots(today);
  // Créneau de la veille qui déborde après minuit.
  const prev = slots(h.days[(now.day + 6) % 7] || '');
  for (const [a, b] of prev) if (b > 1440 && now.min < b - 1440) return { open: true, label: `jusqu’à ${hm(b)}` };
  if (fullDay(sl)) return { open: true, label: '24h/24 aujourd’hui' };
  for (const [a, b] of sl) {
    if (now.min >= a && now.min < b) {
      const soon = b - now.min <= 30;
      return { open: true, soon, label: soon ? `ferme bientôt (${hm(b)})` : `jusqu’à ${hm(b)}` };
    }
  }
  const next = sl.find(([a]) => a > now.min);
  if (next) return { open: false, label: `ouvre à ${hm(next[0])}` };
  for (let k = 1; k <= 7; k++) {
    const d = (now.day + k) % 7, t = h.days[d];
    if (t === null) return { open: false, label: 'réouverture non communiquée' };
    const ns = slots(t);
    if (ns.length) return { open: false, label: `ouvre ${k === 1 ? 'demain' : dayName(d).toLowerCase()} à ${hm(ns[0][0])}` };
  }
  return { open: false, label: 'réouverture non communiquée' };
}

export function openBadge(s) {
  const st = openStatus(s);
  if (!st) return '';
  if (st.auto) return '<span class="badge badge-ok" title="Paiement par carte à toute heure">24/7</span>';
  return `<span class="badge ${st.open ? (st.soon ? 'badge-warn' : 'badge-ok') : 'badge-off'}">${st.open ? 'Ouvert' : 'Fermé'}</span>`;
}

// Tableau des horaires de la semaine (jour courant mis en avant).
export function hoursTable(s) {
  const h = s.hours;
  if (!h || !h.days) return '';
  const now = parisNow();
  let rows = '';
  for (let d = 0; d < 7; d++) {
    const t = h.days[d];
    const sl = slots(t || '');
    const txt = t === null ? '<span class="h-na">non communiqué</span>'
      : !sl.length ? '<span class="h-closed">Fermé</span>'
        : fullDay(sl) ? '24h/24' : sl.map(([a, b]) => `${hm(a)} – ${hm(b)}`).join('<br>');
    rows += `<li${d === now.day ? ' class="is-today" aria-current="date"' : ''}><span class="h-day">${E(dayName(d))}</span><span class="h-val">${txt}</span></li>`;
  }
  return `<ul class="hours-list">${rows}</ul>`;
}
