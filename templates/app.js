
let db = null;
let stationMap = null;
let palmaresMap = null;
let searchTimeout = null;

const ALL_FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"];
let userRadius = parseInt(localStorage.getItem('carbuRadius')) || 15;
let userFuels = JSON.parse(localStorage.getItem('carbuFuels')) || ALL_FUELS;
let userFavorites = JSON.parse(localStorage.getItem('carbuFavorites')) || [];
let chartsInitialized = false;
let currentProximitySearch = null; 

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById('radius-slider').value = userRadius;
    document.getElementById('radius-display').innerText = userRadius;
    
    document.getElementById('radius-slider').addEventListener('input', (e) => {
        document.getElementById('radius-display').innerText = e.target.value;
        debouncedSaveSettings();
    });

    try {
        const response = await fetch('data.json');
        db = await response.json();
        
        const cbContainer = document.getElementById('fuels-checkboxes');
        ALL_FUELS.forEach(f => {
            const checked = userFuels.includes(f) ? 'checked' : '';
            const moy = db.dashboard.national.avg_prices[f];
            const moyText = moy ? `<div class="text-[10px] text-slate-500 leading-none mt-1">Moyenne nationale : ${moy.toFixed(3)}€</div>` : '';
            cbContainer.innerHTML += `
                <label class="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-indigo-50 transition">
                    <input type="checkbox" value="${f}" class="fuel-checkbox form-checkbox h-5 w-5 text-indigo-600 rounded" ${checked} onchange="debouncedSaveSettings()">
                    <div class="flex flex-col"><span class="text-slate-800 font-bold leading-tight">${f}</span>${moyText}</div>
                </label>
            `;
        });

        document.getElementById('loading').classList.add('hidden');
        document.getElementById('home-view').classList.remove('hidden');
        
        populateRegions();
        populateFuelsSelect();
        renderFavorites();
    } catch (e) {
        document.getElementById('loading').innerHTML = '<p class="text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>Erreur serveur HTTP local.</p>';
    }
});

// Utilitaires
function normalizeText(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-']/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
}

function distanceHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function getGoogleMapsLink(lat, lon, query = "") {
    if (lat && lon) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function hasTrackedFuel(station) {
    if (!station || !station.carburants_disponibles) return false;
    for (const c of Object.keys(station.carburants_disponibles)) {
        if (userFuels.includes(c)) return true;
    }
    return false;
}

// Paramètres & Sauvegarde
let saveTimeout;
function debouncedSaveSettings() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 300);
}

function toggleSettings() { document.getElementById('settings-modal').classList.toggle('hidden'); }
function updateRadiusDisplay() { document.getElementById('radius-display').innerText = document.getElementById('radius-slider').value; }

function saveSettings() {
    userRadius = parseFloat(document.getElementById('radius-slider').value);
    localStorage.setItem('carbuRadius', userRadius);
    
    const checkboxes = document.querySelectorAll('.fuel-checkbox:checked');
    userFuels = Array.from(checkboxes).map(cb => cb.value);
    if (userFuels.length === 0) {
        userFuels = ALL_FUELS; 
        document.querySelectorAll('.fuel-checkbox').forEach(cb => cb.checked = true);
    }
    localStorage.setItem('carbuFuels', JSON.stringify(userFuels));
    
    if (currentProximitySearch) {
        const sortSelect = document.getElementById('sort-fuel-select');
        const sf = sortSelect ? sortSelect.value : "";
        applyFuelSort(sf);
    } else {
        debouncedSearch();
    }
    
    const currentViewId = document.getElementById('station-view').getAttribute('data-current-id');
    if (currentViewId && !document.getElementById('station-view').classList.contains('hidden')) showStation(currentViewId);
}

function resetSettings() {
    localStorage.clear();
    location.reload();
}

// Lieux Favoris
function toggleFavoriteAddress(lat, lon, name) {
    const idStr = `${lat}-${lon}`;
    const idx = userFavorites.findIndex(f => f.id === idStr);
    if (idx > -1) userFavorites.splice(idx, 1);
    else userFavorites.push({ id: idStr, type: 'address', name, lat, lon });
    localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites));
    renderFavorites();
    debouncedSearch(); 
}

function toggleFavoriteCurrentStation() {
    const sid = document.getElementById('station-view').getAttribute('data-current-id');
    const s = db.stations[sid];
    const idx = userFavorites.findIndex(f => f.id === sid);
    if (idx > -1) userFavorites.splice(idx, 1);
    else userFavorites.push({ id: sid, type: 'station', name: s.nom_osm || 'Station-service', adresse: `${s.adresse}, ${s.ville}` });
    localStorage.setItem('carbuFavorites', JSON.stringify(userFavorites));
    updateStarUI(sid);
}

function updateStarUI(sid) {
    const btn = document.getElementById('btn-favorite-station');
    const isFav = userFavorites.some(f => f.id === sid);
    btn.innerHTML = `<i class="fas fa-star ${isFav ? 'text-yellow-400' : 'text-slate-300 hover:text-yellow-400'}"></i>`;
}

