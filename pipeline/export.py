"""Export compact des donnees servies au navigateur (build/data.json + build/stations.<hash>.json).

La base du jour (datasets/database-*.json) reste au format complet : elle sert a
l'historique et au debogage. Le navigateur recoit un format en tableaux, ~7x plus
leger, decoupe en deux fichiers pour economiser les donnees mobiles :

- ``stations.<hash>.json`` : donnees quasi statiques (nom, adresse, coordonnees).
  Nom adresse par contenu : telecharge une fois, puis servi par le cache HTTP tant
  que rien ne change.
- ``data.json`` : prix et ruptures, alignes ligne a ligne sur le fichier stations
  qu'il reference. C'est le seul fichier re-telecharge a chaque mise a jour.

Format (v3), decode par ``templates/js/data.js`` :

stations.<hash>.json
    {"v":3, "fuels":[...], "regions":[nom...], "depts":[[nom, code, i_region]...],
     "brands":[nom...],
     "s":[[id, i_brand|-1, osm, adresse, ville, cp, i_dept, lat, lon], ...]}
    osm      "n123" / "w123" / "r123" (noeud, chemin, relation OpenStreetMap) ou ""
    (les horaires d'ouverture ne sont pas publies : trop souvent absents ou faux dans la source)

data.json
    {"v":3, "built":iso, "updated":iso, "updated_label":"28/11/2026 a 01:05",
     "stations":"stations.<hash>.json", "n":nb, "t0":minutes epoch,
     "p":[[i_carburant, prix millimes, minutes depuis t0, ...], ...],   # aligne sur "s"
     "r":{"<index station>":[i_carburant, jour depuis 1970, ...]}}       # ruptures recentes
"""

import hashlib
import json
import logging
import os
import re
from collections import Counter, defaultdict
from datetime import date, datetime, time as dtime
from zoneinfo import ZoneInfo

from .config import ALL_FUELS, EXPORT_RUPTURE_MAX_AGE_DAYS, TODAY

log = logging.getLogger("carbuweb")

PARIS = ZoneInfo("Europe/Paris")
EPOCH = date(1970, 1, 1)
FORMAT_VERSION = 3
_OSM_RE = re.compile(r"openstreetmap\.org/(node|way|relation)/(\d+)")
# Codes officiels de la Corse : le code postal (20xxx) ne distingue pas les deux departements.
_CORSICA = {"Corse-du-Sud": "2A", "Haute-Corse": "2B"}


def cp_dept_code(cp):
    """Code departement deduit du code postal (97x pour l'outre-mer)."""
    cp = str(cp or "").strip()
    if len(cp) < 2 or not cp[:2].isdigit():
        return ""
    return cp[:3] if cp.startswith("97") else cp[:2]


def osm_ref(url):
    m = _OSM_RE.search(str(url or ""))
    return f"{m.group(1)[0]}{m.group(2)}" if m else ""


