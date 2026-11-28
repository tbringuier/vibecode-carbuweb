// history.js — Historique des prix : fiche station, évolution par zone (Explorer), tendance 7 j.
// Données statiques générées par pipeline/history.py (branche `history`), servies sous history/,
// depuis 2007 (archives officielles). Un fichier par station (~5 Ko gzip), un par zone.
// Les carburants affichés sont ceux du sélecteur unique (prefs.fuels) : une courbe par carburant.
import { state, prefs, FUELS, setHist } from './state.js';
import { E, norm, fmtEur, fmtCts, fmtPct, notice, DAY_MS, todayDay, fmtDay, longDay, shortDay } from './helpers.js';
import { station, deptByCode } from './data.js';
import { visiblePrice } from './freshness.js';
import { loadChart } from './vendor.js';

const BASE = 'history/';

// [clé, libellé, libellé court (mobile), nombre de jours]
export const PERIODS = [['1m', '1 mois', '1M', 31], ['3m', '3 mois', '3M', 92], ['1y', '1 an', '1A', 366], ['5y', '5 ans', '5A', 1827], ['10y', '10 ans', '10A', 3653], ['all', 'Tout', 'Tout', Infinity]];

// ---------------------------------------------------------------------------
// Chargement (réponses mises en cache par URL ; revalidation HTTP conditionnelle)
// ---------------------------------------------------------------------------

function getJSON(url) {
  if (!state.histCache.has(url)) {
    state.histCache.set(url, fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => { state.histCache.delete(url); return null; }));
  }
  return state.histCache.get(url);
}
export const histIndex = () => getJSON(`${BASE}index.json`);
export function clearHistCache() { state.histCache.clear(); }
const stationUrl = sid => `${BASE}stations/${encodeURIComponent(String(sid).slice(-2))}/${encodeURIComponent(sid)}.json`;
// Les fichiers de zone départementale sont indexés par préfixe de code postal (Corse : 20).
export const histDeptCode = cp => { const s = String(cp || ''); return s.length < 2 ? '' : s.startsWith('97') ? s.slice(0, 3) : s.slice(0, 2); };
function zoneUrl(z) {
  if (z.kind === 'region') return `${BASE}zones/region/${encodeURIComponent(z.key)}.json`;
  if (z.kind === 'dept') return `${BASE}zones/dept/${encodeURIComponent(z.key)}.json`;
  return `${BASE}zones/fr.json`;
}

// Prix live (data.json) au format de l'historique : [jour UTC, millimes] — même convention que le pipeline.
const liveRec = e => (e && Number.isFinite(e.t) ? [Math.floor(e.t / DAY_MS), Math.round(e.p * 1000)] : null);

// ---------------------------------------------------------------------------
// Décodage et séries journalières
// ---------------------------------------------------------------------------

export function decodeSeries(a) {
  const r = []; let d = 0, p = 0;
  for (let i = 0; i + 1 < a.length; i += 2) {
    if (i === 0) { d = a[0]; p = a[1]; } else { d += a[i]; p += a[i + 1]; }
    r.push([d, p]);
  }
  return r;
}

// Prix (€/L) en vigueur chaque jour de [from, to] ; NaN = aucun relevé valable.
export function stationDaily(recs, from, to, ttl, live) {
  const out = new Float64Array(to - from + 1).fill(NaN);
  const rs = recs.slice();
  if (live) {
    const last = rs[rs.length - 1];
    if (!last || live[0] > last[0]) rs.push(live);
    else if (live[0] === last[0]) rs[rs.length - 1] = live;
  }
  for (let i = 0; i < rs.length; i++) {
    const [d, p] = rs[i];
    const isLast = i === rs.length - 1;
    let e = isLast ? to + 1 : rs[i + 1][0];
    if (!(isLast && live)) e = Math.min(e, d + ttl);
    e = Math.min(e, to + 1);
    for (let k = Math.max(d, from); k < e; k++) out[k - from] = p / 1000;
  }
  return out;
}

