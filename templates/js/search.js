import { state, uFuels, favs, FUELS } from './state.js';
import { norm, E, notice, hasFuel, titleCase } from './helpers.js';
import { pClass } from './prices.js';
import { freshPill } from './freshness.js';
import { favKey } from './favorites.js';

export function debouncedSearch() { clearTimeout(state.searchTimeout); state.searchTimeout = setTimeout(doSearch, 400); }

export function renderHomeTeaser() {
  const c = document.getElementById('home-teaser');
  if (!c || !state.db?.dashboard?.national) return;
  const avg = state.db.dashboard.national.avg_prices || {};
  const cards = FUELS
    .filter(f => typeof avg[f] === 'number' && avg[f] > 0)
    .map(f => `<button type="button" class="teaser-card" onclick="jumpToExplorer('${f}')"><span class="teaser-card-f">${E(f)}</span><span class="teaser-card-v">${avg[f].toFixed(3)}<span class="teaser-card-u">\u202f€/L</span></span></button>`)
    .join('');
  if (!cards) return;
  c.innerHTML = `<div class="teaser-head"><h2 id="home-teaser-t" class="teaser-title">Prix moyens en France</h2><button type="button" class="btn btn-sm btn-g teaser-more" onclick="switchTab('explorer')">Voir le classement<span aria-hidden="true"> →</span></button></div><div class="teaser-grid">${cards}</div>`;
  c.classList.remove('hidden');
}

export function jumpToExplorer(fuel) {
  window.switchTab?.('explorer');
  const s = document.getElementById('exp-fuel');
  if (s && fuel) { s.value = fuel; window.findCheapest?.(); }
}

export async function doSearch() {
  if (state.searchAC) state.searchAC.abort();
  state.searchAC = new AbortController();
  const sig = state.searchAC.signal;
  const q = document.getElementById('sinput').value;
  const n = norm(q);
  const res = document.getElementById('sresults');
  state.proxSearch = null;
  state.detailAnchor = null;
  if (n.length < 3) { res.innerHTML = ''; return; }
  res.innerHTML = '<div class="inline-loader"><div class="spinner" aria-hidden="true"></div><p>Recherche en cours…</p></div>';
  let h = '';
  const regs = [], depts = [];
  const isCode = /^\d{2,3}$/.test(n);
  if (isCode && state.db.dept_index[n]) {
    const d = state.db.dept_index[n];
    depts.push({ code: n, nom: d.nom, region: d.region, count: d.stations.length });
  }
  if (!isCode) {
    for (const [c, d] of Object.entries(state.db.dept_index))
      if (d.nom_norm.includes(n)) depts.push({ code: c, nom: d.nom, region: d.region, count: d.stations.length });
    for (const r of Object.values(state.db.region_index))
      if (r.nom_norm.includes(n)) regs.push({ nom: r.nom, count: r.stations.length });
  }
  if (regs.length) {
    h += '<div class="sec-l">Régions</div>';
    regs.forEach(g => {
      h += `<div class="s-item" role="button" tabindex="0" onclick="searchGeo('region','${g.nom.replace(/'/g, "\\'")}')"><div class="s-info"><div class="s-name">${E(g.nom)}</div><div class="s-addr">${g.count} stations</div></div><span class="s-arrow">→</span></div>`;
    });
  }
  if (depts.length) {
    h += '<div class="sec-l">Départements</div>';
    depts.forEach(g => {
      h += `<div class="s-item" role="button" tabindex="0" onclick="searchGeo('dept','${g.nom.replace(/'/g, "\\'")}')"><div class="s-info"><div class="s-name">${E(g.nom)} (${E(g.code)})</div><div class="s-addr">${E(g.region)} · ${g.count} stations</div></div><span class="s-arrow">→</span></div>`;
    });
  }
  const local = [];
  if (!isCode && state.db.cp_index[n]) {
    state.db.cp_index[n].forEach(id => { if (hasFuel(state.db.stations[id])) local.push({ id, station: state.db.stations[id] }); });
  } else if (!isCode) {
    for (const [id, d] of Object.entries(state.db.recherche_texte)) {
      if (d.texte_norm.includes(n) && hasFuel(state.db.stations[id])) local.push({ id, station: state.db.stations[id] });
      if (local.length > 80) break;
    }
  }
  let sHtml = '';
  if (local.length) {
    sHtml += '<div class="sec-l">Stations <span class="pill">data.gouv</span></div>';
    local.forEach(r => {
      const pCol = searchPrices(r.id, r.station);
      const h24 = r.station.horaires?.automate_24_24 ? '<span class="b24-sm">24h</span>' : '';
      sHtml += `<div class="s-item" role="button" tabindex="0" onclick="showStation('${r.id}')"><div class="s-info"><div class="s-name">${E(r.station.nom_osm) || 'Station'}${h24}</div><div class="s-addr">${E(titleCase(r.station.adresse))}, ${E(r.station.code_postal)} ${E(titleCase(r.station.ville))}</div></div><div class="s-prices">${pCol}</div></div>`;
    });
  }
  try {
    const or = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=fr&limit=4`, { signal: sig });
    if (or.ok) {
      const odRaw = await or.json();
      const seen = new Set();
      const od = odRaw.filter(p => {
        const k = p.display_name.split(',')[0].trim() + '|' + (+p.lat).toFixed(3) + '|' + (+p.lon).toFixed(3);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (od.length) {
        h += '<div class="sec-l">Villes & adresses <span class="pill">OSM</span></div>';
        od.forEach(p => {
          const nm = p.display_name.split(',')[0];
          const desc = p.display_name.split(',').slice(1, -2).join(',').trim();
          const k = favKey(p.lat, p.lon);
          const is = k && favs.some(f => f.type === 'address' && favKey(f.lat, f.lon) === k);
          const safeName = nm.replace(/'/g, "\\'");
          h += `<div class="s-item"><div class="s-info" role="button" tabindex="0" onclick="findNear(${p.lat},${p.lon},'${safeName}')"><div class="s-name">${E(nm)}</div><div class="s-addr">${E(desc)}</div></div><button class="btn btn-g btn-i btn-sm${is ? ' btn-star-on' : ''}" type="button" onclick="event.stopPropagation();toggleFavAddr(${p.lat},${p.lon},'${safeName}')" aria-label="${is ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${is ? '★' : '☆'}</button></div>`;
        });
      }
    }
  } catch (e) { if (e.name !== 'AbortError') console.error('OSM', e); }
  h += sHtml;
  if (!h) h = notice('Aucun résultat', 'Essayez un autre mot-clé.');
  if (!sig.aborted) res.innerHTML = h;
}

export function searchPrices(sid, st) {
  const fs = uFuels.filter(f => st.carburants_disponibles[f]);
  const rp = uFuels.filter(f => st.carburants_en_rupture?.[f]).map(f => `<span class="rupt-sm">${f}</span>`).join('');
  if (!fs.length && !rp) return '<span class="s-arrow">→</span>';
  const tags = fs.map(f => {
    const d = st.carburants_disponibles[f];
    const cls = pClass(sid, f, d.prix);
    const fp = freshPill(d);
    return `<div class="ptag ${cls}"><span class="ptag-f">${f}</span><span class="ptag-v">${d.prix}€</span>${fp}</div>`;
  }).join('');
  return tags + rp;
}