function renderFavorites() {
    const container = document.getElementById('favorites-container');
    const list = document.getElementById('favorites-list');
    if (userFavorites.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    list.innerHTML = '';
    
    userFavorites.forEach(f => {
        if (f.type === 'station') {
            list.innerHTML += `
                <div onclick="showStation('${f.id}')" class="p-3 bg-yellow-50 border border-yellow-200 rounded-xl cursor-pointer hover:bg-yellow-100 transition flex justify-between items-center group shadow-sm">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-yellow-800 truncate"><i class="fas fa-gas-pump mr-2 text-yellow-600"></i>${f.name}</div>
                        <div class="text-xs text-yellow-700 truncate mt-1">${f.adresse}</div>
                    </div>
                    <i class="fas fa-chevron-right text-yellow-400 group-hover:text-yellow-600"></i>
                </div>
            `;
        } else {
            list.innerHTML += `
                <div onclick="findStationsNear(${f.lat}, ${f.lon}, '${f.name.replace(/'/g, "\\'")}')" class="p-3 bg-indigo-50 border border-indigo-200 rounded-xl cursor-pointer hover:bg-indigo-100 transition flex justify-between items-center group shadow-sm">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-indigo-800 truncate"><i class="fas fa-map-marker-alt mr-2 text-indigo-600"></i>${f.name}</div>
                        <div class="text-xs text-indigo-700 mt-1">Adresse favorite</div>
                    </div>
                    <i class="fas fa-chevron-right text-indigo-400 group-hover:text-indigo-600"></i>
                </div>
            `;
        }
    });
}

// UI Navigation Tabs
function switchTab(tab) {
    ['recherche', 'palmares', 'statistiques'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const pane = document.getElementById(`pane-${t}`);
        if(t === tab) {
            btn.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
            btn.classList.remove('text-slate-500');
            pane.classList.remove('hidden');
        } else {
            btn.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
            btn.classList.add('text-slate-500');
            pane.classList.add('hidden');
        }
    });
    if(tab === 'palmares' && palmaresMap) setTimeout(() => palmaresMap.invalidateSize(), 100);
    if(tab === 'statistiques') renderDashboard();
}

function goHome() {
    currentProximitySearch = null;
    document.getElementById('station-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    renderFavorites();
}

// ==========================================
// RUBRIQUE STATISTIQUES (DASHBOARD)
// ==========================================
function renderDashboard() {
    if (chartsInitialized) return;
    chartsInitialized = true;
    
    const dash = db.dashboard;
    const fuels = Object.keys(dash.national.avg_prices).filter(f => dash.national.avg_prices[f] > 0);
    const avgPrices = fuels.map(f => dash.national.avg_prices[f]);
    const fuelCounts = fuels.map(f => dash.national.fuel_presence[f]);
    const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    new Chart(document.getElementById('chart-nat-prices'), {
        type: 'bar',
        data: { labels: fuels, datasets: [{ label: 'Prix moyen (€)', data: avgPrices, backgroundColor: colors }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }
    });

    new Chart(document.getElementById('chart-nat-fuels'), {
        type: 'pie',
        data: { labels: fuels, datasets: [{ data: fuelCounts, backgroundColor: colors }] },
        options: { responsive: true }
    });

    let tableHtml = `<thead class="bg-slate-100 text-slate-700 uppercase text-xs"><tr><th class="px-4 py-3 sticky left-0 bg-slate-100 shadow-sm z-10">Région</th><th class="px-4 py-3">Stations</th>`;
    fuels.forEach(f => tableHtml += `<th class="px-4 py-3">${f}</th>`);
    tableHtml += `</tr></thead><tbody class="text-sm">`;
    
    for (const [region, data] of Object.entries(dash.regional).sort()) {
        if (region === 'Inconnue') continue;
        tableHtml += `<tr class="border-b hover:bg-slate-50"><td class="px-4 py-3 font-bold sticky left-0 bg-white/90 backdrop-blur z-10">${region}</td><td class="px-4 py-3 text-center">${data.station_count}</td>`;
        fuels.forEach(f => {
            let p = data.avg_prices[f];
            tableHtml += `<td class="px-4 py-3 text-center font-medium">${p > 0 ? p.toFixed(3) + ' €' : '-'}</td>`;
        });
        tableHtml += `</tr>`;
    }
    tableHtml += `</tbody>`;
    document.getElementById('table-regions').innerHTML = tableHtml;
}

// ==========================================
// MOTEUR DE RECHERCHE MIXTE
// ==========================================

function debouncedSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 500);
}

