import { state, radius, uFuels, favs, setFavs, saveFavs } from './state.js';
import { E, coord, hav, maxKm, maxKmFav, hasFuel, notice, toast } from './helpers.js';
import { pClass, pickBest } from './prices.js';
import { freshPill } from './freshness.js';
import { TouchDragReorder } from './drag-drop.js';
import { showStation } from './station.js';
import { findNear } from './geolocation.js';

export function favKey(lat, lon) { const a = coord(lat), o = coord(lon); return (Number.isFinite(a) && Number.isFinite(o)) ? `${a.toFixed(6)}-${o.toFixed(6)}` : ''; }
export function migrateFavs() { let ch = false; const seen = new Set(), next = []; for (const f of favs) { if (f.type !== 'address') { next.push(f); continue; } const a = coord(f.lat), o = coord(f.lon); if (!Number.isFinite(a) || !Number.isFinite(o)) { ch = true; continue; } const k = favKey(a, o); if (!k || seen.has(k)) { ch = true; continue; } seen.add(k); if (f.id !== k || f.lat !== a || f.lon !== o) ch = true; next.push({ ...f, id: k, lat: a, lon: o }); } if (ch) { setFavs(next); saveFavs(); } }

export function toggleFavAddr(lat, lon, name) {
  const a = coord(lat), o = coord(lon); if (!Number.isFinite(a) || !Number.isFinite(o)) return;
  const k = favKey(a, o), i = favs.findIndex(f => f.type === 'address' && favKey(f.lat, f.lon) === k);
  if (i > -1) favs.splice(i, 1); else favs.push({ id: k, type: 'address', name, lat: a, lon: o });
  saveFavs(); renderFavs(); toast(i > -1 ? 'Lieu retiré' : 'Lieu ajouté aux favoris');
}
export function toggleFavStation() {
  const sid = document.getElementById('station-view').getAttribute('data-sid');
  const s = state.db.stations[sid], i = favs.findIndex(f => f.id === sid);
  if (i > -1) favs.splice(i, 1); else favs.push({ id: sid, type: 'station', name: s.nom_osm || 'Station', adresse: `${s.adresse}, ${s.ville}` });
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
  let h = '';
  for (let i = 0; i < favs.length; i++) {
    const f = favs[i];
    if (f.type === 'station') {
      const st = state.db?.stations[f.id]; let ph = '';
      if (st?.carburants_disponibles) {
        const tags = [];
        for (const [c, d] of Object.entries(st.carburants_disponibles)) {
          if (!uFuels.includes(c)) continue;
          const cls = pClass(f.id, c, d.prix), fp = freshPill(d);
          tags.push(`<div class="ptag ${cls}"><span class="ptag-f">${c}</span><span class="ptag-v">${d.prix}€</span>${fp}</div>`);
        }
        if (tags.length) ph = `<div class="fav-p">${tags.join('')}</div>`;
      }
      h += `<div data-di="${i}" class="fav"><span class="fav-h" title="Déplacer">⠿</span><div class="fav-b" role="button" tabindex="0" onclick="showStation('${f.id}')"><div class="fav-n">⛽ ${E(f.name)}</div><div class="fav-s">${E(f.adresse)}</div>${ph}</div><button type="button" class="btn btn-g btn-i btn-sm fav-r" onclick="event.stopPropagation();removeFav('${f.id}')" aria-label="Retirer">✕</button></div>`;
    } else {
      const fr = f.radius ? +f.radius : radius;
      let bc = '';
      if (state.db && f.lat && f.lon) {
        const la = coord(f.lat), lo = coord(f.lon);
        if (Number.isFinite(la) && Number.isFinite(lo)) {
          const near = [], mk = maxKmFav(f);
          for (const [id, s] of Object.entries(state.db.stations)) { if (!s.lat || !s.lon || !hasFuel(s)) continue; if (hav(la, lo, s.lat, s.lon) <= mk) near.push({ id, station: s }); }
          const cards = [];
          uFuels.forEach(fuel => {
            const b = pickBest(near, fuel);
            if (b) {
              const sn = f.name.replace(/'/g, "\\'");
              cards.push(`<div class="best-c" role="button" tabindex="0" onclick="event.stopPropagation();showStationFav('${b.id}',${f.lat},${f.lon},'${sn}')"><div class="best-f">${fuel}</div><div class="best-v">${b.prix.toFixed(3)}€</div><div class="best-n">${E(b.nom)}</div></div>`);
            }
          });
          if (cards.length) bc = `<div class="best-g">${cards.join('')}</div>`;
        }
      }
      const si = E(f.id), sn = f.name.replace(/'/g, "\\'");
      h += `<div data-di="${i}" class="fav"><span class="fav-h" title="Déplacer">⠿</span><div class="fav-b" role="button" tabindex="0" onclick="findNearFav(${f.lat},${f.lon},'${sn}','${si}')"><div class="fav-n">📍 ${E(f.name)}</div><div class="fav-s">~${fr}\u202fkm</div><div class="fav-radius-ctrl" onclick="event.stopPropagation()"><button type="button" class="btn btn-i btn-sm" onclick="adjFavR('${si}',-5)" aria-label="Réduire le rayon">−</button><span class="tank">${fr}\u202fkm</span><button type="button" class="btn btn-i btn-sm" onclick="adjFavR('${si}',5)" aria-label="Augmenter le rayon">+</button></div>${bc}</div><button type="button" class="btn btn-g btn-i btn-sm fav-r" onclick="event.stopPropagation();removeFav('${si}')" aria-label="Retirer">✕</button></div>`;
    }
  }
  list.innerHTML = h;
  if (state.favDnD) state.favDnD.destroy(); state.favDnD = null;
  if (favs.length > 1) state.favDnD = new TouchDragReorder(list, { onReorder: (f, t) => { const [it] = favs.splice(f, 1); favs.splice(t, 0, it); saveFavs(); renderFavs(); } });
}
export function findNearFav(lat, lon, name, fid) { const f = favs.find(x => x.id === fid); findNear(lat, lon, name, f?.radius ? +f.radius : null); }
export function showStationFav(sid, lat, lon, label) { const a = coord(lat), o = coord(lon); state.detailAnchor = (Number.isFinite(a) && Number.isFinite(o)) ? { lat: a, lon: o, label } : null; showStation(sid); }
