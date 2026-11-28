const LIBS = {
  leafletCss: { url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', sri: 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H' },
  leaflet: { url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', sri: 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH' },
  chart: { url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js', sri: 'sha384-T/4KgSWuZEPozpPz7rnnp/5lDSnpY1VPJCojf1S81uTHS1E38qgLfMgVsAeRCWc4' }
};
const pending = new Map();
function load(key, make) {
  if (!pending.has(key)) {
    const p = new Promise((resolve, reject) => {
      const lib = LIBS[key], el = make(lib.url);
      el.integrity = lib.sri;
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve();
      el.onerror = () => { pending.delete(key); el.remove(); reject(new Error(`Chargement impossible : ${lib.url}`)); };
      document.head.appendChild(el);
    });
    pending.set(key, p);
  }
  return pending.get(key);
}
const script = url => { const s = document.createElement('script'); s.src = url; s.async = true; return s; };
const sheet = url => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; return l; };
export const loadLeaflet = () => Promise.all([load('leafletCss', sheet), load('leaflet', script)]).then(() => window.L);
export const loadChart = () => load('chart', script).then(() => window.Chart);