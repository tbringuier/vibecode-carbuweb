// Tests unitaires du front (Node >= 22, modules intégrés uniquement : pas de npm).
//   node --test tests/front.test.mjs
// Les modules testés n'accèdent pas au DOM au chargement (localStorage absent : lectures tolérées).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const { fmtP, fmtEur, fmtCts, fmtKm, titleCase, norm, E } = await import('../templates/js/helpers.js');
const { openStatus, parisNow } = await import('../templates/js/hours.js');
const { isExpired, freshBadge } = await import('../templates/js/freshness.js');
const { cleanFav, cleanVehicle, importPrefs, prefs, favKey } = await import('../templates/js/state.js');
const nb = s => s.replace(/[  ]/g, ' ');

test('formats de prix français', () => {
  assert.equal(nb(fmtP(1.789)), '1,789');
  assert.equal(nb(fmtP('2.04')), '2,040');
  assert.equal(nb(fmtEur(0.9)), '0,900 €');
  assert.equal(fmtP(NaN), '—');
  assert.equal(nb(fmtCts(0.012)), '+1,2 ct');
  assert.equal(nb(fmtCts(-0.008)), '−0,8 ct');
  assert.equal(nb(fmtCts(0.00001)), '= 0 ct');
  assert.equal(nb(fmtKm(4)), '~5,0 km');
});

test('casse et normalisation', () => {
  assert.equal(titleCase('SAINT-DENIS-LÈS-BOURG'), 'Saint-Denis-lès-Bourg');
  assert.equal(titleCase('Rue de Paris'), 'Rue de Paris');
  assert.equal(norm("Provence-Alpes-Côte d'Azur"), 'provence alpes cote d azur');
  assert.equal(E('<a href="x">\'</a>'), '&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
});

test('horaires : ouvert / fermé (heure de Paris)', () => {
  const days = ['07:00-21:00', '07:00-21:00', '07:00-12:00,14:00-19:00', '', null, '22:00-02:00', '00:00-00:00'];
  const s = { hours: { auto: false, days } };
  assert.deepEqual(openStatus(s, { day: 0, min: 8 * 60 }), { open: true, soon: false, label: 'jusqu’à 21h00' });
  assert.equal(openStatus(s, { day: 0, min: 20 * 60 + 45 }).soon, true);
  assert.equal(openStatus(s, { day: 2, min: 13 * 60 }).label, 'ouvre à 14h00');
  assert.equal(openStatus(s, { day: 3, min: 10 * 60 }).label, 'réouverture non communiquée');
  assert.equal(openStatus(s, { day: 4, min: 10 * 60 }), null);
  assert.equal(openStatus(s, { day: 6, min: 60 }).open, true, 'créneau de la veille après minuit');
  assert.equal(openStatus(s, { day: 6, min: 12 * 60 }).label, '24h/24 aujourd’hui');
  assert.equal(openStatus({ hours: { auto: true, days: null } }).auto, true);
  assert.equal(openStatus({ hours: null }), null);
  const now = parisNow(new Date('2026-11-30T23:30:00Z'));  // lundi 00:30 à Paris (UTC+1)
  assert.deepEqual(now, { day: 1, min: 30 });
});

test('fraîcheur et filtre d’ancienneté', () => {
  const d = n => ({ p: 1.8, t: Date.now() - n * 86400000 - 3600000 });
  assert.equal(isExpired(d(3), 14), false);
  assert.equal(isExpired(d(20), 14), true);
  assert.equal(isExpired(d(400), 0), false);
  assert.equal(freshBadge(d(2)), '');
  assert.match(freshBadge(d(10)), /warn/);
  assert.match(freshBadge(d(40)), /&gt;1 mois/);
});

test('validation des favoris / véhicules (stockage corrompu)', () => {
  assert.equal(cleanFav({ type: 'station', id: 'abc' }), null);
  assert.equal(cleanFav({ type: 'address', lat: 'x', lon: 2 }), null);
  assert.deepEqual(cleanFav({ type: 'address', lat: '48.1', lon: '-1.6', name: 'Rennes', radius: '500' }), { type: 'address', id: '48.10000--1.60000', name: 'Rennes', lat: 48.1, lon: -1.6, radius: 50 });
  assert.equal(cleanVehicle({ id: 'v1', name: 'A', fuels: ['Kérosène'] }), null);
  assert.deepEqual(cleanVehicle({ id: 'v1', name: 'Clio', icon: '💥', fuels: ['SP98', 'E10'], tank: '45' }), { id: 'v1', name: 'Clio', icon: '🚗', fuels: ['E10', 'SP98'], tank: 45 });
  // La clé d'un lieu favori doit se retrouver depuis son adresse #p/lat,lon (5 décimales).
  assert.equal(favKey(45.7578137, 4.8320114), favKey(+(45.7578137).toFixed(5), +(4.8320114).toFixed(5)));
  assert.throws(() => importPrefs({ app: 'autre' }));
  importPrefs({ app: 'carbuweb', history: { period: 'x', gran: '<b>', cmp: 'false' } });
  assert.deepEqual(prefs.hist, { period: '1y', gran: 'auto', cmp: true }, 'préférences historique validées');
  const r = importPrefs({ app: 'carbuweb', favorites: [{ type: 'station', id: '1000001' }, { type: 'station', id: '1000001' }, null], vehicles: [], fuels: [] });
  assert.equal(r.favs, 1, 'doublons et entrées invalides écartés');
  assert.equal(prefs.fuels.length, 6, 'sélection vide -> tous les carburants');
});

// Décodage des fichiers réellement générés (si un build est présent).
const BUILD = new URL('../build/', import.meta.url);
const dataPath = new URL('data.json', BUILD);
test('hydratation de build/data.json + stations.<hash>.json', { skip: !existsSync(dataPath) && 'pas de build' }, async () => {
  const live = JSON.parse(readFileSync(dataPath, 'utf8'));
  const sd = JSON.parse(readFileSync(new URL(live.stations, BUILD), 'utf8'));
  assert.equal(live.v, 2);
  assert.equal(sd.s.length, live.n);
  assert.equal(live.p.length, live.n);
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => (String(url).startsWith('data.json') ? live : sd) });
  const { loadData, station, zoneStats, searchIndex } = await import('../templates/js/data.js');
  const { state } = await import('../templates/js/state.js');
  assert.equal(await loadData(), true);
  assert.equal(state.db.list.length, live.n);
  const s = state.db.list[0];
  assert.ok(s.id && s.name && Number.isFinite(s.lat) && s.dept && s.region, 'station complète');
  assert.equal(station(s.id), s);
  const f = Object.values(state.db.list.find(x => Object.keys(x.fuels).length).fuels)[0];
  assert.ok(f.p > 0.3 && f.p < 4 && f.t > Date.UTC(2020, 0, 1), 'prix et horodatage décodés');
  const st = zoneStats();
  assert.ok(st.fr.Gazole.n > 1000 && st.fr.Gazole.avg > 1 && st.fr.Gazole.min <= st.fr.Gazole.avg);
  assert.ok(searchIndex().length === live.n);
  assert.equal(await loadData(), false, 'données inchangées : pas de nouvelle hydratation');
  assert.ok(readdirSync(BUILD).filter(n => /^stations\..+\.json$/.test(n)).length === 1, 'un seul fichier stations publié');
});
