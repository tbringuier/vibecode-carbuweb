import { state, radius, uFuels, favs, setFavs, saveFavs, maxAge } from './state.js';
import { E, coord, hav, fmtKm, maxKmFav, toast, stationName } from './helpers.js';
import { pClass, pickBest, tankInline } from './prices.js';
import { freshPill, isExpired } from './freshness.js';
import { TouchDragReorder } from './drag-drop.js';
import { showStation } from './station.js';
import { findNear } from './geolocation.js';

export function favKey(lat, lon) { const a = coord(lat), o = coord(lon); return (Number.isFinite(a) && Number.isFinite(o)) ? `${a.toFixed(6)}-${o.toFixed(6)}` : ''; }
export function migrateFavs() { let ch = false; const seen = new Set(), next = []; for (const f of favs) { if (f.type !== 'address') { next.push(f); continue; } const a = coord(f.lat), o = coord(f.lon); if (!Number.isFinite(a) || !Number.isFinite(o)) { ch = true; continue; } const k = favKey(a, o); if (!k || seen.has(k)) { ch = true; continue; } seen.add(k); if (f.id !== k || f.lat !== a || f.lon !== o) ch = true; next.push({ ...f, id: k, lat: a, lon: o }); } if (ch) { setFavs(next); saveFavs(); } }

export function toggleFavAddr(lat, lon, name) {
  const a = coord(lat), o = coord(lon); if (!Number.isFinite(a) || !Number.isFinite(o)) return;
  const k = favKey(a, o), i = favs.findIndex(f => f.type === 'address' && favKey(f.lat, f.lon) === k);
  if (i > -1) favs.splice(i, 1); else favs.push({ id: k, type: 'address', name, lat: a, lon: o });
  saveFavs(); renderFavs();
  const is = i === -1;
  document.querySelectorAll(`[data-favkey="${k}"]`).forEach(btn => {
    btn.classList.toggle('btn-star-on', is);
    btn.textContent = is ? '★' : '☆';
    btn.setAttribute('aria-label', is ? 'Retirer des favoris' : 'Ajouter aux favoris');
  });
  window.syncHeaderFav?.();
  toast(i > -1 ? 'Lieu retiré' : 'Lieu ajouté aux favoris');
}
export function toggleFavStation() {
  const sid = document.getElementById('station-view').getAttribute('data-sid');
  const s = state.db.stations[sid], i = favs.findIndex(f => f.id === sid);
  if (i > -1) favs.splice(i, 1); else favs.push({ id: sid, type: 'station', name: stationName(s), adresse: `${s.adresse}, ${s.ville}` });
  saveFavs(); renderFavs(); toast(i > -1 ? 'Station retirée' : 'Station ajoutée');
  showStation(sid);
}
export function removeFav(id) { setFavs(favs.filter(f => f.id !== id)); saveFavs(); renderFavs(); toast('Favori retiré'); }
export function adjFavR(id, d) { const i = favs.findIndex(f => f.id === id); if (i === -1) return; const f = favs[i]; favs[i] = { ...f, radius: Math.max(1, Math.min(100, (f.radius ? +f.radius : radius) + d)) }; saveFavs(); renderFavs(); }

