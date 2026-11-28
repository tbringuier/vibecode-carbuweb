// station.js — Fiche station (#s/<id>) : prix et contexte local, alternatives, horaires, carte, historique.
import { state, prefs, FUELS, PRICE_EPS, pushRecent } from './state.js';
import { $, E, ICON, hav, fmtP, fmtEur, fmtEur2, fmtCts, fmtKm, notice, loader, shortDay, NEAR_KM } from './helpers.js';
import { station, zoneStats } from './data.js';
import { visiblePrice, freshText, freshCls } from './freshness.js';
import { neighbours, localRank, classFor, pickBest, tankSize } from './prices.js';
import { openStatus, hoursTable } from './hours.js';
import { mapSlot, renderMap } from './map.js';
import { setHeader, starBtn, shareBtn } from './navigation.js';
import { renderStationHistory } from './history.js';

const ord = n => (n === 1 ? '1<sup>re</sup>' : `${n}<sup>e</sup>`);

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
  const origin = state.origin || (state.geo ? { ...state.geo, label: 'votre position' } : null);
  const dist = origin ? hav(origin.lat, origin.lon, s.lat, s.lon) : NaN;
  setHeader(s.name, [s.city, s.brand && s.name !== s.brand ? s.brand : ''].filter(Boolean).join(' · '), starBtn(isFav, 'cette station') + shareBtn());

  const st = openStatus(s);
  const badges = [
    st ? `<span class="badge ${st.open ? (st.soon ? 'badge-warn' : 'badge-ok') : 'badge-off'}">${ICON.clock} ${st.auto ? 'Automate' : st.open ? 'Ouvert' : 'Fermé'} · ${E(st.label)}</span>` : '',
    Number.isFinite(dist) ? `<span class="badge">${ICON.pin} ${fmtKm(dist)} de ${E(origin.label === 'Ma position' ? 'votre position' : origin.label)}</span>` : ''
  ].join('');
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  const osm = s.osm ? `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[s.osm[0]]}/${s.osm.slice(1)}` : '';

  $('d-body').innerHTML = `<div class="st-grid">
    <div class="st-main">
      <section class="card st-head">
        <p class="st-addr">${E(s.addr)}<br>${E(s.cp)} ${E(s.city)}</p>
        ${badges ? `<div class="st-badges">${badges}</div>` : ''}
        <div class="st-actions">
          <a class="btn btn-p btn-sm" href="${dir}" target="_blank" rel="noopener">${ICON.route} Itinéraire</a>
          <button type="button" class="btn btn-sm${isFav ? ' btn-star-on' : ''}" data-act="fav-current" aria-pressed="${isFav}">${isFav ? ICON.star : ICON.starO} ${isFav ? 'Dans vos favoris' : 'Ajouter aux favoris'}</button>
          ${osm ? `<a class="btn btn-g btn-sm" href="${osm}" target="_blank" rel="noopener">${ICON.map} OpenStreetMap</a>` : ''}
        </div>
      </section>
      ${pricesSection(s)}
      ${alternatives(s)}
    </div>
    <aside class="st-side">
      ${mapSlot('station-map', 'd-map d-map-sm')}
      ${hoursSection(s, st)}
    </aside>
  </div>
  <section class="hist" aria-labelledby="hist-t">
    <h2 id="hist-t" class="sec-l">${ICON.history} Historique des prix</h2>
    <div id="hist-body" class="card hist-card" data-sid="${E(s.id)}">${loader('Chargement de l’historique…')}</div>
  </section>`;

  const markers = [{ lat: s.lat, lon: s.lon, label: s.name, sub: `${s.addr}, ${s.city}` }];
  renderMap('station-map', markers, origin ? { center: { lat: origin.lat, lon: origin.lon, label: origin.label } } : {});
  renderStationHistory(s.id);
}