async function performSearch() {
    const query = document.getElementById('search-input').value;
    const normQuery = normalizeText(query);
    const resultsContainer = document.getElementById('search-results');
    currentProximitySearch = null; 
    
    if (normQuery.length < 3) { resultsContainer.innerHTML = ''; return; }
    resultsContainer.innerHTML = '<div class="text-center text-slate-400 py-4"><i class="fas fa-spinner fa-spin mr-2"></i> Recherche en cours...</div>';

    let html = '';
    let localResults = [];
    if (db.cp_index[normQuery]) {
        db.cp_index[normQuery].forEach(id => {
            if (hasTrackedFuel(db.stations[id])) localResults.push({ id, label: db.recherche_texte[id].label_affichage, station: db.stations[id] });
        });
    } else {
        for (const [id, data] of Object.entries(db.recherche_texte)) {
            if (data.texte_norm.includes(normQuery) && hasTrackedFuel(db.stations[id])) {
                localResults.push({ id, label: data.label_affichage, station: db.stations[id] });
            }
            if (localResults.length > 20) break;
        }
    }

    if (localResults.length > 0) {
        html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4 flex justify-between"><span><i class="fas fa-gas-pump mr-1"></i> Stations-services exactes</span><span class="text-indigo-400 normal-case bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">Filtres appliqués</span></div>`;
        localResults.forEach(res => {
            html += `
                <div onclick="showStation('${res.id}')" class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-indigo-300 cursor-pointer transition flex justify-between items-center group gap-4 mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-800 group-hover:text-indigo-600 transition truncate text-lg">${res.station.nom_osm || 'Station-service'}</div>
                        <div class="text-sm text-slate-500 truncate mt-1"><i class="fas fa-map-marker-alt mr-1 text-slate-300"></i>${res.station.adresse}, ${res.station.code_postal} ${res.station.ville}</div>
                    </div>
                    <i class="fas fa-chevron-right text-slate-300 group-hover:text-indigo-500 transition flex-shrink-0"></i>
                </div>
            `;
        });
    }

    try {
        const osmResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=fr&limit=4`);
        const osmData = await osmResponse.json();
        
        if (osmData.length > 0) {
            html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4 flex justify-between"><span><i class="fas fa-map-marked-alt mr-1"></i> Villes & Adresses</span><span class="text-indigo-400 normal-case bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">OSM (OpenStreetMap)</span></div>`;
            osmData.forEach(place => {
                const parts = place.display_name.split(',');
                const name = parts[0];
                const desc = parts.slice(1, -2).join(',').trim();
                const isFav = userFavorites.some(f => f.id === `${place.lat}-${place.lon}`);
                
                html += `
                    <div class="bg-indigo-50 border border-indigo-100 rounded-xl hover:shadow-md hover:border-indigo-300 transition flex items-center group mb-2 overflow-hidden">
                        <div onclick="findStationsNear(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')" class="p-4 flex-1 min-w-0 cursor-pointer flex justify-between items-center">
                            <div class="min-w-0">
                                <div class="font-bold text-indigo-800 group-hover:text-indigo-600 transition truncate text-lg">${name}</div>
                                <div class="text-xs text-indigo-500 truncate mt-1"><i class="fas fa-search-location mr-1"></i>${desc}</div>
                            </div>
                            <i class="fas fa-arrow-right text-indigo-300 group-hover:text-indigo-500 transition ml-3"></i>
                        </div>
                        <button onclick="toggleFavoriteAddress(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')" class="p-4 text-xl border-l border-indigo-100 transition hover:bg-indigo-100" title="Ajouter aux lieux favoris">
                            <i class="fas fa-star ${isFav ? 'text-yellow-400' : 'text-indigo-200 hover:text-yellow-400'}"></i>
                        </button>
                    </div>
                `;
            });
        }
    } catch (e) { console.error("OSM API Error", e); }

    if (html === '') {
        html = `
            <div class="p-6 bg-slate-50 text-slate-500 rounded-xl text-center border border-slate-200 mt-4">
                <i class="fas fa-filter text-2xl mb-2 text-slate-400 block"></i>
                <b>Aucun résultat trouvé.</b><br>
                <span class="text-sm mt-2 block">Note : les stations-services inactives depuis >7 jours, ou ne proposant pas les carburants que vous avez cochés dans vos paramètres, sont masquées.</span>
            </div>`;
    }
    resultsContainer.innerHTML = html;
}

// ==========================================
// GEOLOCALISATION & RECHERCHE AUTOUR
// ==========================================

function geolocateMe() {
    if (!navigator.geolocation) { alert("La géolocalisation n'est pas supportée."); return; }
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<div class="text-center text-indigo-600 py-4 font-bold"><i class="fas fa-compass fa-spin mr-2 text-2xl mb-2"></i><br>Recherche de votre position...</div>';
    
    navigator.geolocation.getCurrentPosition(
        (pos) => findStationsNear(pos.coords.latitude, pos.coords.longitude, "Votre position actuelle"),
        () => resultsContainer.innerHTML = '<div class="p-6 bg-slate-50 text-slate-500 rounded-xl text-center border border-slate-200"><i class="fas fa-exclamation-triangle text-2xl mb-2 text-red-400 block"></i><b>Impossible d\'obtenir votre position.</b></div>'
    );
}

function applyFuelSort(fuel) {
    if (!currentProximitySearch) return;
    renderStationsList(currentProximitySearch.lat, currentProximitySearch.lon, currentProximitySearch.labelTitle, fuel);
}

function findStationsNear(lat, lon, labelTitle) {
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.removeAttribute('data-current-id');
    document.getElementById('btn-favorite-station').classList.add('hidden'); 
    
    currentProximitySearch = { lat, lon, labelTitle };
    renderStationsList(lat, lon, labelTitle, "");
}

