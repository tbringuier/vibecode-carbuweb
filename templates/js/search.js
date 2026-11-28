// search.js — Recherche de l'accueil : zones et stations locales (instantané), puis villes et
// adresses via Nominatim (OpenStreetMap, externe : requête débouncée et annulable) ; récents.
import { state, prefs, favKey, clearRecent } from './state.js';
import { $, E, ICON, norm, notice, loader, hav, plural } from './helpers.js';
import { searchIndex, cpIndex, zoneIndex, station } from './data.js';
import { hasVisibleFuel, visiblePrice } from './freshness.js';
import { stationRow, sortFuelFor } from './lists.js';
import { nearHash, zoneHash } from './navigation.js';

const MAX_STATIONS = 30;
// Réponses Nominatim gardées pour la session : redessiner (changement de carburant…) ne relance pas l'API.
const osmCache = new Map();

export function onSearchInput() {
  clearTimeout(state.searchT);
  $('sclear').hidden = !$('sinput').value;
  state.searchT = setTimeout(doSearch, 300);
}
export function clearSearch() { $('sinput').value = ''; $('sclear').hidden = true; doSearch(); $('sinput').focus(); }

const zoneRow = (href, name, sub) => `<a class="s-item" href="${href}"><span class="s-info"><span class="s-name"><span class="s-name-t">${E(name)}</span></span><span class="s-addr">${sub}</span></span>${ICON.chev}</a>`;
const group = (title, body, extra = '') => `<section class="s-group"><h2 class="sec-l">${title}${extra}</h2><div class="card card-list">${body}</div></section>`;