// Moyenne de zone par jour ; jours trop peu couverts masqués (< 25 % du nombre médian de stations).
function zoneDaily(doc, fuel, from, to) {
  const f = doc?.f?.[fuel]; const out = new Float64Array(Math.max(0, to - from + 1)).fill(NaN);
  if (!f) return out;
  if (!f._dec) {
    const avg = new Array(f.a.length), cnt = new Array(f.a.length); let pa = 0, pn = 0;
    for (let i = 0; i < f.a.length; i++) { pa += f.a[i]; pn += f.n[i]; avg[i] = pa; cnt[i] = pn; }
    const nz = cnt.filter(c => c > 0).sort((x, y) => x - y);
    f._dec = { avg, cnt, min: Math.max(3, Math.round((nz[nz.length >> 1] || 0) * 0.25)) };
  }
  const { avg, cnt, min } = f._dec;
  for (let d = Math.max(from, doc.d0); d <= Math.min(to, doc.d0 + doc.len - 1); d++) {
    const i = d - doc.d0;
    if (cnt[i] >= min) out[d - from] = avg[i] / 1000;
  }
  return out;
}

// Valeur journalière valide la plus récente à `day` ou avant (jusqu'à 7 jours plus tôt).
function valueAt(vals, from, day) {
  for (let d = day; d >= day - 7; d--) { const v = vals[d - from]; if (d >= from && !Number.isNaN(v)) return v; }
  return NaN;
}

// ---------------------------------------------------------------------------
// Regroupement automatique : jour (≤ 200 j), semaine (≤ 800 j), mois au-delà
// ---------------------------------------------------------------------------

