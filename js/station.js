import { state, prefs, FUELS, PRICE_EPS, pushRecent } from './state.js?v=1795897500';
import { $, E, ICON, hav, fmtP, fmtEur, fmtEur2, fmtCts, fmtKm, notice, loader, shortDay, NEAR_KM } from './helpers.js?v=1795897500';
import { station, zoneStats } from './data.js?v=1795897500';
import { visiblePrice, freshText, freshCls } from './freshness.js?v=1795897500';
import { neighbours, localRank, classFor, pickBest, tankSize } from './prices.js?v=1795897500';
import { fuelChips } from './filters.js?v=1795897500';
import { goButton } from './directions.js?v=1795897500';
import { mapSlot, renderMap } from './map.js?v=1795897500';
import { setHeader, starBtn, shareBtn } from './navigation.js?v=1795897500';
import { renderStationHistory } from './history.js?v=1795897500';
const ord = n => (n === 1 ? '1<sup>re</sup>' : `${n}<sup>e</sup>`);
const nearTxt = () => fmtKm(NEAR_KM).slice(1);
export const favBtn = on => `<button type="button" class="btn${on ? ' btn-star-on' : ''}" data-act="fav-current" aria-pressed="${on}">${on ? ICON.star : ICON.starO} ${on ? 'Dans vos favoris' : 'Ajouter aux favoris'}</button>`;
export function renderStation(r) {
  const s = station(r.id);
  if (!s) {
    const fav = prefs.favs.find(f => f.type === 'station' && f.id === r.id);
    setHeader(fav?.name || 'Station introuvable');
    $('d-body').innerHTML = notice('Station absente des données du jour', fav ? 'Elle reste dans vos favoris : elle réapparaîtra si la source officielle la republie.' : 'Ce lien ne correspond à aucune station publiée aujourd’hui.');
    return;
  }
  pushRecent({ t: 's', id: s.id });
  const isFav = prefs.favs.some(f => f.type === 'station' && f.id === s.id);
  const origin = state.origin || (state.geo ? { ...state.geo, label: 'Ma position' } : null);
  const dist = origin ? hav(origin.lat, origin.lon, s.lat, s.lon) : NaN;
  setHeader(s.name, [s.city, s.brand && s.name !== s.brand ? s.brand : ''].filter(Boolean).join(' · '), starBtn(isFav, 'cette station') + shareBtn());
  const distTxt = Number.isFinite(dist) ? `<span class="badge">${ICON.pin} ${fmtKm(dist)} de ${E(origin.label === 'Ma position' ? 'votre position' : origin.label)}</span>` : '';
  $('d-body').innerHTML = `<div class="st-grid">
    <section class="card st-head" aria-label="Adresse et itinéraire">
      <div class="st-addr-row"><p class="st-addr">${E(s.addr)}<br>${E(s.cp)} ${E(s.city)}</p>${distTxt}</div>
      <div class="st-actions">${goButton(s)}${favBtn(isFav)}</div>
    </section>
    ${pricesSection(s)}
    ${alternatives(s) || '<div class="st-alts"></div>'}
    <div class="st-map">${mapSlot('station-map', 'd-map d-map-sm')}</div>
  </div>
  <section class="hist" aria-labelledby="hist-t">
    <h2 id="hist-t" class="sec-l">${ICON.history} Historique des prix</h2>
    <div id="hist-body" class="card hist-card" data-sid="${E(s.id)}">${loader('Chargement de l’historique…')}</div>
  </section>`;
  const pf = prefs.fuels.find(f => visiblePrice(s, f));
  const pp = pf ? visiblePrice(s, pf).p : NaN;
  const markers = [{ lat: s.lat, lon: s.lon, label: s.name, sub: `${s.addr}, ${s.city}`, id: s.id, link: false, fuel: pf, price: pp, pill: pf ? `${pf} ${fmtEur(pp)}` : '' }];
  renderMap('station-map', markers, origin ? { center: { lat: origin.lat, lon: origin.lon, label: origin.label } } : {});
  renderStationHistory(s.id);
}
function pricesSection(s) {
  const stats = zoneStats().dep[s.dept];
  const cards = [];
  for (const f of prefs.fuels) {
    const e = s.fuels[f];
    const head = `<div class="p-card-h"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</div>`;
    if (!e) {
      cards.push(s.rupt?.[f] != null
        ? `<div class="p-card out">${head}<div class="p-card-v p-card-na">En rupture</div><div class="p-card-d">depuis le ${shortDay(s.rupt[f])}</div></div>`
        : `<div class="p-card absent">${head}<div class="p-card-v p-card-na">Non vendu ici</div></div>`);
      continue;
    }
    if (!visiblePrice(s, f)) {
      cards.push(`<div class="p-card stale">${head}<div class="p-card-v">${fmtP(e.p)}<span class="p-card-u"> €/L</span></div><div class="p-card-d old">Mis à jour ${E(freshText(e))}</div><div class="p-card-note">Prix trop ancien : masqué dans les listes</div></div>`);
      continue;
    }
    const rk = localRank(s, f);
    const cls = rk && rk.of > 1 ? classFor(e.p - rk.min) : '';
    const rank = rk && rk.of > 1 ? `<div class="p-rank">${rk.rank === 1 ? '<b>La moins chère</b>' : `<b>${ord(rk.rank)}</b> moins chère`} sur ${rk.of}</div>` : '';
    let cmp = '';
    const avg = stats?.[f]?.avg;
    if (Number.isFinite(avg)) {
      const dv = e.p - avg, flat = Math.abs(dv) <= PRICE_EPS;
      cmp = `<div class="p-card-cmp"><span class="delta ${flat ? 'flat' : dv < 0 ? 'down' : 'up'}">${flat ? 'Dans' : `${fmtCts(Math.abs(dv)).replace('+', '')} ${dv < 0 ? 'sous' : 'au-dessus de'}`}</span> la moyenne du département</div>`;
    }
    const t = tankSize();
    const tank = t ? `<div class="p-card-t">Plein de ${t} L ≈ <b>${fmtEur2(e.p * t)}</b></div>` : '';
    cards.push(`<div class="p-card ${cls}">${head}<div class="p-card-v">${fmtP(e.p)}<span class="p-card-u"> €/L</span></div>${rank}${cmp}${tank}<div class="p-card-d ${freshCls(e)}">Mis à jour ${E(freshText(e))}</div></div>`);
  }
  const others = FUELS.filter(f => !prefs.fuels.includes(f) && visiblePrice(s, f));
  const otherHtml = others.length ? `<p class="p-others"><span>Autres carburants vendus ici</span>${others.map(f => `<span class="mp"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span><span class="mp-f">${f}</span> ${fmtEur(s.fuels[f].p)}</span>`).join('')}</p>` : '';
  const legend = `<p class="p-legend">Rang et couleur parmi les stations à moins de ${nearTxt()} : <span class="lg-dot cheap"></span>la moins chère <span class="lg-dot mid"></span>à moins de 3 ct <span class="lg-dot dear"></span>plus chère</p>`;
  return `<section class="prices st-prices" aria-labelledby="p-t"><h2 id="p-t" class="sec-l">Prix</h2>
    <div class="card prices-card">${fuelChips()}<div class="p-grid">${cards.join('')}</div>${legend}</div>${otherHtml}</section>`;
}
function alternatives(s) {
  const near = neighbours(s);
  const grp = new Map();
  for (const f of prefs.fuels) {
    const b = pickBest(near, f);
    if (!b) continue;
    const here = visiblePrice(s, f);
    if (here && b.p >= here.p - PRICE_EPS) continue;
    if (!grp.has(b.s.id)) grp.set(b.s.id, { s: b.s, dist: b.dist, fuels: [] });
    grp.get(b.s.id).fuels.push({ f, p: b.p, save: here ? here.p - b.p : null });
  }
  if (!grp.size) return '';
  const t = tankSize();
  const rows = [...grp.values()].sort((a, b) => a.dist - b.dist).slice(0, 5).map(g => {
    const parts = g.fuels.map(x => `<span class="alt-f"><span class="mp-f">${x.f}</span> ${fmtEur(x.p)}${x.save != null ? ` <span class="delta down">${fmtCts(-x.save)}</span>${t ? ` <span class="u-text-muted">(${fmtEur2(x.save * t)} économisés sur le plein)</span>` : ''}` : ' <span class="u-text-muted">(non vendu ici)</span>'}</span>`).join('');
    return `<a class="alt" href="#s/${encodeURIComponent(g.s.id)}"><span class="alt-body"><span class="alt-name">${E(g.s.name)} <span class="alt-dist">${E(g.s.city)} · ${fmtKm(g.dist)}</span></span><span class="alt-meta">${parts}</span></span>${ICON.chev}</a>`;
  }).join('');
  return `<section class="st-alts" aria-labelledby="alt-t"><h2 id="alt-t" class="sec-l">Moins cher à proximité</h2><div class="alts">${rows}</div></section>`;
}