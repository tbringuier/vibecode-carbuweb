import { state, radius } from './state.js';
import { E, maxKm } from './helpers.js';

const L = window.L;
const OSM_A = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ACCENT = '#2563eb';

export function mkMap(id) {
  const m = L.map(id, { scrollWheelZoom: true, zoomControl: false });
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(m);
  L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 20, minZoom: 2, attribution: OSM_A, detectRetina: true }).addTo(m);
  return m;
}

// Pins SVG inline : aucune requête externe, couleurs alignées sur la sémantique du site.
const PIN_COLORS = { blue: '#2563eb', green: '#16a34a', orange: '#d97706', red: '#dc2626' };

export function mkIcon(c) {
  const col = PIN_COLORS[c] || PIN_COLORS.blue;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="25" height="38" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${col}" stroke="rgba(0,0,0,.28)" stroke-width="1"/><circle cx="12" cy="11.6" r="4.4" fill="#fff"/></svg>`;
  return L.divIcon({ className: 'pin-icon', html: svg, iconSize: [25, 38], iconAnchor: [12, 38], popupAnchor: [1, -32] });
}

export function initMap(markers /*, multi */) {
  if (state.stationMap) state.stationMap.remove();
  const el = document.getElementById('station-map');
  if (!el || !markers.length) {
    if (el) el.innerHTML = '<div class="map-empty"><b>Carte indisponible</b></div>';
    return;
  }
  state.stationMap = mkMap('station-map');
  const bounds = [];
  let circle = null;
  const icons = {
    station_blue: mkIcon('blue'),
    station_green: mkIcon('green'),
    station_orange: mkIcon('orange'),
    station_red: mkIcon('red')
  };
  markers.forEach(m => {
    if (m.type === 'search_point') {
      // circleKm/rKm : rayon effectif figé au rendu (rayon personnalisé d'un favori éventuellement).
      circle = L.circle([m.lat, m.lon], { radius: (m.circleKm ?? maxKm()) * 1000, color: ACCENT, fillColor: ACCENT, fillOpacity: .04, weight: 2, dashArray: '6 4' }).addTo(state.stationMap);
      L.circleMarker([m.lat, m.lon], { radius: 7, color: ACCENT, fillColor: ACCENT, fillOpacity: .9, weight: 2 })
        .bindPopup(`<div class="pop-body"><b>${E(m.label) || 'Recherche'}</b><br><span class="pop-meta">~${m.rKm ?? radius} km</span></div>`)
        .addTo(state.stationMap)
        .openPopup();
    } else {
      const pop = `<div class="pop-body"><b>${E(m.label)}</b>${m.adresse ? `<br><span class="pop-meta">${E(m.adresse)}</span>` : ''}${m.id ? `<br><button type="button" class="pop-btn" onclick="showStation('${m.id}')">Voir</button>` : ''}</div>`;
      L.marker([m.lat, m.lon], { icon: icons[m.type] || icons.station_blue }).bindPopup(pop).addTo(state.stationMap);
    }
    bounds.push([m.lat, m.lon]);
  });
  if (bounds.length > 1) state.stationMap.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 });
  else if (circle) state.stationMap.fitBounds(circle.getBounds(), { padding: [20, 20] });
  else state.stationMap.setView(bounds[0], 13);
  // Leaflet needs accurate container size; recompute after layout settles.
  const m = state.stationMap;
  requestAnimationFrame(() => m.invalidateSize());
  setTimeout(() => m.invalidateSize(), 160);
}