function pricesSection(s) {
  const stats = zoneStats().dep[s.dept];
  const cards = [];
  for (const f of prefs.fuels) {
    const e = s.fuels[f];
    if (!e) {
      if (s.rupt?.[f] != null) cards.push(`<div class="p-card out"><div class="p-card-h"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</div><div class="p-card-v p-card-na">Rupture</div><div class="p-card-d">depuis le ${shortDay(s.rupt[f])}</div></div>`);
      continue;
    }
    const vis = visiblePrice(s, f);
    if (!vis) {
      cards.push(`<div class="p-card stale"><div class="p-card-h"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</div><div class="p-card-v">${fmtP(e.p)}<span class="p-card-u"> €/L</span></div><div class="p-card-d old">Mis à jour ${E(freshText(e))}</div><div class="p-card-note">Prix ancien : masqué dans les listes (voir Réglages)</div></div>`);
      continue;
    }
    const rk = localRank(s, f);
    const cls = rk && rk.of > 1 ? classFor(e.p - rk.min) : '';
    const avg = stats?.[f]?.avg;
    let cmp = '';
    if (Number.isFinite(avg)) {
      const dv = e.p - avg, flat = Math.abs(dv) <= PRICE_EPS;
      cmp = `<div class="p-card-cmp"><span class="delta ${flat ? 'flat' : dv < 0 ? 'down' : 'up'}">${flat ? 'Pile' : fmtCts(Math.abs(dv)).replace('+', '')}</span> ${flat ? 'dans' : dv < 0 ? 'sous' : 'au-dessus de'} la moyenne du département</div>`;
    }
    const rank = rk && rk.of > 1 ? `<div class="p-rank">${rk.rank === 1 ? '<b>La moins chère</b>' : `<b>${ord(rk.rank)}</b> moins chère`} sur ${rk.of} à ${fmtKm(NEAR_KM).slice(1)}</div>` : '';
    const t = tankSize();
    cards.push(`<div class="p-card ${cls}"><div class="p-card-h"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span>${f}</div><div class="p-card-v">${fmtP(e.p)}<span class="p-card-u"> €/L</span></div>${rank}${cmp}${t ? `<div class="p-card-t">Plein ${t} L ≈ <b>${fmtEur2(e.p * t)}</b></div>` : ''}<div class="p-card-d ${freshCls(e)}">Mis à jour ${E(freshText(e))}</div></div>`);
  }
  const others = FUELS.filter(f => !prefs.fuels.includes(f) && visiblePrice(s, f));
  const otherHtml = others.length ? `<p class="p-others"><span>Autres carburants</span>${others.map(f => `<span class="mp"><span class="sw sw-${f.toLowerCase()}" aria-hidden="true"></span><span class="mp-f">${f}</span> ${fmtEur(s.fuels[f].p)}</span>`).join('')}</p>` : '';
  const legend = `<p class="p-legend">Couleurs par rapport aux stations à moins de ${fmtKm(NEAR_KM).slice(1)} : <span class="lg-dot cheap"></span>la moins chère <span class="lg-dot mid"></span>à moins de 3 ct <span class="lg-dot dear"></span>plus chère</p>`;
  const body = cards.length ? `<div class="p-grid">${cards.join('')}</div>${legend}` : notice('Aucun des carburants choisis', 'Cette station ne propose pas les carburants sélectionnés.');
  return `<section class="prices" aria-labelledby="p-t"><h2 id="p-t" class="sec-l">Prix</h2>${body}${otherHtml}</section>`;
}

// Stations voisines moins chères (ou proposant un carburant absent ici), regroupées par station.
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
    const parts = g.fuels.map(x => `<span class="alt-f"><span class="mp-f">${x.f}</span> ${fmtEur(x.p)}${x.save != null ? ` <span class="delta down">${fmtCts(-x.save)}</span>${t ? ` <span class="u-text-muted">(${fmtEur2(-x.save * t)} le plein)</span>` : ''}` : ' <span class="u-text-muted">non proposé ici</span>'}</span>`).join('');
    return `<a class="alt" href="#s/${encodeURIComponent(g.s.id)}"><span class="alt-body"><span class="alt-name">${E(g.s.name)} <span class="alt-dist">${fmtKm(g.dist)}</span></span><span class="alt-meta">${parts}</span></span>${ICON.chev}</a>`;
  }).join('');
  return `<section aria-labelledby="alt-t"><h2 id="alt-t" class="sec-l">Moins cher à proximité</h2><div class="alts">${rows}</div></section>`;
}

function hoursSection(s, st) {
  const h = s.hours;
  if (!h) return `<section class="card st-hours"><h2 class="sec-l">Horaires</h2><p class="st-hours-na">Non communiqués par la station.</p></section>`;
  const auto = h.auto ? `<p class="b24">${ICON.clock} Automate 24h/24 : paiement par carte à toute heure</p>` : '';
  return `<section class="card st-hours"><h2 class="sec-l">Horaires${st && !st.auto ? ` <span class="badge ${st.open ? 'badge-ok' : 'badge-off'}">${st.open ? 'Ouvert' : 'Fermé'}</span>` : ''}</h2>${auto}${hoursTable(s)}</section>`;
}
