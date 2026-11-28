// lists.js — Listes de stations partagées (proximité, zone, classement, recherche) :
// tri, classement des prix dans la liste, pagination « Voir plus », bandeau « Meilleurs prix ».
import { state, prefs, PAGE, PRICE_EPS } from './state.js';
import { E, fmtKm, fmtEur, plural } from './helpers.js';
import { visiblePrice } from './freshness.js';
import { ptag, minorPrices, classFor, pickBest, tankTxt } from './prices.js';

// Carburant de tri valide pour la sélection courante ('' = distance si autorisé).
export function sortFuelFor(allowDistance) {
  const f = state.sortFuel;
  if (f && prefs.fuels.includes(f)) return f;
  if (f === '' && allowDistance) return '';
  return prefs.fuels[0];
}

// items : [{s, dist}] -> triés + filtrés (stations proposant le carburant trié, ou au moins un carburant choisi).
export function sortItems(items, fuel) {
  if (!fuel) return items.filter(it => prefs.fuels.some(f => visiblePrice(it.s, f))).sort((a, b) => a.dist - b.dist);
  const out = [];
  for (const it of items) { const e = visiblePrice(it.s, fuel); if (e) out.push({ ...it, p: e.p }); }
  return out.sort((a, b) => (Math.abs(a.p - b.p) > PRICE_EPS ? a.p - b.p : (a.dist || 0) - (b.dist || 0)));
}

export function sortSelect(id, fuel, allowDistance, label = 'Trier par', action = 'sort') {
  const opts = (allowDistance ? [`<option value=""${fuel === '' ? ' selected' : ''}>Distance</option>`] : [])
    .concat(prefs.fuels.map(f => `<option value="${f}"${f === fuel ? ' selected' : ''}>Prix ${f}</option>`)).join('');
  return `<label class="sort-l" for="${id}">${label}</label><select id="${id}" class="inp inp-sm" data-change="${action}">${opts}</select>`;
}

// Une ligne de liste (lien vers la fiche station).
export function stationRow(it, { fuel, min, rank, showDist = true, cls } = {}) {
  const s = it.s;
  let c = cls;
  if (c === undefined) c = fuel && Number.isFinite(min) && Number.isFinite(it.p) ? classFor(it.p - min) : '';
  const others = prefs.fuels.filter(f => f !== fuel);
  const main = fuel ? ptag(s, fuel, c) : '';
  const minor = minorPrices(s, fuel ? others : prefs.fuels);
  const meta = [showDist && Number.isFinite(it.dist) ? `<span class="s-dist">${fmtKm(it.dist)}</span>` : '', minor].filter(Boolean).join('');
  const tank = fuel && Number.isFinite(it.p) ? tankTxt(it.p) : '';
  return `<a class="s-item" href="#s/${encodeURIComponent(s.id)}">${rank ? `<span class="s-rank">${rank}</span>` : ''}<span class="s-info"><span class="s-name"><span class="s-name-t">${E(s.name)}</span></span><span class="s-addr">${E(s.addr)}${s.addr ? ', ' : ''}${E(s.cp)} ${E(s.city)}</span>${meta ? `<span class="s-meta">${meta}</span>` : ''}</span><span class="s-price">${main}${tank ? `<span class="tank">plein ${tank}</span>` : ''}</span></a>`;
}

// Liste paginée. `key` identifie la liste pour le bouton « Voir plus ».
// `classOf(item, index)` impose la couleur des prix (sinon : écart au moins cher de la liste).
export function listHtml(items, fuel, { key, ranks = false, showDist = true, empty = '', limit = state.listLimit, classOf } = {}) {
  if (!items.length) return empty;
  const lim = Math.max(PAGE, limit || 0);
  const min = fuel ? items[0].p : NaN;
  const shown = items.slice(0, lim);
  let h = `<div class="card card-list">${shown.map((it, i) => stationRow(it, { fuel, min, rank: ranks ? i + 1 : 0, showDist, cls: classOf ? classOf(it, i) : undefined })).join('')}</div>`;
  if (items.length > lim) h += `<button type="button" class="btn btn-more" data-act="more" data-list="${E(key)}">Afficher ${Math.min(PAGE, items.length - lim)} de plus <span class="u-text-muted">(${plural(items.length - lim, 'restante', 'restantes')})</span></button>`;
  return h;
}

// Bandeau « Meilleurs prix » : un pavé par carburant choisi (le moins cher du lot, à égalité le plus proche).
export function bestBand(items, title = 'Meilleurs prix') {
  const cards = prefs.fuels.map(f => {
    const b = pickBest(items, f);
    if (!b) return '';
    const t = tankTxt(b.p);
    return `<a class="best-c" href="#s/${encodeURIComponent(b.s.id)}"><span class="best-f"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</span><span class="best-v">${fmtEur(b.p)}</span><span class="best-n">${E(b.s.name)}</span><span class="best-d">${E(b.s.city)}${b.dist ? ` · ${fmtKm(b.dist)}` : ''}</span>${t ? `<span class="tank">plein ${t}</span>` : ''}</a>`;
  }).join('');
  return cards ? `<section class="best" aria-label="${E(title)}"><h2 class="sec-l">${E(title)}</h2><div class="best-g">${cards}</div></section>` : '';
}

// Marqueurs de carte pour une liste triée : vert / orange = les bonnes affaires, bleu neutre pour le reste
// (une carte couverte de rouge alarme sans aider à choisir).
export function markersFor(items, fuel, max = 300) {
  const min = fuel && items.length ? items[0].p : NaN;
  return items.slice(0, max).map((it, i) => ({
    lat: it.s.lat, lon: it.s.lon, id: it.s.id, label: it.s.name, sub: `${it.s.addr}, ${it.s.city}`,
    price: it.p, cls: fuel && Number.isFinite(min) ? classFor(it.p - min).replace('dear', '') : '', rank: fuel && i < 3 ? String(i + 1) : ''
  }));
}