export function renderFavs() {
  const box = document.getElementById('fav-box'), list = document.getElementById('fav-list');
  migrateFavs();
  setFavs(favs.filter(f => f.type !== 'station' || (state.db && state.db.stations[f.id]))); saveFavs();
  if (!favs.length) { box.classList.add('hidden'); if (state.favDnD) { state.favDnD.destroy(); state.favDnD = null; } return; }
  box.classList.remove('hidden');
  const stationView = document.getElementById('station-view');
  const activeStationId = stationView && !stationView.classList.contains('hidden') ? stationView.getAttribute('data-sid') : '';
  const activeAddressId = state.proxSearch ? favKey(state.proxSearch.lat, state.proxSearch.lon) : '';
  let h = '';
  for (let i = 0; i < favs.length; i++) {
    const f = favs[i];
    if (f.type === 'station') {
      const st = state.db?.stations[f.id];
      const activeCls = activeStationId === f.id ? ' is-active' : '';
      const fid = String(f.id).replace(/'/g, "\\'");
      let section = '<div class="fav-note">Aucun prix visible avec les filtres actuels.</div>';
      if (st?.carburants_disponibles) {
        const tags = [];
        for (const [c, d] of Object.entries(st.carburants_disponibles)) {
          if (!uFuels.includes(c)) continue;
          if (isExpired(d, maxAge)) continue;
          const cls = pClass(f.id, c, d.prix), fp = freshPill(d);
          tags.push(`<div class="ptag ${cls}"><span class="ptag-f">${c}</span><span class="ptag-v">${d.prix}€</span>${fp}${tankInline(parseFloat(d.prix))}</div>`);
        }
        if (tags.length) section = `<div class="fav-section"><div class="fav-section-title">Prix suivis</div><div class="fav-p">${tags.join('')}</div></div>`;
      }
      h += `<article data-di="${i}" class="fav fav-station${activeCls}"><div class="fav-card"><div class="fav-top"><div class="fav-rail"><span class="fav-h" title="Déplacer">⠿</span><span class="fav-kind">Station</span><span class="fav-name-inline">⛽ ${E(f.name)}</span></div><button type="button" class="btn btn-g btn-i btn-sm fav-r" onclick="removeFav('${fid}')" aria-label="Retirer la station des favoris">✕</button></div><button type="button" class="fav-main" onclick="showStation('${fid}')"><div class="fav-s">${E(f.adresse)}</div><div class="fav-cta">${activeCls ? 'Station ouverte actuellement' : 'Voir le détail de la station'}</div></button>${section}</div></article>`;
    } else {
      const fr = f.radius ? +f.radius : radius;
      const activeCls = activeAddressId === f.id ? ' is-active' : '';
      const fid = String(f.id).replace(/'/g, "\\'");
      let section = `<div class="fav-note">Aucune station compatible n'a été trouvée dans ${fr}\u202fkm.</div>`;
      if (state.db && f.lat && f.lon) {
        const la = coord(f.lat), lo = coord(f.lon);
        if (Number.isFinite(la) && Number.isFinite(lo)) {
          const near = [], mk = maxKmFav(f);
          for (const [id, s] of Object.entries(state.db.stations)) { if (!s.lat || !s.lon || !uFuels.some(fu => s.carburants_disponibles[fu] && !isExpired(s.carburants_disponibles[fu], maxAge))) continue; const dist = hav(la, lo, s.lat, s.lon); if (dist <= mk) near.push({ id, station: s, dist }); }
          const cards = [];
          uFuels.forEach(fuel => {
            const b = pickBest(near, fuel);
            if (b) {
              const sn = f.name.replace(/'/g, "\\'");
              cards.push(`<div class="best-c" role="button" tabindex="0" onclick="event.stopPropagation();showStationFav('${b.id}',${f.lat},${f.lon},'${sn}')"><div class="best-f">${fuel}</div><div class="best-v">${b.prix.toFixed(3)}€</div>${tankInline(b.prix)}<div class="best-n">${E(b.nom)}</div><div class="best-d">${fmtKm(b.dist)}</div></div>`);
            }
          });
          if (cards.length) section = `<div class="fav-section"><div class="fav-section-title">Meilleurs prix dans ${fr}\u202fkm</div><div class="best-g">${cards.join('')}</div></div>`;
        }
      }
      const sn = f.name.replace(/'/g, "\\'");
      h += `<article data-di="${i}" class="fav fav-address${activeCls}"><div class="fav-card"><div class="fav-top"><div class="fav-rail"><span class="fav-h" title="Déplacer">⠿</span><span class="fav-kind">Lieu</span><span class="fav-name-inline">📍 ${E(f.name)}</span></div><button type="button" class="btn btn-g btn-i btn-sm fav-r" onclick="removeFav('${fid}')" aria-label="Retirer le lieu des favoris">✕</button></div><div class="fav-toolbar"><div class="fav-radius-ctrl"><button type="button" class="btn btn-i btn-sm" onclick="adjFavR('${fid}',-5)" aria-label="Réduire le rayon">−</button><span class="tank">${fr}\u202fkm</span><button type="button" class="btn btn-i btn-sm" onclick="adjFavR('${fid}',5)" aria-label="Augmenter le rayon">+</button></div><button type="button" class="btn btn-p btn-sm fav-see" onclick="findNearFav(${f.lat},${f.lon},'${sn}','${fid}')">${activeCls ? 'Recherche active' : 'Lancer la recherche'}</button></div>${section}</div></article>`;
    }
  }
  list.innerHTML = h;
  if (state.favDnD) state.favDnD.destroy(); state.favDnD = null;
  if (favs.length > 1) state.favDnD = new TouchDragReorder(list, { onReorder: (f, t) => { const [it] = favs.splice(f, 1); favs.splice(t, 0, it); saveFavs(); renderFavs(); } });
}
export function findNearFav(lat, lon, name, fid) { const f = favs.find(x => x.id === fid); findNear(lat, lon, name, f?.radius ? +f.radius : null); }
export function showStationFav(sid, lat, lon, label) { const a = coord(lat), o = coord(lon); state.detailAnchor = (Number.isFinite(a) && Number.isFinite(o)) ? { lat: a, lon: o, label } : null; showStation(sid); }