function bucketOf(day, gran) {
  if (gran === 'day') return day;
  if (gran === 'week') return Math.floor((day + 3) / 7);
  const dt = new Date(day * DAY_MS);
  return dt.getUTCFullYear() * 12 + dt.getUTCMonth();
}
function bucketStart(key, gran) {
  if (gran === 'day') return key;
  if (gran === 'week') return key * 7 - 3;
  if (gran === 'year') return Math.floor(Date.UTC(key, 0, 1) / DAY_MS);
  return Math.floor(Date.UTC(Math.floor(key / 12), key % 12, 1) / DAY_MS);
}
function bucketLabel(start, gran) {
  if (gran === 'week') return `Semaine du ${fmtDay(start, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  if (gran === 'month') { const s = fmtDay(start, { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  return fmtDay(start, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}
function aggregate(vals, from, gran) {
  const out = []; let cur = null;
  for (let i = 0; i < vals.length; i++) {
    const k = bucketOf(from + i, gran);
    if (!cur || cur.key !== k) { cur = { key: k, start: bucketStart(k, gran), sum: 0, n: 0 }; out.push(cur); }
    const v = vals[i]; if (Number.isNaN(v)) continue;
    cur.sum += v; cur.n++;
  }
  return out.map(b => ({ x: b.start, y: b.n ? b.sum / b.n : null }));
}
const autoGran = span => (span <= 200 ? 'day' : span <= 800 ? 'week' : 'month');

// Indicateurs d'une série journalière sur la période affichée.
function seriesStats(vals, from) {
  let lo = Infinity, hi = -Infinity, loD = 0, hiD = 0, sum = 0, n = 0, first = NaN, last = NaN;
  vals.forEach((v, i) => {
    if (Number.isNaN(v)) return;
    if (Number.isNaN(first)) first = v;
    last = v; sum += v; n++;
    if (v <= lo) { lo = v; loD = from + i; }
    if (v >= hi) { hi = v; hiD = from + i; }
  });
  return n ? { lo, hi, loD, hiD, avg: sum / n, first, last, n } : null;
}

// ---------------------------------------------------------------------------
// Graphique (Chart.js chargé à la demande, axe linéaire en jours : pas d'adaptateur de dates)
// ---------------------------------------------------------------------------

const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const fuelColor = f => tok(`--fuel-${String(f).toLowerCase()}`) || tok('--ac');
const NF_AXIS = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Graduations calées sur le calendrier (lundis, débuts de mois, années).
function calendarTicks(min, max) {
  const span = max - min, ticks = [];
  const d0 = new Date(min * DAY_MS), y0 = d0.getUTCFullYear(), m0 = d0.getUTCMonth();
  if (span <= 60) {
    for (let d = Math.ceil((min + 3) / 7) * 7 - 3; d <= max; d += 7) ticks.push(d);
  } else if (span <= 1100) {
    for (let k = y0 * 12 + m0; ; k++) { const d = bucketStart(k, 'month'); if (d > max) break; if (d >= min) ticks.push(d); }
  } else {
    for (let y = y0; ; y++) { const d = bucketStart(y, 'year'); if (d > max) break; if (d >= min) ticks.push(d); }
  }
  const step = Math.ceil(ticks.length / (window.innerWidth < 560 ? 5 : 8));
  return ticks.filter((_, i) => i % step === 0);
}
function tickLabel(v, span) {
  if (span <= 60) return fmtDay(v, { day: 'numeric', month: 'short' });
  if (span <= 1100) return fmtDay(v, { month: 'short', year: span > 330 ? '2-digit' : undefined });
  return String(new Date(v * DAY_MS).getUTCFullYear());
}

export function destroyChart(key) { if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; } }

async function drawLineChart(key, canvasId, datasets, opt, isCurrent) {
  destroyChart(key);
  let Chart;
  try { Chart = await loadChart(); } catch { const c = document.getElementById(canvasId); if (c) c.parentElement.innerHTML = notice('Graphique indisponible', 'Le tableau ci-dessous reprend les chiffres clés.'); return; }
  const canvas = document.getElementById(canvasId);
  if (!canvas || !isCurrent()) return;
  destroyChart(key);
  const t2 = tok('--t2'), grid = tok('--bl'), axis = tok('--bd');
  const span = Math.max(1, opt.max - opt.min);
  state.charts[key] = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'index', intersect: false },
      elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 12 }, line: { borderWidth: 2, tension: 0, borderJoinStyle: 'round' } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: it => it.raw.y != null,
          callbacks: {
            title: items => (items[0] ? bucketLabel(items[0].raw.x, opt.gran) : ''),
            label: it => `${it.dataset.label} : ${fmtEur(it.raw.y)}`
          }
        }
      },
      scales: {
        x: {
          type: 'linear', min: opt.min, max: opt.max, offset: false,
          afterBuildTicks: ax => { ax.ticks = calendarTicks(opt.min, opt.max).map(value => ({ value })); },
          ticks: { color: t2, maxRotation: 0, autoSkip: false, callback: v => tickLabel(v, span) },
          grid: { color: grid }, border: { color: axis }
        },
        y: { ticks: { color: t2, callback: v => NF_AXIS.format(v) + ' €', maxTicksLimit: 6 }, grid: { color: grid }, border: { display: false } }
      }
    }
  });
}

function periodBounds(period, first, last) {
  const days = (PERIODS.find(p => p[0] === period) || PERIODS[2])[3];
  return { from: Number.isFinite(days) ? Math.max(first, last - days + 1) : first, to: last };
}

// Choix de la période ; les périodes plus longues que l'historique disponible sont désactivées.
function periodControls(span) {
  const seg = PERIODS.map(([k, l, s, days], i) => {
    const useless = i > 0 && Number.isFinite(days) && PERIODS[i - 1][3] >= span && prefs.hist.period !== k;
    return `<button type="button" class="seg-b" data-act="hist-period" data-period="${k}" aria-pressed="${prefs.hist.period === k}" aria-label="${l}"${useless ? ' disabled' : ''}><span class="seg-long" aria-hidden="true">${l}</span><span class="seg-short" aria-hidden="true">${s}</span></button>`;
  }).join('');
  return `<div class="seg" role="group" aria-label="Période affichée">${seg}</div>`;
}

const deltaCls = d => (d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : 'flat');
export const deltaHtml = (d, txt) => `<span class="delta ${deltaCls(d)}">${d > 0.0005 ? '<span aria-hidden="true">▲</span> ' : d < -0.0005 ? '<span aria-hidden="true">▼</span> ' : ''}${txt}</span>`;
const fuelCell = f => `<th scope="row" class="td-s"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span> ${f}</th>`;
const fuelsHint = (avail, what) => notice(`Pas d’historique ${what} pour les carburants choisis`, `Disponible pour ${avail.map(E).join(', ')} : cochez-les dans « Carburants ».`);

export function histSet(key, val) {
  if (key === 'period') setHist({ period: val });
  else if (key === 'cmp') setHist({ cmp: !!val });
  const r = state.route;
  if (r?.view === 'station') renderStationHistory(r.id);
  if (r?.view === 'home' && r.tab === 'explorer') renderZoneHistory();
}

// ---------------------------------------------------------------------------
// Fiche station : une courbe par carburant choisi (+ moyenne du département en pointillés)
// ---------------------------------------------------------------------------

const CMP_MAX_FUELS = 2;  // au-delà, les pointillés rendraient le graphique illisible
const isCurrentStation = sid => state.route?.view === 'station' && document.getElementById('hist-body')?.dataset.sid === sid;

export async function renderStationHistory(sid) {
  const req = ++state.histReq;
  const ok = () => req === state.histReq && isCurrentStation(sid);
  const idx = await histIndex();
  const doc = idx ? await getJSON(stationUrl(sid)) : null;
  if (!ok()) return;
  const box = document.getElementById('hist-body');
  const s = station(sid);
  if (!idx) { box.innerHTML = notice('Historique indisponible', 'Les données historiques n’ont pas encore été publiées.'); return; }
  const recs = {};
  for (const [f, a] of Object.entries(doc?.f || {})) { const r = decodeSeries(a); if (r.length) recs[f] = r; }
  const avail = FUELS.filter(f => recs[f]);
  if (!avail.length) { box.innerHTML = notice('Pas encore d’historique pour cette station', 'Les relevés s’accumulent à chaque mise à jour des données.'); return; }
  const shown = prefs.fuels.filter(f => recs[f]);
  if (!shown.length) { box.innerHTML = fuelsHint(avail, 'dans cette station'); return; }

  const ttl = idx.ttl_days || 45, today = todayDay();
  const first = Math.min(...shown.map(f => recs[f][0][0]));
  const { from, to } = periodBounds(prefs.hist.period, first, today);
  const gran = autoGran(to - from);
  // Prix live seulement s'il est encore valable (sinon la courbe le prolongerait jusqu'à aujourd'hui).
  const series = Object.fromEntries(shown.map(f => [f, stationDaily(recs[f], from, to, ttl, liveRec(visiblePrice(s, f)))]));

  // Moyenne du département de la station, chargée à la demande.
  const dc = histDeptCode(s?.cp || doc?.m?.cp);
  const canCmp = !!dc && shown.length <= CMP_MAX_FUELS;
  let zdoc = null;
  if (prefs.hist.cmp && canCmp) {
    zdoc = await getJSON(zoneUrl({ kind: 'dept', key: dc }));
    if (!ok()) return;
  }
  const zname = s?.dept || (zdoc?.label !== dc && zdoc?.label) || `département ${dc}`;
  const zseries = {};
  if (zdoc) for (const f of shown) if (zdoc.f?.[f]) zseries[f] = zoneDaily(zdoc, f, from, to);

  const hasCmp = Object.keys(zseries).length > 0;
  const datasets = [];
  let xmin = Infinity, xmax = -Infinity;
  for (const f of shown) {
    const col = fuelColor(f);
    const pts = aggregate(series[f], from, gran);
    if (pts.length) { xmin = Math.min(xmin, pts[0].x); xmax = Math.max(xmax, pts[pts.length - 1].x); }
    datasets.push({ label: f, data: pts, borderColor: col, backgroundColor: col, pointHoverBackgroundColor: col, order: 1 });
    if (zseries[f]) datasets.push({ label: `${f} · moyenne ${zname}`, data: aggregate(zseries[f], from, gran), borderColor: col, backgroundColor: col, borderWidth: 1.5, borderDash: [5, 4], order: 2 });
  }

  // Synthèse chiffrée par carburant (alternative au graphique).
  let rows = '';
  for (const f of shown) {
    const st = seriesStats(series[f], from);
    if (!st) { rows += `<tr>${fuelCell(f)}<td class="tnum u-text-muted" colspan="${hasCmp ? 6 : 5}">aucun relevé sur la période</td></tr>`; continue; }
    const d = st.last - st.first;
    let vs = '';
    if (hasCmp) {
      let ds = 0, dn = 0;
      const z = zseries[f];
      if (z) series[f].forEach((v, i) => { if (!Number.isNaN(v) && !Number.isNaN(z[i])) { ds += v - z[i]; dn++; } });
      vs = `<td class="tnum">${dn ? deltaHtml(ds / dn, fmtCts(ds / dn)) : '—'}</td>`;
    }
    rows += `<tr>${fuelCell(f)}<td class="tnum">${fmtEur(st.last)}</td><td class="tnum">${deltaHtml(d, fmtCts(d))}<span class="cell-sub">${st.first ? fmtPct(d / st.first) : ''}</span></td><td class="tnum">${fmtEur(st.lo)}<span class="cell-sub">${shortDay(st.loD)}</span></td><td class="tnum">${fmtEur(st.hi)}<span class="cell-sub">${shortDay(st.hiD)}</span></td><td class="tnum">${fmtEur(st.avg)}</td>${vs}</tr>`;
  }
  const table = `<div class="table-w hist-sum"><table><caption class="sr-only">Chiffres clés de la période par carburant</caption><thead><tr><th scope="col" class="th-s">Carburant</th><th scope="col" class="tnum">Dernier prix</th><th scope="col" class="tnum">Évolution</th><th scope="col" class="tnum">Plus bas</th><th scope="col" class="tnum">Plus haut</th><th scope="col" class="tnum">Moyenne</th>${hasCmp ? '<th scope="col" class="tnum">Écart au dép.</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;

  const legend = hasCmp ? `<p class="hist-legend"><span class="lg"><span class="lg-line"></span>cette station</span><span class="lg"><span class="lg-line lg-dash"></span>moyenne du département (${E(zname)})</span></p>` : '';
  const cmp = !dc ? '' : canCmp
    ? `<label class="hist-toggle"><input type="checkbox"${prefs.hist.cmp ? ' checked' : ''} data-change="hist-cmp"><span>Comparer à la moyenne du département</span></label>`
    : `<p class="hist-hint">Pour comparer à la moyenne du département, gardez ${CMP_MAX_FUELS} carburants au plus.</p>`;
  box.innerHTML = `<div class="hist-ctl">${periodControls(today - first)}${cmp}</div>
    ${legend}
    <div class="hist-chart"><canvas id="hist-chart" role="img" aria-label="Évolution des prix de la station (${E(shown.join(', '))}) du ${longDay(from)} au ${longDay(to)}"></canvas></div>
    ${table}
    <p class="hist-src">Historique depuis le ${longDay(first)} · archives officielles (depuis 2007) et relevés Carbu’Web.</p>`;
  if (Number.isFinite(xmin)) drawLineChart('station', 'hist-chart', datasets, { min: xmin, max: Math.max(xmax, xmin + 1), gran }, ok);
}

// ---------------------------------------------------------------------------
// Explorer : moyennes France / région / département
// ---------------------------------------------------------------------------

function currentZone(idx) {
  const ex = state.exp || {};
  if (ex.dept) {
    const d = deptByCode(ex.dept);
    if (d) return { kind: 'dept', key: d.code === '2A' || d.code === '2B' ? '20' : d.code, label: `${d.name} (${d.code})` };
  }
  // Slug = pipeline region_slug() (normalize_text) : recalculé si le manifeste ne le fournit pas.
  if (ex.region) return { kind: 'region', key: idx.regions?.[ex.region] || norm(ex.region).replace(/ /g, '-'), label: ex.region };
  return { kind: 'fr', key: 'fr', label: 'France entière' };
}

export async function renderZoneHistory() {
  const box = document.getElementById('zone-hist');
  if (!box) return;
  const req = ++state.zoneReq;
  const ok = () => req === state.zoneReq && state.route?.tab === 'explorer';
  const idx = await histIndex();
  if (!ok()) return;
  if (!idx) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const zone = currentZone(idx);
  document.getElementById('zone-hist-zone').textContent = zone.label;
  const doc = await getJSON(zoneUrl(zone));
  if (!ok()) return;
  const body = document.getElementById('zone-hist-body');
  if (!doc?.f) { body.innerHTML = notice('Pas d’historique pour cette zone', ''); return; }
  const avail = FUELS.filter(f => doc.f[f]);
  const shown = prefs.fuels.filter(f => avail.includes(f));
  if (!shown.length) { body.innerHTML = fuelsHint(avail, 'dans cette zone'); return; }

  const today = Math.min(todayDay(), doc.d0 + doc.len - 1);
  const { from, to } = periodBounds(prefs.hist.period, doc.d0, today);
  const series = Object.fromEntries(shown.map(f => [f, zoneDaily(doc, f, from, to)]));
  // Début de l'axe : premier jour couvert par l'un des carburants affichés.
  let start = from;
  while (start < to && shown.every(f => Number.isNaN(series[f][start - from]))) start++;
  const gran = autoGran(to - start);
  const datasets = shown.map(f => {
    const c = fuelColor(f);
    return { label: f, data: aggregate(series[f].subarray(start - from), start, gran), borderColor: c, backgroundColor: c, pointHoverBackgroundColor: c };
  });
  const xs = datasets[0]?.data || [];

  // Tendances (indépendantes de la période choisie).
  const BACK = [[7, '7 jours'], [30, '1 mois'], [365, '1 an'], [1826, '5 ans'], [3652, '10 ans']];
  const fFrom = Math.max(doc.d0, today - 3660);
  let rows = '';
  for (const f of shown) {
    const full = zoneDaily(doc, f, fFrom, today);
    const now = valueAt(full, fFrom, today);
    if (Number.isNaN(now)) continue;
    const cell = back => { const v = valueAt(full, fFrom, today - back); return Number.isNaN(v) ? '<td class="tnum">—</td>' : `<td class="tnum">${deltaHtml(now - v, fmtCts(now - v))}</td>`; };
    rows += `<tr>${fuelCell(f)}<td class="tnum">${fmtEur(now)}</td>${BACK.map(([b]) => cell(b)).join('')}</tr>`;
  }
  const trend = rows ? `<div class="table-w hist-sum"><table><caption class="sr-only">Prix moyen actuel et variations — ${E(zone.label)}</caption><thead><tr><th scope="col" class="th-s">Carburant</th><th scope="col" class="tnum">Moyenne actuelle</th>${BACK.map(([, l]) => `<th scope="col" class="tnum">sur ${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : '';

  body.innerHTML = `<div class="hist-ctl">${periodControls(today - doc.d0)}</div>
    <div class="hist-chart hist-chart-lg"><canvas id="zone-chart" role="img" aria-label="Évolution des prix moyens (${E(shown.join(', '))}) — ${E(zone.label)}, du ${longDay(start)} au ${longDay(to)}"></canvas></div>
    ${trend}
    <p class="hist-src">Moyenne quotidienne des stations de la zone · données depuis le ${longDay(doc.d0)} (archives officielles).</p>`;
  if (xs.length) drawLineChart('zone', 'zone-chart', datasets, { min: xs[0].x, max: Math.max(xs[xs.length - 1].x, xs[0].x + 1), gran }, ok);
}

// Variation sur 7 jours des moyennes nationales (cartes de l'Explorer).
export async function decorateTeaser() {
  const idx = await histIndex(); if (!idx) return;
  const doc = await getJSON(zoneUrl({ kind: 'fr' })); if (!doc?.f) return;
  const today = Math.min(todayDay(), doc.d0 + doc.len - 1), from = today - 14;
  document.querySelectorAll('.teaser-card[data-fuel]').forEach(card => {
    const f = card.dataset.fuel, v = zoneDaily(doc, f, from, today);
    const now = valueAt(v, from, today), before = valueAt(v, from, today - 7);
    const slot = card.querySelector('.teaser-card-t');
    if (!slot || Number.isNaN(now) || Number.isNaN(before)) return;
    slot.innerHTML = `${deltaHtml(now - before, fmtCts(now - before))} <span class="teaser-card-p">en 7 jours</span>`;
  });
}