export async function doSearch() {
  state.searchAC?.abort();
  const ac = state.searchAC = new AbortController();
  const q = $('sinput').value.trim();
  const n = norm(q);
  const res = $('sresults');
  $('recent').classList.toggle('hidden', !!n);
  $('onboard').classList.toggle('hidden', !!n || prefs.welcomed);
  if (!n) { res.innerHTML = ''; renderRecent(); return; }
  if (n.length < 2) { res.innerHTML = ''; return; }
  const zi = zoneIndex();
  const digits = /^\d+$/.test(n);
  // Numéro de département (01, 69, 974, 2A, 20 = Corse) ; sinon début de code postal (« 130 » → 130xx).
  const codeMatch = d => d.code.toLowerCase() === n || (n === '20' && /^2[ab]$/i.test(d.code));
  const depts = /^(\d{2,3}|2[ab])$/.test(n) ? zi.depts.filter(codeMatch) : digits ? [] : zi.depts.filter(d => d.n.includes(n));
  const isDeptCode = depts.length > 0 && /^(\d{2,3}|2[ab])$/.test(n);
  const regs = digits || isDeptCode ? [] : zi.regions.filter(r => r.n.includes(n));
  let found = [];
  if (/^\d{5}$/.test(n)) found = cpIndex().get(n) || [];
  else if (digits && n.length >= 3 && !isDeptCode) { for (const [cp, list] of cpIndex()) if (cp.startsWith(n)) found.push(...list); }
  else if (!isDeptCode && n.length >= 3) {
    const words = n.split(' ');
    for (const [t, s] of searchIndex()) {
      if (words.every(w => t.includes(w))) { found.push(s); if (found.length >= 200) break; }
    }
  }
  found = found.filter(s => hasVisibleFuel(s, prefs.fuels));
  // Avec une position connue : les stations les plus proches d'abord.
  const g = state.geo;
  const items = found.map(s => ({ s, dist: g ? hav(g.lat, g.lon, s.lat, s.lon) : NaN }));
  if (g) items.sort((a, b) => a.dist - b.dist);
  const fuel = sortFuelFor(false);
  for (const it of items) it.p = visiblePrice(it.s, fuel)?.p;

  let h = '';
  if (regs.length) h += group('Régions', regs.map(r => zoneRow(zoneHash('r', r.name), r.name, plural(r.count, 'station', 'stations'))).join(''));
  if (depts.length) h += group('Départements', depts.slice(0, 12).map(d => zoneRow(zoneHash('d', d.code), `${d.name} (${d.code})`, `${E(d.region)} · ${plural(d.count, 'station', 'stations')}`)).join(''));
  const useOsm = !isDeptCode && n.length >= 3 && (!digits || n.length === 5);
  if (useOsm) h += `<div id="osm-slot">${loader('Recherche de villes et d’adresses…')}</div>`;
  if (items.length) {
    const more = items.length > MAX_STATIONS ? ` <span class="sec-count">${MAX_STATIONS} sur ${items.length}</span>` : '';
    h += group(`Stations${g ? ' · les plus proches d’abord' : ''}`, items.slice(0, MAX_STATIONS).map(it => stationRow(it, { fuel: it.p != null ? fuel : null, cls: '', showDist: !!g })).join(''), more);
  }
  if (!h) { res.innerHTML = notice('Aucun résultat', 'Essayez un nom de ville, un code postal ou un numéro de département.'); return; }
  res.innerHTML = h;
  if (!useOsm) return;

  let osm = '';
  try {
    const key = n;
    if (!osmCache.has(key)) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=fr&limit=5&accept-language=fr`;
      const r = await fetch(url, { signal: ac.signal });
      if (r.ok) osmCache.set(key, await r.json());
    }
    if (osmCache.has(key)) {
      const seen = new Set();
      const places = osmCache.get(key).filter(p => {
        const k = `${p.name || p.display_name.split(',')[0]}|${(+p.lat).toFixed(3)}|${(+p.lon).toFixed(3)}`;
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      osm = places.map(p => {
        const name = (p.name || p.display_name.split(',')[0]).trim();
        const desc = p.display_name.split(',').slice(1, -2).join(',').trim();
        const lat = +p.lat, lon = +p.lon;
        const on = prefs.favs.some(f => f.type === 'address' && f.id === favKey(lat, lon));
        return `<div class="s-item s-place"><a class="s-link" href="${nearHash(lat, lon, name)}"><span class="s-info"><span class="s-name"><span class="s-name-t">${E(name)}</span></span><span class="s-addr">${E(desc)}</span></span></a><button type="button" class="btn btn-g btn-i${on ? ' btn-star-on' : ''}" data-act="fav-place" data-lat="${lat}" data-lon="${lon}" data-name="${E(name)}" aria-pressed="${on}" aria-label="${on ? 'Retirer' : 'Ajouter'} ${E(name)} ${on ? 'des' : 'aux'} favoris">${on ? ICON.star : ICON.starO}</button></div>`;
      }).join('');
    }
  } catch (e) { if (e.name !== 'AbortError') console.warn('Nominatim', e); }
  if (ac.signal.aborted) return;
  const slot = $('osm-slot');
  if (slot) slot.outerHTML = osm ? group('Villes et adresses <span class="pill">OpenStreetMap</span>', osm) : '';
  if (!res.textContent.trim()) res.innerHTML = notice('Aucun résultat', 'Essayez un autre nom de ville ou un code postal.');
}

// Récents : lieux cherchés et stations consultées (stockés sur l'appareil uniquement).
export function renderRecent() {
  const box = $('recent'); if (!box) return;
  const fuel = sortFuelFor(false);
  const rows = prefs.recent.map(r => {
    if (r.t === 'p') return `<a class="s-item" href="${nearHash(r.lat, r.lon, r.label)}"><span class="s-ico">${ICON.pin}</span><span class="s-info"><span class="s-name"><span class="s-name-t">${E(r.label)}</span></span><span class="s-addr">Stations autour de ce lieu</span></span>${ICON.chev}</a>`;
    const s = station(r.id);
    if (!s) return '';
    const e = visiblePrice(s, fuel);
    return stationRow({ s, dist: NaN, p: e?.p }, { fuel: e ? fuel : null, cls: '', showDist: false });
  }).filter(Boolean);
  if (!rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="sec-h"><h2 class="sec-l">${ICON.history} Récents</h2><button type="button" class="btn btn-g btn-sm" data-act="recent-clear">Effacer</button></div><div class="card card-list">${rows.join('')}</div>`;
}
export function clearRecentList() { clearRecent(); renderRecent(); }
