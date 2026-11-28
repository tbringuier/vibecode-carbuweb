// map.js — Cartes Leaflet (chargées à la demande), fond plan (OpenStreetMap) ou satellite (photos
// aériennes IGN), pins SVG inline (aucune image externe).
// Économie de données : la carte n'est créée qu'à la demande et sans tuiles « retina » (4× moins de tuiles).
import { state, prefs, setMapStyle } from './state.js';
import { E, fmtEur, ICON } from './helpers.js';
import { loadLeaflet } from './vendor.js';

const OSM_A = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const IGN_A = 'Photos aériennes &copy; <a href="https://geoservices.ign.fr/">IGN</a>';
// Géoplateforme IGN (données publiques, licence ouverte, sans clé) : orthophotographies.
const IGN_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';
const PIN = { blue: '#2563eb', green: '#16a34a', orange: '#d97706', red: '#dc2626', grey: '#6b7280' };
const CLS_PIN = { cheap: 'green', mid: 'orange', dear: 'red' };

function pinIcon(L, c, label) {
  const col = PIN[c] || PIN.blue;
  const txt = label ? `<text x="12" y="15.2" text-anchor="middle" font-size="8.5" font-weight="800" fill="${col}" font-family="system-ui,sans-serif">${E(label)}</text>` : '<circle cx="12" cy="11.6" r="4.4" fill="#fff"/>';
  const inner = label ? '<circle cx="12" cy="12" r="7.4" fill="#fff"/>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="25" height="38" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${col}" stroke="rgba(0,0,0,.28)" stroke-width="1"/>${inner}${txt}</svg>`;
  return L.divIcon({ className: 'pin-icon', html: svg, iconSize: [25, 38], iconAnchor: [12, 38], popupAnchor: [1, -32] });
}

// Bouton « Satellite / Plan » en haut à droite de chaque carte (choix mémorisé pour toutes les cartes).
function styleControl(L, m, layers) {
  const Ctl = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create('button', 'map-style');
      b.type = 'button';
      const label = () => { const sat = prefs.mapStyle === 'sat'; b.innerHTML = `${sat ? ICON.map : ICON.sat} ${sat ? 'Plan' : 'Satellite'}`; b.setAttribute('aria-label', sat ? 'Afficher le plan' : 'Afficher la vue satellite'); };
      label();
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, 'click', e => {
        L.DomEvent.preventDefault(e);
        const next = prefs.mapStyle === 'sat' ? 'plan' : 'sat';
        m.removeLayer(layers[prefs.mapStyle]);
        setMapStyle(next);
        layers[next].addTo(m);
        label();
      });
      return b;
    }
  });
  new Ctl({ position: 'topright' }).addTo(m);
}

// Au-delà, les stations plus chères deviennent de petits points (cliquables) : la carte reste lisible.
const PILL_MAX = 40;
const dotIcon = L => L.divIcon({ className: 'mk-wrap', html: '<span class="mk-dot"></span>', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -8] });

