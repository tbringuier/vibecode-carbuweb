import { state, radius } from './state.js';
import { E, maxKm } from './helpers.js';

const L = window.L;
const OSM_A = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function mkMap(id) { const m = L.map(id, { scrollWheelZoom: true, zoomControl: false }); L.control.zoom({ position: 'topleft', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(m); L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 20, minZoom: 2, attribution: OSM_A, detectRetina: true }).addTo(m); return m; }
export function mkIcon(c) { return L.icon({ iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${c}.png`, iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] }); }

export function initMap(markers, multi) {
  if (state.stationMap) state.stationMap.remove();
  const el = document.getElementById('station-map');
  if (!el || !markers.length) { if (el) el.innerHTML = '<div class="notice" style="height:100%;display:flex;align-items:center;justify-content:center"><b>Carte indisponible</b></div>'; return; }
  state.stationMap = mkMap('station-map'); const bounds = [];
  const icons = { station_blue: mkIcon('blue'), station_green: mkIcon('green'), station_orange: mkIcon('orange'), station_red: mkIcon('red') };
  markers.forEach(m => {
    if (m.type === 'search_point') { L.circle([m.lat, m.lon], { radius: maxKm() * 1000, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .04, weight: 2, dashArray: '6 4' }).addTo(state.stationMap); L.circleMarker([m.lat, m.lon], { radius: 7, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .9, weight: 2 }).bindPopup(`<b>${E(m.label) || 'Recherche'}</b><br><span style="font-size:.6875rem">~${radius}\u202fkm</span>`).addTo(state.stationMap).openPopup(); }
    else { const pop = `<div style="min-width:120px"><b>${E(m.label)}</b>${m.adresse ? `<br><span style="font-size:.6875rem;color:#666">${E(m.adresse)}</span>` : ''}${m.id ? `<br><button onclick="showStation('${m.id}')" style="margin-top:.25rem;padding:.1875rem .375rem;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:.6875rem;font-weight:600;cursor:pointer">Voir</button>` : ''}</div>`; L.marker([m.lat, m.lon], { icon: icons[m.type] || icons.station_blue }).bindPopup(pop).addTo(state.stationMap); }
    bounds.push([m.lat, m.lon]);
  });
  if (bounds.length > 1) state.stationMap.fitBounds(bounds, { padding: [35, 35] }); else state.stationMap.setView(bounds[0], 14);
}