def entry_minutes(entry):
    """Horodatage d'un prix en minutes depuis l'epoch (date seule : midi heure de Paris)."""
    iso = entry.get("maj_iso")
    if iso:
        try:
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=PARIS)
            return int(dt.timestamp() // 60)
        except ValueError:
            pass
    raw = str(entry.get("date_maj") or "")[:10]
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        return None
    return int(datetime.combine(d, dtime(12, 0), PARIS).timestamp() // 60)


def _resolve_depts(stations):
    """Departement (nom, region) fiable par station + table {nom: code} des departements.

    Le code postal ne suffit pas (communes limitrophes, Corse) : le nom de departement de la
    source fait foi ; s'il est inconnu, on prend le departement le plus frequent du code postal.
    """
    by_prefix = defaultdict(Counter)
    region_of = defaultdict(Counter)
    for st in stations.values():
        name, region = st.get("departement") or "", st.get("region") or ""
        if name and not name.startswith("Inconnu"):
            by_prefix[cp_dept_code(st.get("code_postal"))][name] += 1
            if region and region != "Inconnue":
                region_of[name][region] += 1
    codes = {}
    for prefix, names in by_prefix.items():
        for name, n in names.items():
            codes.setdefault(name, Counter())[prefix] += n
    dept_code = {name: _CORSICA.get(name) or c.most_common(1)[0][0] for name, c in codes.items()}
    resolved = {}
    for sid, st in stations.items():
        name = st.get("departement") or ""
        if not name or name.startswith("Inconnu"):
            guess = by_prefix.get(cp_dept_code(st.get("code_postal")))
            name = guess.most_common(1)[0][0] if guess else ""
        region = st.get("region") or ""
        if not region or region == "Inconnue":
            region = region_of[name].most_common(1)[0][0] if region_of.get(name) else ""
        resolved[sid] = (name, region)
    return resolved, dept_code


def build_payloads(db, today=None):
    """Construit (stations_doc, data_doc_sans_nom_de_fichier) a partir de la base complete."""
    today = today or date.fromisoformat(TODAY)
    stations = db.get("stations") or {}
    fuel_idx = {f: i for i, f in enumerate(ALL_FUELS)}
    resolved, dept_code = _resolve_depts(stations)

    regions = sorted({r for _, r in resolved.values() if r}, key=str.casefold)
    region_idx = {r: i for i, r in enumerate(regions)}
    dept_names = sorted({n for n, _ in resolved.values() if n}, key=lambda n: (dept_code.get(n, "zz"), n))
    dept_region = {}
    for name, region in resolved.values():
        if name and region:
            dept_region.setdefault(name, region)
    depts = [[n, dept_code.get(n, ""), region_idx.get(dept_region.get(n), -1)] for n in dept_names]
    dept_idx = {n: i for i, n in enumerate(dept_names)}

    brands = {}
    rows, prices, ruptures = [], [], {}
    stamps = []
    min_day = (today - EPOCH).days - EXPORT_RUPTURE_MAX_AGE_DAYS
    for sid in sorted(stations, key=lambda s: (len(s), s)):
        st = stations[sid]
        if st.get("lat") is None or st.get("lon") is None:
            continue
        name, _ = resolved[sid]
        brand = st.get("nom_osm") or ""
        if brand and brand not in brands:
            brands[brand] = len(brands)
        rows.append([
            sid,
            brands[brand] if brand else -1,
            osm_ref(st.get("url_osm")),
            st.get("adresse") or "",
            st.get("ville") or "",
            st.get("code_postal") or "",
            dept_idx.get(name, -1),
            round(float(st["lat"]), 5),
            round(float(st["lon"]), 5),
        ])
        p = []
        for fuel in ALL_FUELS:
            e = (st.get("carburants_disponibles") or {}).get(fuel)
            if not e:
                continue
            try:
                millis = round(float(e["prix"]) * 1000)
            except (KeyError, TypeError, ValueError):
                continue
            m = entry_minutes(e)
            if m is None:
                continue
            p += [fuel_idx[fuel], millis, m]
            stamps.append(m)
        prices.append(p)
        r = []
        for fuel, info in (st.get("carburants_en_rupture") or {}).items():
            if fuel not in fuel_idx:
                continue
            try:
                d = (date.fromisoformat(str(info.get("debut"))[:10]) - EPOCH).days
            except ValueError:
                continue
            if d >= min_day:
                r += [fuel_idx[fuel], d]
        if r:
            ruptures[str(len(rows) - 1)] = r

    t0 = min(stamps) if stamps else 0
    for p in prices:
        for k in range(2, len(p), 3):
            p[k] -= t0

    stations_doc = {
        "v": FORMAT_VERSION,
        "fuels": ALL_FUELS,
        "regions": regions,
        "depts": depts,
        "brands": list(brands),
        "s": rows,
    }
    meta = db.get("meta") or {}
    data_doc = {
        "v": FORMAT_VERSION,
        "built": datetime.now(PARIS).isoformat(timespec="minutes"),
        "updated": meta.get("latest_fuel_price_update_iso") or "",
        "updated_label": meta.get("latest_fuel_price_update_label_fr") or "—",
        "n": len(rows),
        "t0": t0,
        "p": prices,
        "r": ruptures,
    }
    return stations_doc, data_doc


def _dumps(doc):
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))


def write_frontend_data(db, build_dir, today=None):
    """Ecrit data.json + stations.<hash>.json dans build_dir. Retourne le nom du fichier stations."""
    stations_doc, data_doc = build_payloads(db, today)
    stations_text = _dumps(stations_doc)
    digest = hashlib.sha1(stations_text.encode("utf-8")).hexdigest()[:12]
    stations_name = f"stations.{digest}.json"
    with open(os.path.join(build_dir, stations_name), "w", encoding="utf-8") as f:
        f.write(stations_text)
    data_doc["stations"] = stations_name
    data_text = _dumps(data_doc)
    tmp = os.path.join(build_dir, "data.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data_text)
    os.replace(tmp, os.path.join(build_dir, "data.json"))
    # Un seul fichier stations est reference : les anciens ne servent plus (un client en retard
    # sur data.json recharge simplement data.json, voir data.js).
    for name in os.listdir(build_dir):
        if name.startswith("stations.") and name.endswith(".json") and name != stations_name:
            os.remove(os.path.join(build_dir, name))
    log.info(
        "Donnees navigateur : %s (%d Ko) + data.json (%d Ko), %d stations.",
        stations_name, len(stations_text.encode()) // 1024, len(data_text.encode()) // 1024, data_doc["n"],
    )
    return stations_name