// Pastille de prix (carburant choisi) : posée au-dessus du point, pointe vers la station.
function pillIcon(L, cls, text, rank) {
  const html = `<span class="mk-pill mk-${cls || 'def'}">${rank ? `<b class="mk-rank">${E(rank)}</b>` : ''}${E(text)}</span>`;
  return L.divIcon({ className: 'mk-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -34] });
}

export function destroyMap(id) {
  const m = state.maps[id];
  if (m) { try { m.stop(); m.remove(); } catch { /* conteneur déjà retiré du DOM */ } delete state.maps[id]; }
}

// Tuiles haute définition (4× plus de données) seulement hors économie de données et hors réseau
// mobile détecté (Android : navigator.connection.type ; ailleurs l'information n'existe pas).
const hiDpiTiles = () => !prefs.dataSaver && devicePixelRatio > 1 && !['cellular', 'bluetooth', 'wimax'].includes(navigator.connection?.type) && !/(^|-)2g|3g/.test(navigator.connection?.effectiveType || '');

// Économie de données : une carte demandée reste affichée tant qu'on reste sur la même vue.
const forced = {};
const deferred = id => prefs.dataSaver && forced[id] !== location.hash;

// Conteneur de carte : placeholder cliquable en mode économie de données.
export function mapSlot(id, cls = 'd-map') {
  if (deferred(id)) return `<div id="${id}" class="${cls} map-off"><button type="button" class="btn btn-sm" data-act="show-map" data-map="${id}">${ICON.map} Afficher la carte</button></div>`;
  return `<div id="${id}" class="${cls}" aria-label="Carte"></div>`;
}

// Mémorise la dernière demande par conteneur : le bouton « Afficher la carte » la rejoue.
const requests = {};
export function showMapNow(id) { forced[id] = location.hash; const r = requests[id]; if (r) renderMap(id, r.markers, r.opts); }

/**
 * markers : [{lat, lon, label, sub, id, cls ('cheap'|'mid'|'dear'|''), rank, price}]
 * opts    : {center: {lat, lon, label, radiusKm}, fit: true}
 */
export async function renderMap(id, markers, opts = {}) {
  requests[id] = { markers, opts };
  const el = document.getElementById(id);
  if (!el || deferred(id)) return;
  let L;
  try { L = await loadLeaflet(); } catch {
    el.innerHTML = '<div class="map-empty">Carte indisponible (hors ligne ?)</div>'; return;
  }
  const el2 = document.getElementById(id);
  if (!el2 || requests[id]?.markers !== markers) return;  // vue changée pendant le chargement
  destroyMap(id);
  el2.classList.remove('map-off');
  el2.innerHTML = '';
  const m = L.map(el2, { zoomControl: false, scrollWheelZoom: false, tap: true });
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(m);
  const retina = hiDpiTiles();
  const layers = {
    plan: L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, minZoom: 4, attribution: OSM_A, detectRetina: retina }),
    sat: L.tileLayer(IGN_URL, { maxZoom: 19, minZoom: 4, attribution: IGN_A, detectRetina: retina })
  };
  layers[prefs.mapStyle].addTo(m);
  styleControl(L, m, layers);
  // Molette active seulement après un clic sur la carte : le défilement de la page n'est pas capturé.
  m.on('click', () => m.scrollWheelZoom.enable());
  m.on('mouseout', () => m.scrollWheelZoom.disable());
  state.maps[id] = m;
  const bounds = [];
  const icons = {};
  const icon = (c, lbl) => { const k = c + '|' + (lbl || ''); return icons[k] ||= pinIcon(L, c, lbl); };
  const c = opts.center;
  let circleBounds = null;
  if (c) {
    if (c.radiusKm) {
      L.circle([c.lat, c.lon], { radius: c.radiusKm * 1000, color: PIN.blue, fillColor: PIN.blue, fillOpacity: .04, weight: 1.5, dashArray: '6 4', interactive: false }).addTo(m);
      circleBounds = L.latLng(c.lat, c.lon).toBounds(c.radiusKm * 2000);
    }
    L.circleMarker([c.lat, c.lon], { radius: 7, color: '#fff', fillColor: PIN.blue, fillOpacity: 1, weight: 3 }).bindPopup(`<div class="pop-body"><b>${E(c.label || 'Point de recherche')}</b></div>`).addTo(m);
    bounds.push([c.lat, c.lon]);
  }
  // Les moins chères passent au premier plan quand les pastilles se chevauchent.
  const byPrice = markers.map((mk, i) => [Number.isFinite(mk.price) ? mk.price : Infinity, i]).sort((a, b) => a[0] - b[0]);
  const zRank = new Array(markers.length);
  let dot = null;
  byPrice.forEach(([, i], r) => { zRank[i] = r; });
  markers.forEach((mk, i) => {
    const acts = mk.id ? `<span class="pop-acts">${mk.link !== false ? `<a class="pop-btn" href="#s/${encodeURIComponent(mk.id)}">Voir la station</a>` : ''}<button type="button" class="pop-btn pop-btn-2" data-act="go" data-id="${E(mk.id)}">Y aller</button></span>` : '';
    const pop = `<div class="pop-body"><b>${E(mk.label)}</b>${mk.sub ? `<span class="pop-meta">${E(mk.sub)}</span>` : ''}${Number.isFinite(mk.price) ? `<b class="pop-price">${mk.fuel ? `${E(mk.fuel)} ` : ''}${fmtEur(mk.price)}</b>` : ''}${acts}</div>`;
    const ic = mk.pill ? (zRank[i] < PILL_MAX ? pillIcon(L, mk.cls, mk.pill, mk.rank) : (dot ||= dotIcon(L))) : icon(CLS_PIN[mk.cls] || 'blue', mk.rank);
    L.marker([mk.lat, mk.lon], { icon: ic, title: mk.pill ? `${mk.label} · ${mk.pill}` : mk.label, riseOnHover: true, zIndexOffset: (markers.length - zRank[i]) * 1000 }).bindPopup(pop).addTo(m);
    bounds.push([mk.lat, mk.lon]);
  });
  if (circleBounds) m.fitBounds(circleBounds, { padding: [12, 12] });
  else if (bounds.length > 1) m.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  else if (bounds.length) m.setView(bounds[0], 14);
  else m.setView([46.6, 2.5], 5);
  // Leaflet mesure son conteneur : recalcul après stabilisation de la mise en page.
  requestAnimationFrame(() => state.maps[id] === m && m.invalidateSize());
  setTimeout(() => state.maps[id] === m && m.invalidateSize(), 200);
}