function renderStationsList(lat, lon, labelTitle, sortFuel) {
    let stationsProches = [];
    for (const [id, stat] of Object.entries(db.stations)) {
        if (!stat.lat || !stat.lon) continue;
        if (!hasTrackedFuel(stat)) continue;

        const dist = distanceHaversine(lat, lon, stat.lat, stat.lon);
        if (dist <= parseFloat(userRadius)) stationsProches.push({ id, dist, station: stat });
    }

    if (sortFuel) {
        stationsProches = stationsProches.filter(s => s.station.carburants_disponibles[sortFuel]);
        stationsProches.sort((a, b) => parseFloat(a.station.carburants_disponibles[sortFuel].prix) - parseFloat(b.station.carburants_disponibles[sortFuel].prix));
    } else {
        stationsProches.sort((a, b) => a.dist - b.dist);
    }

    const topStations = stationsProches; 

    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
            <div class="bg-gradient-to-r from-indigo-600 to-blue-500 p-6 text-white text-center">
                <h2 class="text-2xl font-extrabold mb-1"><i class="fas fa-location-arrow mr-2"></i>Stations-services à proximité</h2>
                <p class="text-blue-100 text-sm">Autour de : ${labelTitle}</p>
            </div>
            <div class="p-6 md:p-8">
                <div id="station-map" class="mb-6 border border-slate-200 rounded-xl overflow-hidden"></div>
    `;

    if (topStations.length === 0) {
        html += `<div class="p-6 bg-slate-50 rounded-xl text-center text-slate-500 border border-slate-200">
            <i class="fas fa-filter text-2xl mb-2 text-slate-400 block"></i>
            Aucune station-service correspondante dans un rayon de ${userRadius}km.<br>
            <span class="text-sm">Modifiez vos paramètres (en haut à droite) pour élargir la recherche ou ajouter des carburants.</span>
        </div>`;
    } else {
        let sortOptions = userFuels.map(f => `<option value="${f}" ${sortFuel === f ? 'selected' : ''}>${f}</option>`).join('');
        html += `
            <div class="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
                <label class="text-sm font-bold text-slate-700 w-full md:w-auto"><i class="fas fa-sort-amount-down mr-2 text-indigo-500"></i>Méthodologie de tri (par ordre croissant) :</label>
                <select id="sort-fuel-select" onchange="applyFuelSort(this.value)" class="p-3 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white outline-none focus:ring-2 focus:ring-indigo-500 w-full md:w-auto">
                    <option value="">Trier par distance</option>
                    ${sortOptions}
                </select>
            </div>
            <div class="space-y-3">
        `;
        
        const total = topStations.length;
        topStations.forEach((res, index) => {
            let carbsHtml = "";
            let rightContent = "";

            if (sortFuel) {
                let prix = res.station.carburants_disponibles[sortFuel].prix;
                let percentile = total > 1 ? index / (total - 1) : 0;
                
                let colorBorder = "border-red-300";
                let colorBg = "bg-red-100";
                let colorText = "text-red-800";
                let markerType = 'station_red';
                
                if (percentile <= 0.33) {
                    colorBorder = "border-green-300";
                    colorBg = "bg-green-100";
                    colorText = "text-green-800";
                    markerType = 'station_green';
                } else if (percentile <= 0.66) {
                    colorBorder = "border-orange-300";
                    colorBg = "bg-orange-100";
                    colorText = "text-orange-800";
                    markerType = 'station_orange';
                }

                res.markerType = markerType; 

                rightContent = `<div class="font-black text-xl px-3 py-2 rounded-lg border ${colorBorder} ${colorBg} shadow-sm ml-3 flex-shrink-0 whitespace-nowrap ${colorText}">${prix} €</div>`;
                carbsHtml = `<div class="text-sm text-slate-500 mt-1"><i class="fas fa-route mr-1"></i> à ${res.dist.toFixed(1)} km (à vol d'oiseau)</div>`;
            } else {
                let carbsArray = [];
                for (const [c, d] of Object.entries(res.station.carburants_disponibles)) {
                    if(userFuels.includes(c)) carbsArray.push(`${c}: <b>${d.prix}€</b>`);
                }
                carbsHtml = `<div class="text-sm text-slate-700 bg-slate-50 p-2 rounded mt-2">${carbsArray.join(' <span class="text-slate-300">|</span> ')}</div>`;
                rightContent = `<div class="bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold px-3 py-1.5 rounded-lg whitespace-nowrap ml-3 flex-shrink-0">à ${res.dist.toFixed(1)} km</div>`;
                res.markerType = 'station_blue';
            }
            
            html += `
                <div onclick="showStation('${res.id}')" class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md hover:border-indigo-300 cursor-pointer transition flex justify-between items-center group">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-800 text-lg group-hover:text-indigo-600 transition truncate">${res.station.nom_osm || 'Station-service'}</div>
                        <div class="text-sm text-slate-500 truncate mt-1"><i class="fas fa-map-marker-alt mr-1 text-slate-300"></i>${res.station.adresse}, ${res.station.ville}</div>
                        ${carbsHtml}
                    </div>
                    ${rightContent}
                </div>
            `;
        });
        html += `</div>`;
    }
    html += `</div></div>`;
    
    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);

    let mapMarkers = [{ type: 'search_point', lat: lat, lon: lon, label: '📍 Point de recherche', adresse: labelTitle }];
    topStations.forEach(s => mapMarkers.push({ type: s.markerType || 'station_blue', lat: s.station.lat, lon: s.station.lon, label: s.station.nom_osm || 'Station-service', adresse: `${s.station.adresse}, ${s.station.ville}`, id: s.id }));
    setTimeout(() => initStationMap(mapMarkers, true), 100);
}

// ==========================================
// PALMARÈS
// ==========================================

function populateFuelsSelect() {
    const select = document.getElementById('palmares-carb');
    select.innerHTML = '';
    ALL_FUELS.forEach(f => select.add(new Option(f, f)));
}

function populateRegions() {
    const regionSelect = document.getElementById('select-region');
    Object.keys(db.geo_tree).sort().forEach(r => { if (r !== "Inconnue") regionSelect.add(new Option(r, r)); });
}

