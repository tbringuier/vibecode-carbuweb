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

export function mkIcon(c) {
  return L.icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${c}.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34]
  });
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
  const icons = {
    station_blue: mkIcon('blue'),
    station_green: mkIcon('green'),
    station_orange: mkIcon('orange'),
    station_red: mkIcon('red')
  };
  markers.forEach(m => {
    if (m.type === 'search_point') {
      L.circle([m.lat, m.lon], { radius: maxKm() * 1000, color: ACCENT, fillColor: ACCENT, fillOpacity: .04, weight: 2, dashArray: '6 4' }).addTo(state.stationMap);
      L.circleMarker([m.lat, m.lon], { radius: 7, color: ACCENT, fillColor: ACCENT, fillOpacity: .9, weight: 2 })
        .bindPopup(`<div class="pop-body"><b>${E(m.label) || 'Recherche'}</b><br><span class="pop-meta">~${radius}\u202fkm</span></div>`)
        .addTo(state.stationMap)
        .openPopup();
    } else {
      const pop = `<div class="pop-body"><b>${E(m.label)}</b>${m.adresse ? `<br><span class="pop-meta">${E(m.adresse)}</span>` : ''}${m.id ? `<br><button type="button" class="pop-btn" onclick="showStation('${m.id}')">Voir</button>` : ''}</div>`;
      L.marker([m.lat, m.lon], { icon: icons[m.type] || icons.station_blue }).bindPopup(pop).addTo(state.stationMap);
    }
    bounds.push([m.lat, m.lon]);
  });
  if (bounds.length > 1) state.stationMap.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 });
  else state.stationMap.setView(bounds[0], 13);
  // Leaflet needs accurate container size; recompute after layout settles.
  const m = state.stationMap;
  requestAnimationFrame(() => m.invalidateSize());
  setTimeout(() => m.invalidateSize(), 160);
}
