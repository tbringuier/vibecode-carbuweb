export const FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"];
export const LS = { r: 'carbuRadius', f: 'carbuFavorites', v: 'carbuVehicles', av: 'carbuActiveVehicle', fl: 'carbuFuels', w: 'carbuWelcome', ma: 'carbuMaxAge' };
export const ROUTE_F = 1.25, PRICE_EPS = 0.0005, PRICE_NEAR = 0.03, REFRESH_MS = 20 * 60 * 1000;
export const MAX_AGE_DEFAULT = 14, MAX_AGE_OPTIONS = [14, 30, 60, 0];
export const ICONS = ['🚗', '🚙', '🚛', '🏍️', '🚐', '🚌', '⛽'];

export const state = {
  db: null, stationMap: null, palmaresMap: null, searchTimeout: null,
  chartsInit: false, chartP: null, chartF: null,
  proxSearch: null, detailAnchor: null, geoZone: null,
  navStack: [], isRestoring: false,
  favDnD: null, vehicleDnD: null, editVId: null,
  dashSortFuel: null, dashSortDir: 'asc',
  toastT: null, saveT: null, refreshT: null, searchAC: null,
  exploreMap: null, exploreMarkers: null
};

export let radius = parseInt(localStorage.getItem(LS.r), 10) || 10;
export function setRadius(v) { radius = v; }

export let maxAge = (() => {
  const v = parseInt(localStorage.getItem(LS.ma), 10);
  return MAX_AGE_OPTIONS.includes(v) ? v : MAX_AGE_DEFAULT;
})();
export function setMaxAge(v) { maxAge = v; }

export let uFuels = [...FUELS];
export function setUFuels(v) { uFuels = v; }

export let favs = JSON.parse(localStorage.getItem(LS.f)) || [];
export function setFavs(v) { favs = v; }

export let vehicles = JSON.parse(localStorage.getItem(LS.v)) || [];
export function setVehicles(v) { vehicles = v; }

export let activeV = localStorage.getItem(LS.av) || null;
export function setActiveV(v) { activeV = v; }

export const saveFavs = () => localStorage.setItem(LS.f, JSON.stringify(favs));
export const saveVehicles = () => localStorage.setItem(LS.v, JSON.stringify(vehicles));