function updateDepartments() {
    const region = document.getElementById('select-region').value;
    const deptSelect = document.getElementById('select-dept');
    deptSelect.innerHTML = '<option value="">-- Optionnel --</option>';
    if (!region || region === "national") { deptSelect.disabled = true; return; }
    
    deptSelect.disabled = false;
    Object.keys(db.geo_tree[region]).sort().forEach(d => { if (d !== "Inconnu") deptSelect.add(new Option(d, d)); });
}

function findCheapest() {
    const carb = document.getElementById('palmares-carb').value;
    const sort = document.getElementById('palmares-sort').value;
    const region = document.getElementById('select-region').value;
    const dept = document.getElementById('select-dept').value;
    const resultsContainer = document.getElementById('palmares-results');
    
    let idsAChercher = [];
    if (region === "national") {
        for (const r of Object.values(db.geo_tree)) {
            for (const d of Object.values(r)) {
                for (const v of Object.values(d)) idsAChercher.push(...v);
            }
        }
    } else if (dept) {
        for (const villes of Object.values(db.geo_tree[region][dept])) idsAChercher.push(...villes);
    } else if (region) {
        for (const depts of Object.values(db.geo_tree[region])) {
            for (const villes of Object.values(depts)) idsAChercher.push(...villes);
        }
    }

    let resultats = [];
    for (const sid of idsAChercher) {
        const station = db.stations[sid];
        if (station.carburants_disponibles[carb]) {
            resultats.push({ id: sid, prixInfo: parseFloat(station.carburants_disponibles[carb].prix), station: station });
        }
    }

    if (resultats.length === 0) {
        document.getElementById('palmares-map').classList.add('hidden');
        resultsContainer.innerHTML = `<div class="p-6 bg-slate-50 text-slate-500 rounded-xl text-center border border-slate-200"><i class="fas fa-filter text-2xl mb-2 text-slate-400 block"></i><b>Aucune station-service ne propose ce carburant dans cette zone.</b></div>`;
        return;
    }

    if(sort === 'asc') resultats.sort((a, b) => a.prixInfo - b.prixInfo);
    else resultats.sort((a, b) => b.prixInfo - a.prixInfo);
    
    const top10 = resultats.slice(0, 10);

    let html = `<h4 class="font-extrabold text-slate-800 text-lg mb-3 flex items-center"><i class="fas fa-list-ol text-indigo-500 mr-2"></i> Top ${top10.length} :</h4><div class="space-y-3">`;
    top10.forEach((res, index) => {
        let medailleClass = 'bg-white border-slate-200';
        let badge = `<span class="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded-full mr-3 border border-slate-200">#${index+1}</span>`;
        if (sort === 'asc') {
            if (index === 0) { medailleClass = 'bg-yellow-100 border-yellow-400'; badge = `<span class="text-xl mr-3">🥇</span>`; }
            else if (index === 1) { medailleClass = 'bg-slate-100 border-slate-400'; badge = `<span class="text-xl mr-3">🥈</span>`; }
            else if (index === 2) { medailleClass = 'bg-orange-50 border-orange-300'; badge = `<span class="text-xl mr-3">🥉</span>`; }
        }
        
        let colorPrix = sort === 'asc' ? 'text-green-600' : 'text-red-600';
        
        html += `
            <div onclick="showStation('${res.id}')" class="p-4 border rounded-xl flex items-center cursor-pointer hover:shadow-md hover:border-indigo-300 transition gap-2 group ${medailleClass}">
                ${badge}
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-slate-800 text-lg truncate group-hover:text-indigo-600 transition">${res.station.nom_osm || 'Station-service'}</div>
                    <div class="text-xs text-slate-500 truncate">${res.station.ville} (${res.station.code_postal})</div>
                </div>
                <div class="font-black ${colorPrix} text-xl ml-2 bg-white px-3 py-1 rounded-lg shadow-sm border border-slate-100 flex-shrink-0">${res.prixInfo.toFixed(3)} €</div>
            </div>
        `;
    });
    html += `</div>`;
    resultsContainer.innerHTML = html;
    
    let mapMarkers = [];
    top10.forEach((res, index) => {
        if(res.station.lat && res.station.lon) {
            mapMarkers.push({ type: 'rank', lat: res.station.lat, lon: res.station.lon, label: `${index+1}. ${res.station.nom_osm || 'Station-service'}`, adresse: res.station.ville, prix: res.prixInfo, id: res.id, isAsc: sort === 'asc' });
        }
    });
    setTimeout(() => initPalmaresMap(mapMarkers), 100);
}

// ==========================================
// AFFICHAGE STATION INDIVIDUELLE & ANALYSE
// ==========================================

