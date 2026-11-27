// history.js — Historique des prix : station (vue détail), zones (Explorer), tendance (accueil).
// Données statiques générées par pipeline/history.py (branche `history`) et servies sous history/.
import { state, FUELS, uFuels, histPrefs, setHistPrefs } from './state.js';
import { E, fmtP, fmtEur, fmtCts, fmtPct, notice } from './helpers.js';

const Chart = window.Chart;
const BASE = 'history/';
const DAY_MS = 86400000;

// [clé, libellé, libellé court (mobile), nombre de jours]
export const PERIODS = [['1m', '1 mois', '1M', 31], ['3m', '3 mois', '3M', 92], ['6m', '6 mois', '6M', 183], ['1y', '1 an', '1A', 366], ['5y', '5 ans', '5A', 1827], ['all', 'Tout', 'Tout', Infinity]];
const GRANS = [['auto', 'Auto'], ['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['year', 'Année']];
const GRAN_TABLE = { day: 'jour', week: 'semaine', month: 'mois', year: 'année' };

// ---------------------------------------------------------------------------
// Chargement (fetch mis en cache par URL ; revalidation HTTP à chaque session)
// ---------------------------------------------------------------------------

function getJSON(url) {
  if (!state.histCache.has(url)) {
    state.histCache.set(url, fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return state.histCache.get(url);
}
export const histIndex = () => getJSON(`${BASE}index.json`);
export function clearHistCache() { state.histCache.clear(); }
const stationUrl = sid => `${BASE}stations/${encodeURIComponent(String(sid).slice(-2))}/${encodeURIComponent(sid)}.json`;
export const deptCodeFromCp = cp => { const s = String(cp || ''); return s.length < 2 ? '' : (s.startsWith('97') ? s.slice(0, 3) : s.slice(0, 2)); };
function zoneUrl(z) {
  if (z.kind === 'region') return `${BASE}zones/region/${encodeURIComponent(z.key)}.json`;
  if (z.kind === 'dept') return `${BASE}zones/dept/${encodeURIComponent(z.key)}.json`;
  return `${BASE}zones/fr.json`;
}

// ---------------------------------------------------------------------------
// Jours (numéro de jour depuis le 1970-01-01, calendrier sans fuseau)
// ---------------------------------------------------------------------------

export const todayDay = () => { const n = new Date(); return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS); };
const isoDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null; };
const fmtDay = (d, o) => new Date(d * DAY_MS).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
const longDay = d => fmtDay(d, { day: 'numeric', month: 'long', year: 'numeric' });
// Même convention que le pipeline : date UTC de maj_iso (l'export source décale l'heure locale).
function liveDay(e) {
  if (e?.maj_iso) { const t = Date.parse(e.maj_iso); if (Number.isFinite(t)) return Math.floor(t / DAY_MS); }
  return isoDay(e?.date_maj);
}

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
function decodeDaily(a, n) {
  const avg = new Array(a.length), cnt = new Array(a.length); let pa = 0, pn = 0;
  for (let i = 0; i < a.length; i++) { pa += a[i]; pn += n[i]; avg[i] = pa; cnt[i] = pn; }
  return { avg, cnt };
}

// Prix (€/L) en vigueur chaque jour de [from, to] ; NaN = aucun relevé valable.
// `live` = prix actuel de data.json : la courbe se termine sur le prix affiché par la fiche.
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

// Moyenne de zone par jour, en masquant les jours trop peu couverts (début de série, import partiel).
function zoneDaily(doc, fuel, from, to) {
  const f = doc?.f?.[fuel]; const out = new Float64Array(to - from + 1).fill(NaN);
  if (!f) return out;
  if (!f._dec) {
    const dec = decodeDaily(f.a, f.n);
    const nz = dec.cnt.filter(c => c > 0).sort((x, y) => x - y);
    dec.min = Math.max(3, Math.round((nz[nz.length >> 1] || 0) * 0.25));
    f._dec = dec;
  }
  const { avg, cnt, min } = f._dec;
  for (let d = Math.max(from, doc.d0); d <= Math.min(to, doc.d0 + doc.len - 1); d++) {
    const i = d - doc.d0;
    if (cnt[i] >= min) out[d - from] = avg[i] / 1000;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regroupement jour / semaine (lundi) / mois / année
// ---------------------------------------------------------------------------

function bucketOf(day, gran) {
  if (gran === 'day') return day;
  if (gran === 'week') return Math.floor((day + 3) / 7);
  const dt = new Date(day * DAY_MS), y = dt.getUTCFullYear();
  return gran === 'month' ? y * 12 + dt.getUTCMonth() : y;
}
function bucketStart(key, gran) {
  if (gran === 'day') return key;
  if (gran === 'week') return key * 7 - 3;
  if (gran === 'month') return Math.floor(Date.UTC(Math.floor(key / 12), key % 12, 1) / DAY_MS);
  return Math.floor(Date.UTC(key, 0, 1) / DAY_MS);
}
function bucketLabel(start, gran, short) {
  if (gran === 'week') return `Sem. du ${fmtDay(start, { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' })}`;
  if (gran === 'month') { const s = fmtDay(start, { month: short ? 'short' : 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  if (gran === 'year') return String(new Date(start * DAY_MS).getUTCFullYear());
  return fmtDay(start, { weekday: short ? undefined : 'short', day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' });
}
function aggregate(vals, from, gran) {
  const out = []; let cur = null;
  for (let i = 0; i < vals.length; i++) {
    const k = bucketOf(from + i, gran);
    if (!cur || cur.key !== k) { cur = { key: k, start: bucketStart(k, gran), sum: 0, n: 0, min: Infinity, max: -Infinity }; out.push(cur); }
    const v = vals[i]; if (Number.isNaN(v)) continue;
    cur.sum += v; cur.n++;
    if (v < cur.min) cur.min = v;
    if (v > cur.max) cur.max = v;
  }
  for (const b of out) b.avg = b.n ? b.sum / b.n : NaN;
  return out;
}
const autoGran = span => (span <= 200 ? 'day' : span <= 800 ? 'week' : 'month');

// ---------------------------------------------------------------------------
// Graphique (Chart.js, axe linéaire en jours : pas d'adaptateur de dates)
// ---------------------------------------------------------------------------

const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const fuelColor = f => tok(`--fuel-${String(f).toLowerCase()}`) || tok('--ac');
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex);
const NF_AXIS = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

// Graduations calées sur le calendrier (lundis, débuts de mois, années), 8 au plus.
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
  const step = Math.ceil(ticks.length / 8);
  return ticks.filter((_, i) => i % step === 0);
}
function tickLabel(v, span) {
  if (span <= 60) return fmtDay(v, { day: 'numeric', month: 'short' });
  if (span <= 1100) return fmtDay(v, { month: 'short', year: span > 330 ? '2-digit' : undefined });
  return String(new Date(v * DAY_MS).getUTCFullYear());
}

function drawLineChart(stateKey, canvas, datasets, opt) {
  if (state[stateKey]) { state[stateKey].destroy(); state[stateKey] = null; }
  if (!canvas || !Chart) return;
  const t2 = tok('--t2'), grid = tok('--bl'), axis = tok('--bd');
  const span = Math.max(1, opt.max - opt.min);
  state[stateKey] = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'index', intersect: false },
      elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 12 }, line: { borderWidth: 2, tension: 0, borderJoinStyle: 'round' } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: it => !it.dataset.band,
          callbacks: {
            title: items => (items[0] ? bucketLabel(items[0].raw.x, opt.gran, false) : ''),
            label: it => `${it.dataset.label} : ${fmtEur(it.raw.y)}`,
            afterLabel: it => (it.raw.lo != null && it.raw.hi - it.raw.lo > 0.0005 ? `min ${fmtEur(it.raw.lo)} · max ${fmtEur(it.raw.hi)}` : '')
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
        y: {
          ticks: { color: t2, callback: v => NF_AXIS.format(v) + ' €', maxTicksLimit: 6 },
          grid: { color: grid }, border: { display: false }
        }
      }
    }
  });
}

// Série moyenne (+ bande min–max si regroupée) alignée sur une liste de seaux commune.
function seriesFromBuckets(buckets, gran, withRange) {
  return buckets.map(b => ({ x: b.start, y: b.n ? b.avg : null, lo: withRange && b.n ? b.min : null, hi: withRange && b.n ? b.max : null }));
}

function periodBounds(period, first, last) {
  const days = (PERIODS.find(p => p[0] === period) || PERIODS[3])[3];
  const from = Number.isFinite(days) ? Math.max(first, last - days + 1) : first;
  return { from, to: last };
}

// Contrôles partagés : période (boutons) + regroupement (liste).
function periodControls(gran) {
  const seg = PERIODS.map(([k, l, s]) => `<button type="button" class="seg-b" aria-pressed="${histPrefs.period === k}" aria-label="${l}" onclick="histSet('period','${k}')"><span class="seg-long" aria-hidden="true">${l}</span><span class="seg-short" aria-hidden="true">${s}</span></button>`).join('');
  const opts = GRANS.map(([k, l]) => `<option value="${k}"${histPrefs.gran === k ? ' selected' : ''}>${k === 'auto' ? `Auto (${GRAN_TABLE[gran]})` : l}</option>`).join('');
  return `<div class="seg" role="group" aria-label="Période">${seg}</div><label class="hist-gran"><span class="sr-only">Regrouper par</span><select class="inp inp-sm" onchange="histSet('gran',this.value)" aria-label="Regrouper par">${opts}</select></label>`;
}

const deltaCls = d => (d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : 'flat');
const deltaHtml = (d, txt) => `<span class="delta ${deltaCls(d)}"><span aria-hidden="true">${d > 0.0005 ? '▲' : d < -0.0005 ? '▼' : '='}</span> ${txt}</span>`;

function bucketTable(buckets, gran, label) {
  const rows = buckets.filter(b => b.n).reverse();
  if (!rows.length) return '';
  const MAX = 120, range = gran !== 'day';  // par jour : une seule valeur, min/max redondants
  const head = range ? '<th scope="col" class="tnum">Moyenne</th><th scope="col" class="tnum">Min</th><th scope="col" class="tnum">Max</th>' : '<th scope="col" class="tnum">Prix</th>';
  let h = `<details class="hist-table"><summary>Détail par ${GRAN_TABLE[gran]} <span class="pill">${rows.length}</span></summary><div class="table-w"><table><caption class="sr-only">${E(label)} — prix par ${GRAN_TABLE[gran]}</caption><thead><tr><th scope="col">Période</th>${head}<th scope="col" class="tnum">Var.</th></tr></thead><tbody>`;
  rows.slice(0, MAX).forEach((b, i) => {
    const prev = rows[i + 1];
    const v = prev ? deltaHtml(b.avg - prev.avg, fmtCts(b.avg - prev.avg)) : '—';
    const cells = range ? `<td class="tnum">${fmtP(b.avg)}</td><td class="tnum">${fmtP(b.min)}</td><td class="tnum">${fmtP(b.max)}</td>` : `<td class="tnum">${fmtP(b.avg)}</td>`;
    h += `<tr><td>${bucketLabel(b.start, gran, true)}</td>${cells}<td class="tnum">${v}</td></tr>`;
  });
  h += '</tbody></table></div>';
  if (rows.length > MAX) h += `<p class="hist-note">${MAX} périodes les plus récentes affichées.</p>`;
  return h + '</details>';
}

export function histSet(key, val) {
  if (key === 'fuel') state.histFuel = val;
  else if (key === 'period' || key === 'gran') setHistPrefs({ [key]: val });
  else if (key === 'cmp') setHistPrefs({ cmp: !!val });
  const sv = document.getElementById('station-view');
  const sid = sv && !sv.classList.contains('hidden') ? sv.getAttribute('data-sid') : null;
  if (sid) renderStationHistory(sid);
  if (!document.getElementById('pane-explorer')?.classList.contains('hidden')) renderZoneHistory();
}

// ---------------------------------------------------------------------------
// Vue station
// ---------------------------------------------------------------------------

const isCurrentStation = sid => document.getElementById('station-view')?.getAttribute('data-sid') === sid;

export async function renderStationHistory(sid) {
  const req = ++state.histReq;
  const box = document.getElementById('hist-body');
  if (!box) return;
  const [idx, doc] = await Promise.all([histIndex(), histIndex().then(i => (i ? getJSON(stationUrl(sid)) : null))]);
  if (req !== state.histReq || !isCurrentStation(sid) || !document.getElementById('hist-body')) return;
  const st = state.db?.stations?.[sid];
  if (!idx) { box.innerHTML = notice('Historique indisponible', 'Les données historiques n\'ont pas encore été publiées.'); return; }
  const recs = {};
  for (const [f, a] of Object.entries(doc?.f || {})) { const r = decodeSeries(a); if (r.length) recs[f] = r; }
  const live = {};
  for (const [f, e] of Object.entries(st?.carburants_disponibles || {})) { const d = liveDay(e), p = Math.round(parseFloat(e.prix) * 1000); if (d != null && Number.isFinite(p)) live[f] = [d, p]; }
  let fuels = FUELS.filter(f => recs[f]);
  const preferred = fuels.filter(f => uFuels.includes(f));
  if (preferred.length) fuels = preferred;
  if (!fuels.length) { box.innerHTML = notice('Pas encore d\'historique pour cette station', 'Les relevés s\'accumulent à chaque mise à jour des données.'); return; }
  const fuel = fuels.includes(state.histFuel) ? state.histFuel : fuels[0];

  const ttl = idx.ttl_days || 45, today = todayDay();
  const first = recs[fuel][0][0];
  const { from, to } = periodBounds(histPrefs.period, first, today);
  const gran = histPrefs.gran === 'auto' ? autoGran(to - from) : histPrefs.gran;
  const vals = stationDaily(recs[fuel], from, to, ttl, live[fuel]);

  // Moyenne du département de la station (même seaux), chargée à la demande.
  const dc = deptCodeFromCp(st?.code_postal || doc?.m?.cp);
  let zvals = null, zname = '';
  if (histPrefs.cmp && dc) {
    const zdoc = await getJSON(zoneUrl({ kind: 'dept', key: dc }));
    if (req !== state.histReq || !isCurrentStation(sid)) return;
    if (zdoc?.f?.[fuel]) { zvals = zoneDaily(zdoc, fuel, from, to); zname = zdoc.label || dc; }
  }
  const zlabel = `Moyenne ${zname}`;

  const buckets = aggregate(vals, from, gran);
  const withRange = gran !== 'day';
  const col = fuelColor(fuel), muted = tok('--t3');
  const datasets = [];
  if (withRange) {
    const pts = seriesFromBuckets(buckets, gran, true);
    datasets.push({ label: 'max', band: true, data: pts.map(p => ({ x: p.x, y: p.hi })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 3 });
    datasets.push({ label: 'min', band: true, data: pts.map(p => ({ x: p.x, y: p.lo })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '-1', backgroundColor: alpha(col, 0.16), order: 3 });
  }
  if (zvals) {
    const zb = aggregate(zvals, from, gran);
    datasets.push({ label: zlabel, data: zb.map(b => ({ x: b.start, y: b.n ? b.avg : null })), borderColor: muted, backgroundColor: muted, borderWidth: 1.5, order: 2 });
  }
  datasets.push({ label: 'Cette station', data: seriesFromBuckets(buckets, gran, withRange), borderColor: col, backgroundColor: col, pointHoverBackgroundColor: col, order: 1 });

  // Indicateurs sur la période affichée (valeurs journalières, pas les seaux).
  let lo = Infinity, hi = -Infinity, loD = 0, hiD = 0, sum = 0, n = 0, firstV = NaN, lastV = NaN, lastD = 0;
  vals.forEach((v, i) => {
    if (Number.isNaN(v)) return;
    if (Number.isNaN(firstV)) firstV = v;
    lastV = v; lastD = from + i; sum += v; n++;
    if (v <= lo) { lo = v; loD = from + i; }
    if (v >= hi) { hi = v; hiD = from + i; }
  });
  const changes = recs[fuel].filter((r, i, a) => r[0] >= from && r[0] <= to && (i === 0 || a[i - 1][1] !== r[1])).length;
  let cmpHtml = '';
  if (zvals) {
    let ds = 0, dn = 0;
    vals.forEach((v, i) => { const z = zvals[i]; if (!Number.isNaN(v) && !Number.isNaN(z)) { ds += v - z; dn++; } });
    if (dn) {
      const m = ds / dn;
      const txt = Math.abs(m) < 0.0005 ? 'au niveau de' : `${fmtCts(Math.abs(m)).replace('+', '')} ${m < 0 ? 'moins cher' : 'plus cher'} que`;
      cmpHtml = `<p class="hist-cmp ${m < -0.0005 ? 'good' : m > 0.0005 ? 'bad' : ''}">Sur la période, cette station est en moyenne <b>${txt}</b> la moyenne du département (${E(zname)}).</p>`;
    }
  }

  const chips = fuels.map(f => `<button type="button" class="chip chip-fuel" aria-pressed="${f === fuel}" onclick="histSet('fuel','${f}')"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</button>`).join('');
  const legend = [`<span class="lg"><span class="lg-line sw-${fuel.toLowerCase()}"></span>Cette station</span>`];
  if (withRange) legend.push(`<span class="lg"><span class="lg-band sw-${fuel.toLowerCase()}"></span>Plage min–max</span>`);
  if (zvals) legend.push(`<span class="lg"><span class="lg-line lg-muted"></span>${E(zlabel)}</span>`);
  const d = lastV - firstV;
  const tiles = n ? `<div class="hist-stats">
      <div class="stat"><div class="stat-l">Dernier prix</div><div class="stat-v">${fmtEur(lastV)}</div><div class="stat-s">${fmtDay(lastD, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      <div class="stat"><div class="stat-l">Évolution</div><div class="stat-v">${deltaHtml(d, fmtCts(d))}</div><div class="stat-s">${firstV ? fmtPct(d / firstV) : ''} sur la période</div></div>
      <div class="stat"><div class="stat-l">Plus bas</div><div class="stat-v">${fmtEur(lo)}</div><div class="stat-s">${fmtDay(loD, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      <div class="stat"><div class="stat-l">Plus haut</div><div class="stat-v">${fmtEur(hi)}</div><div class="stat-s">${fmtDay(hiD, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      <div class="stat"><div class="stat-l">Moyenne</div><div class="stat-v">${fmtEur(sum / n)}</div><div class="stat-s">${n} jour${n > 1 ? 's' : ''} relevé${n > 1 ? 's' : ''}</div></div>
      <div class="stat"><div class="stat-l">Changements</div><div class="stat-v">${changes}</div><div class="stat-s">de prix</div></div>
    </div>` : notice('Aucun relevé sur cette période', 'Élargissez la période.');

  box.innerHTML = `<div class="hist-ctl"><div class="chips hist-fuels" role="group" aria-label="Carburant">${chips}</div><div class="hist-ctl-r">${periodControls(gran)}</div></div>
    <div class="hist-legend">${legend.join('')}</div>
    <div class="hist-chart"><canvas id="hist-chart" role="img" aria-label="Évolution du prix ${E(fuel)} de la station, du ${longDay(from)} au ${longDay(to)}"></canvas></div>
    ${tiles}${cmpHtml}
    <label class="hist-toggle"><input type="checkbox"${histPrefs.cmp ? ' checked' : ''} onchange="histSet('cmp',this.checked)"${dc ? '' : ' disabled'}> Comparer à la moyenne du département</label>
    ${bucketTable(buckets, gran, `${fuel} — cette station`)}
    <p class="hist-src">Historique depuis le ${longDay(first)} · archives officielles + relevés Carbu'Web.</p>`;
  drawLineChart('histChart', document.getElementById('hist-chart'), datasets, { min: buckets[0].start, max: Math.max(buckets[buckets.length - 1].start, buckets[0].start + 1), gran });
}

// ---------------------------------------------------------------------------
// Explorer : moyennes France / région / département
// ---------------------------------------------------------------------------

function currentZone(idx) {
  const rg = document.getElementById('exp-region')?.value || '';
  const dn = document.getElementById('exp-dept')?.value || '';
  if (dn) {
    const code = Object.entries(state.db?.dept_index || {}).find(([, d]) => d.nom === dn)?.[0];
    if (code) return { kind: 'dept', key: code, label: `${dn} (${code})` };
  }
  if (rg && idx.regions?.[rg]) return { kind: 'region', key: idx.regions[rg], label: rg };
  return { kind: 'fr', key: 'fr', label: 'France entière' };
}

// Valeur journalière valide la plus récente à `day` ou avant (jusqu'à 7 jours plus tôt).
function valueAt(vals, from, day) {
  for (let d = day; d >= day - 7; d--) { const v = vals[d - from]; if (d >= from && !Number.isNaN(v)) return v; }
  return NaN;
}

export function zoneToggleFuel(f) {
  const cur = state.zoneFuels || [];
  const next = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f];
  state.zoneFuels = next.length ? FUELS.filter(x => next.includes(x)) : cur;
  renderZoneHistory();
}

export async function renderZoneHistory() {
  const box = document.getElementById('zone-hist');
  if (!box) return;
  const req = ++state.zoneReq;
  const idx = await histIndex();
  if (req !== state.zoneReq) return;
  if (!idx) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const zone = currentZone(idx);
  const doc = await getJSON(zoneUrl(zone));
  if (req !== state.zoneReq) return;
  const body = document.getElementById('zone-hist-body');
  document.getElementById('zone-hist-zone').textContent = zone.label;
  if (!doc?.f) { body.innerHTML = notice('Pas d\'historique pour cette zone', ''); return; }
  const avail = FUELS.filter(f => doc.f[f]);
  if (!state.zoneFuels) { const sel = document.getElementById('exp-fuel')?.value; state.zoneFuels = [avail.includes(sel) ? sel : avail[0]]; }
  let shown = state.zoneFuels.filter(f => avail.includes(f));
  if (!shown.length) shown = avail.slice(0, 1);

  const today = Math.min(todayDay(), doc.d0 + doc.len - 1);
  const { from, to } = periodBounds(histPrefs.period, doc.d0, today);
  const gran = histPrefs.gran === 'auto' ? autoGran(to - from) : histPrefs.gran;
  const series = {};
  for (const f of avail) series[f] = zoneDaily(doc, f, from, to);
  // Début de l'axe : premier jour couvert par l'un des carburants affichés.
  let start = from;
  while (start < to && shown.every(f => Number.isNaN(series[f][start - from]))) start++;
  const datasets = shown.map(f => {
    const b = aggregate(series[f].subarray(start - from), start, gran);
    const c = fuelColor(f);
    return { label: f, data: b.map(x => ({ x: x.start, y: x.n ? x.avg : null })), borderColor: c, backgroundColor: c, pointHoverBackgroundColor: c };
  });
  const xs = datasets[0]?.data || [];

  const chips = avail.map(f => `<button type="button" class="chip chip-fuel" aria-pressed="${shown.includes(f)}" onclick="zoneToggleFuel('${f}')"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</button>`).join('');
  // Tableau de tendances (toujours sur les données complètes, indépendant de la période).
  const full = {};
  const fFrom = Math.max(doc.d0, today - 400);
  let rows = '';
  for (const f of avail) {
    full[f] = zoneDaily(doc, f, fFrom, today);
    const now = valueAt(full[f], fFrom, today);
    if (Number.isNaN(now)) continue;
    const cell = back => { const v = valueAt(full[f], fFrom, today - back); return Number.isNaN(v) ? '<td class="tnum">—</td>' : `<td class="tnum">${deltaHtml(now - v, fmtCts(now - v))}</td>`; };
    rows += `<tr><td class="td-s"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span> ${f}</td><td class="tnum">${fmtEur(now)}</td>${cell(7)}${cell(30)}${cell(365)}</tr>`;
  }
  const trend = rows ? `<div class="table-w hist-trend"><table><caption class="sr-only">Prix moyen actuel et variations — ${E(zone.label)}</caption><thead><tr><th scope="col" class="th-s">Carburant</th><th scope="col" class="tnum">Moyenne</th><th scope="col" class="tnum">7 jours</th><th scope="col" class="tnum">30 jours</th><th scope="col" class="tnum">1 an</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  const one = shown.length === 1 ? aggregate(series[shown[0]].subarray(start - from), start, gran) : null;

  body.innerHTML = `<div class="hist-ctl"><div class="chips hist-fuels" role="group" aria-label="Carburants affichés">${chips}</div><div class="hist-ctl-r">${periodControls(gran)}</div></div>
    <div class="hist-chart hist-chart-lg"><canvas id="zone-chart" role="img" aria-label="Évolution des prix moyens — ${E(zone.label)}, du ${longDay(start)} au ${longDay(to)}"></canvas></div>
    ${trend}
    ${one ? bucketTable(one, gran, `${shown[0]} — ${zone.label}`) : ''}
    <p class="hist-src">Moyenne journalière des stations de la zone · données depuis le ${longDay(doc.d0)}.</p>`;
  if (xs.length) drawLineChart('zoneChart', document.getElementById('zone-chart'), datasets, { min: xs[0].x, max: Math.max(xs[xs.length - 1].x, xs[0].x + 1), gran });
}

// ---------------------------------------------------------------------------
// Accueil Explorer : variation sur 7 jours des moyennes nationales
// ---------------------------------------------------------------------------

export async function decorateTeaser() {
  const idx = await histIndex(); if (!idx) return;
  const doc = await getJSON(zoneUrl({ kind: 'fr' })); if (!doc?.f) return;
  const today = Math.min(todayDay(), doc.d0 + doc.len - 1), from = today - 14;
  document.querySelectorAll('.teaser-card[data-fuel]').forEach(card => {
    const f = card.dataset.fuel, v = zoneDaily(doc, f, from, today);
    const now = valueAt(v, from, today), before = valueAt(v, from, today - 7);
    const slot = card.querySelector('.teaser-card-t');
    if (!slot || Number.isNaN(now) || Number.isNaN(before)) return;
    slot.innerHTML = `${deltaHtml(now - before, fmtCts(now - before))} <span class="teaser-card-p">7 j</span>`;
  });
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.histChart || state.zoneChart) histSet('theme'); });