function analyserPrixProximite(stationId, carburant, prixActuel) {
    const stationAct = db.stations[stationId];
    if (!stationAct.lat || !stationAct.lon) return { alternative: null };

    let stationsProches = [];
    const prixActNum = prixActuel !== null ? parseFloat(prixActuel) : null;
    
    let centerLat = stationAct.lat;
    let centerLon = stationAct.lon;
    let refRadius = parseFloat(userRadius);
    let isContextSearch = false;
    
    if (currentProximitySearch && currentProximitySearch.lat && currentProximitySearch.lon) {
        centerLat = currentProximitySearch.lat;
        centerLon = currentProximitySearch.lon;
        isContextSearch = true;
    }

    for (const [autreId, autreStat] of Object.entries(db.stations)) {
        if (autreId === stationId || !autreStat.lat || !autreStat.lon) continue;
        
        const distFromCenter = distanceHaversine(centerLat, centerLon, autreStat.lat, autreStat.lon);
        
        if (distFromCenter <= refRadius && autreStat.carburants_disponibles[carburant]) {
            const distFromCurrent = distanceHaversine(stationAct.lat, stationAct.lon, autreStat.lat, autreStat.lon);
            stationsProches.push({ id: autreId, prix: parseFloat(autreStat.carburants_disponibles[carburant].prix), dist: distFromCurrent, nom: autreStat.nom_osm || autreStat.ville, lat: autreStat.lat, lon: autreStat.lon, adresse: `${autreStat.adresse}, ${autreStat.ville}` });
        }
    }

    if (stationsProches.length === 0) return { alternative: null, isCheapest: false, color: "slate", bg: "bg-white", border: "border-slate-200" };

    stationsProches.sort((a, b) => a.prix - b.prix);
    const prixMin = stationsProches[0];
    
    if (prixActNum === null) {
        return { alternative: { ...prixMin, carburant, isEqual: false, isNew: true }, isCheapest: false, color: "slate", bg: "bg-white", border: "border-slate-200" };
    }
    
    let tousPrix = [prixActNum, ...stationsProches.map(s => s.prix)].sort((a, b) => a - b);
    let percentile = tousPrix.indexOf(prixActNum) / (tousPrix.length - 1);

    let isCheapest = percentile === 0;
    let color = "default", bg = "bg-white", border = "border-slate-200";
    if (isCheapest) { color = "green"; bg = "bg-green-50"; border = "border-green-200"; }

    let alternative = null;
    if (prixMin.prix <= prixActNum) {
        alternative = { ...prixMin, carburant, isEqual: (prixMin.prix === prixActNum), isNew: false };
    }

    return { color, isCheapest, bg, border, numProches: stationsProches.length, alternative };
}

function showStation(stationId) {
    const station = db.stations[stationId];
    document.getElementById('home-view').classList.add('hidden');
    const stationView = document.getElementById('station-view');
    stationView.classList.remove('hidden');
    stationView.setAttribute('data-current-id', stationId);
    
    document.getElementById('btn-favorite-station').classList.remove('hidden');
    updateStarUI(stationId);
    
    const gmapsLink = getGoogleMapsLink(station.lat, station.lon, `${station.adresse}, ${station.code_postal} ${station.ville}`);
    
    let html = `
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
            <div class="bg-gradient-to-r from-indigo-600 to-blue-500 p-6 text-white relative">
                <h2 class="text-3xl font-extrabold mb-3 drop-shadow-md pr-10">${station.nom_osm || 'Station-service'}</h2>
                <a href="${gmapsLink}" target="_blank" class="inline-flex items-start text-blue-100 hover:text-white transition group text-sm font-medium bg-black/20 px-4 py-3 rounded-xl hover:bg-black/30 w-full md:w-max">
                    <i class="fas fa-directions mr-2 mt-1 group-hover:scale-110 transition-transform flex-shrink-0"></i> 
                    <span>${station.adresse}<br>${station.code_postal} ${station.ville}</span>
                </a>
            </div>
            
            <div class="p-6 md:p-8">
                <div id="station-map" class="mb-8 border border-slate-200 rounded-xl overflow-hidden"></div>

                <h3 class="font-bold text-lg text-slate-800 mb-4"><i class="fas fa-gas-pump text-indigo-500 mr-2"></i>Prix à la pompe</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
    `;

    let mapMarkersData = [];
    let alternatives = [];

    if (station.lat && station.lon) {
        mapMarkersData.push({ type: 'station_green', lat: station.lat, lon: station.lon, label: station.nom_osm || 'Ici', adresse: `${station.adresse}, ${station.ville}`, id: stationId });
    }
    if (currentProximitySearch && currentProximitySearch.lat && currentProximitySearch.lon) {
        mapMarkersData.push({ type: 'search_point', lat: currentProximitySearch.lat, lon: currentProximitySearch.lon, label: '📍 Point de recherche initial', adresse: currentProximitySearch.labelTitle });
    }

    let aDesPrixAffiches = false;
    
    userFuels.forEach(carb => {
        let data = station.carburants_disponibles[carb];
        let prixActuel = data ? parseFloat(data.prix) : null;
        
        const analyse = analyserPrixProximite(stationId, carb, prixActuel);
        
        if (data) {
            aDesPrixAffiches = true;
            
            let bestBadgeHtml = "";
            let minNat = db.stats.min_prices.national[carb];
            let minReg = db.stats.min_prices.regional[station.region] ? db.stats.min_prices.regional[station.region][carb] : null;
            let minDept = db.stats.min_prices.departemental[station.dept_key] ? db.stats.min_prices.departemental[station.dept_key][carb] : null;

            if (minNat !== null && prixActuel <= minNat) {
                bestBadgeHtml = `<div class="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-1 rounded mt-2 border border-yellow-300 inline-block"><i class="fas fa-star mr-1"></i>Meilleur prix national</div>`;
            } else if (minReg !== null && prixActuel <= minReg) {
                bestBadgeHtml = `<div class="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-1 rounded mt-2 border border-yellow-300 inline-block"><i class="fas fa-star mr-1"></i>Meilleur prix régional</div>`;
            } else if (minDept !== null && prixActuel <= minDept) {
                bestBadgeHtml = `<div class="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-1 rounded mt-2 border border-yellow-300 inline-block"><i class="fas fa-star mr-1"></i>Meilleur prix départemental</div>`;
            }

            let priceColor = analyse.isCheapest ? 'text-green-700' : 'text-slate-900';
            let euroColor = analyse.isCheapest ? 'text-green-500' : 'text-slate-500';

            html += `
                <div class="p-4 rounded-xl border ${analyse.bg || 'bg-white'} ${analyse.border || 'border-slate-200'} relative overflow-hidden transition-shadow hover:shadow-md">
                    <div class="flex justify-between items-start mb-1">
                        <span class="font-bold text-slate-700 text-lg">${carb}</span>
                        <span class="font-black text-2xl ${priceColor}">${data.prix} <span class="text-lg ${euroColor}">€</span></span>
                    </div>
                    <div class="flex justify-end items-center mt-2">
                        <span class="text-slate-400 text-xs font-medium"><i class="fas fa-clock mr-1"></i>${data.date_maj}</span>
                    </div>
                    ${bestBadgeHtml}
                </div>
            `;
        }

        if (analyse.alternative) {
            alternatives.push(analyse.alternative);
        }
    });

    if (!aDesPrixAffiches) {
        html += `<div class="col-span-1 md:col-span-2 p-6 bg-slate-50 rounded-xl text-center text-slate-500 font-medium border border-slate-200"><i class="fas fa-filter text-2xl mb-2 text-slate-300 block"></i>Aucun prix pour vos carburants favoris.</div>`;
    }
    html += `</div>`; 

    if (alternatives.length > 0) {
        let alternativesTitle = currentProximitySearch 
            ? `<i class="fas fa-car-side mr-2"></i>Alternatives dans votre zone de recherche initiale`
            : `<i class="fas fa-car-side mr-2"></i>Alternatives à proximité (-${userRadius}km)`;
            
        html += `<h3 class="font-bold text-lg text-slate-800 mb-4">${alternativesTitle}</h3><div class="space-y-3 mb-8">`;
        let altGroup = {};
        
        alternatives.forEach(alt => {
            if (!altGroup[alt.id]) altGroup[alt.id] = { nom: alt.nom, dist: alt.dist, carbs: [], isBetter: false };
            if (alt.isNew || !alt.isEqual) altGroup[alt.id].isBetter = true; 
            
            let prefix = alt.isNew ? "Non proposé ici, disponible à proximité" : (alt.isEqual ? "Même prix" : "Moins cher");
            altGroup[alt.id].carbs.push(`<span class="font-bold">${alt.carburant}</span> (${alt.prix}€ <span class="italic text-xs">${prefix}</span>)`);
        });

        for (const [altId, info] of Object.entries(altGroup)) {
            let t = !info.isBetter 
                ? { bg: "bg-slate-50", border: "border-slate-300", hoverBg: "hover:bg-slate-100", hoverBorder: "hover:border-slate-400", textMain: "text-slate-700", textSub: "text-slate-500", iconBg: "bg-slate-200", iconText: "text-slate-600", hoverIcon: "group-hover:bg-slate-600", badgeBorder: "border-slate-200", title: "Même prix à proximité" } 
                : { bg: "bg-white", border: "border-green-200", hoverBg: "hover:bg-green-50", hoverBorder: "hover:border-green-400", textMain: "text-green-800", textSub: "text-green-600", iconBg: "bg-green-100", iconText: "text-green-600", hoverIcon: "group-hover:bg-green-500", badgeBorder: "border-green-100", title: "Option intéressante" };

            html += `
                <button onclick="showStation('${altId}')" class="w-full text-left p-4 ${t.bg} border-2 ${t.border} rounded-xl ${t.hoverBg} ${t.hoverBorder} transition shadow-sm flex justify-between items-center group gap-4">
                    <div class="flex-1 min-w-0">
                        <div class="font-extrabold ${t.textMain} text-lg group-hover:opacity-80 transition truncate">${info.nom}</div>
                        <div class="text-sm font-semibold ${t.textSub} mt-1"><i class="fas fa-route mr-1"></i> à ${info.dist.toFixed(1)} km d'ici</div>
                        <div class="text-sm text-slate-600 mt-2 bg-white inline-block px-3 py-1.5 rounded-lg border ${t.badgeBorder} truncate max-w-full shadow-sm leading-tight">📉 <b>${t.title} :</b><br> ${info.carbs.join('<br> ')}</div>
                    </div>
                    <div class="h-10 w-10 flex-shrink-0 ${t.iconBg} rounded-full flex items-center justify-center ${t.hoverIcon} group-hover:text-white transition ${t.iconText}"><i class="fas fa-arrow-right"></i></div>
                </button>
            `;
        }
        html += `</div>`;
    }

    html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div><h3 class="font-bold text-lg mb-3 text-slate-800"><i class="fas fa-clock text-indigo-500 mr-2"></i>Horaires</h3><div class="bg-slate-50 border border-slate-200 p-4 rounded-xl text-sm">`;
    if (station.horaires.automate_24_24) {
        html += `<div class="text-green-600 font-bold bg-green-50 p-3 rounded-xl border border-green-200"><i class="fas fa-check-circle text-xl mr-2"></i> Automate 24/24</div>`;
    } else {
        html += `<ul class="space-y-2 text-slate-700">`;
        for (const [jour, hor] of Object.entries(station.horaires.jours)) {
            const colorClass = (hor !== "Fermé" && !hor.includes("indisponibles")) ? 'text-slate-800' : 'text-red-500 italic';
            html += `<li class="flex border-b border-slate-200 pb-1 last:border-0 last:pb-0"><span class="font-semibold w-28">${jour}</span> <span class="${colorClass}">${hor}</span></li>`;
        }
        html += `</ul>`;
    }
    html += `</div></div>`;

    let aDesRupturesAffichees = false;
    let rupturesHtml = `<div><h3 class="font-bold text-lg mb-3 text-slate-800"><i class="fas fa-ban text-red-500 mr-2"></i>Indisponible</h3><div class="space-y-2">`;
    for (const [carb, data] of Object.entries(station.carburants_en_rupture)) {
        if (!userFuels.includes(carb)) continue;
        aDesRupturesAffichees = true;
        let infoSup = data.motif ? ` (${data.motif})` : '';
        rupturesHtml += `<div class="bg-red-50 border border-red-200 p-3 rounded-xl flex items-center"><div class="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center text-red-500 font-bold flex-shrink-0 mr-3"><i class="fas fa-tint-slash"></i></div><div class="min-w-0"><div class="font-bold text-red-800">${carb}</div><div class="text-xs text-red-600 truncate">Depuis le ${data.debut}${infoSup}</div></div></div>`;
    }
    rupturesHtml += `</div></div>`;
    if(aDesRupturesAffichees) html += rupturesHtml;
    
    html += `</div></div></div>`;

    document.getElementById('station-content').innerHTML = html;
    window.scrollTo(0, 0);
    setTimeout(() => initStationMap(mapMarkersData, false), 100);
}

// ==========================================
// MOTEUR CARTES LEAFLET
// ==========================================

function initStationMap(markersData, isMultiple = false) {
    if (stationMap) { stationMap.remove(); }
    
    if (markersData.length === 0) {
        document.getElementById('station-map').innerHTML = '<div class="h-full w-full flex items-center justify-center bg-slate-50 text-slate-400 font-medium rounded-xl border border-slate-200"><i class="fas fa-map-marker-slash mr-2"></i> Coordonnées GPS indisponibles</div>';
        return;
    }

    stationMap = L.map('station-map', { scrollWheelZoom: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '© OSM (OpenStreetMap)' }).addTo(stationMap);

    let bounds = [];
    const iconBlue = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconGreen = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconOrange = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconRed = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconBlack = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });

    markersData.forEach(m => {
        let icon = iconBlue;
        if (m.type === 'search_point') icon = iconBlack;
        else if (m.type === 'station_green') icon = iconGreen;
        else if (m.type === 'station_orange') icon = iconOrange;
        else if (m.type === 'station_red') icon = iconRed;
        
        let popupBtn = m.id ? `<button onclick="showStation('${m.id}')" class="mt-2 w-full bg-indigo-600 text-white px-2 py-1.5 rounded-md font-bold text-xs hover:bg-indigo-700 transition"><i class="fas fa-eye mr-1"></i> Voir la station-service</button>` : '';
        let popupText = `<div class="text-center min-w-[150px]"><b class="text-slate-800 block mb-1">${m.label || 'Point'}</b><span class="text-xs text-slate-500 leading-tight block">${m.adresse || ''}</span>${popupBtn}</div>`;
        
        const marker = L.marker([m.lat, m.lon], { icon }).bindPopup(popupText).addTo(stationMap);
        if (m.type === 'station_green' || m.type === 'search_point') marker.openPopup();
        bounds.push([m.lat, m.lon]);
    });

    if (bounds.length > 1) {
        stationMap.fitBounds(bounds, { padding: [40, 40] });
    } else {
        stationMap.setView(bounds[0], 14);
    }
}

function initPalmaresMap(markersData) {
    document.getElementById('palmares-map').classList.remove('hidden');
    if (palmaresMap) { palmaresMap.remove(); }
    
    palmaresMap = L.map('palmares-map', { scrollWheelZoom: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '© OSM (OpenStreetMap)' }).addTo(palmaresMap);

    let bounds = [];
    const iconGold = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
    const iconRed = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });

    markersData.forEach(m => {
        let icon = m.isAsc ? iconGold : iconRed;
        let colorText = m.isAsc ? 'text-green-600' : 'text-red-600';
        let popupText = `<div class="text-center min-w-[150px]"><b class="text-slate-800 block mb-1">${m.label}</b><span class="text-xs text-slate-500 leading-tight block mb-2">${m.adresse}</span><div class="font-black ${colorText} text-lg mb-2">${m.prix.toFixed(3)} €</div><button onclick="showStation('${m.id}')" class="w-full bg-indigo-600 text-white px-2 py-1.5 rounded-md font-bold text-xs hover:bg-indigo-700 transition"><i class="fas fa-eye mr-1"></i> Voir</button></div>`;
        
        L.marker([m.lat, m.lon], { icon }).bindPopup(popupText).addTo(palmaresMap);
        bounds.push([m.lat, m.lon]);
    });

    if (bounds.length > 0) palmaresMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
}
