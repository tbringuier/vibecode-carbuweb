#!/usr/bin/env python3
"""Carbu'Web - Build pipeline.

Downloads government fuel price data, enriches it with OpenStreetMap station
names, computes statistics, and produces a static site ready to be served.

Usage:
    python main.py
"""

import glob
import json
import logging
import os
import re
import shutil
import time
import unicodedata
from datetime import datetime

import pandas as pd
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("carbuweb")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASETS_DIR = os.path.join(BASE_DIR, "datasets")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
BUILD_DIR = os.path.join(BASE_DIR, "build")

TODAY = datetime.now().strftime("%Y-%m-%d")

EXCEL_FILE = os.path.join(DATASETS_DIR, f"prix-carburant-{TODAY}.xlsx")
OSM_FILE = os.path.join(DATASETS_DIR, f"osm_mapping-{TODAY}.json")
DB_FILE = os.path.join(DATASETS_DIR, f"database-{TODAY}.json")

EXCEL_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-carburants-quotidien/exports/xlsx"
    "?lang=fr&timezone=Europe%2FParis&use_labels=true"
)

ALL_FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]

# Instances Overpass publiques (rotation en cas de 504 / surcharge). Ordre : miroir FR puis instance principale.
# Voir https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
OVERPASS_ENDPOINTS = (
    "https://overpass.openstreetmap.fr/api/interpreter",        # Miroir FR, parfait pour tes données
    "https://overpass-api.de/api/interpreter",                  # Instance principale (fiable mais limites strictes)
)

OVERPASS_MAX_ATTEMPTS = 100

# Ton User-Agent est parfait : explicite, pointe vers le repo et donne la raison d'utilisation. 
# C'est la meilleure pratique pour éviter les bannissements sur ces API publiques.
HTTP_USER_AGENT = (
    "CarbuWeb-build/1.0 (+https://github.com/tbringuier/vibecode-carburant; "
    "dataset enrichment ref:FR:prix-carburants)"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def cleanup_old_files():
    """Remove dataset files from previous days."""
    os.makedirs(DATASETS_DIR, exist_ok=True)
    for path in glob.glob(os.path.join(DATASETS_DIR, "*")):
        if TODAY not in os.path.basename(path):
            try:
                os.remove(path)
            except OSError:
                pass


def normalize_text(text):
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", str(text)).encode("ASCII", "ignore").decode()
    text = re.sub(r"[-']", " ", text).lower()
    return re.sub(r"\s+", " ", text).strip()


def fetch(url, *, method="get", data=None, stream=False, timeout=300, retries=10):
    """HTTP request with exponential back-off."""
    for attempt in range(1, retries + 1):
        try:
            resp = (
                requests.get(url, stream=stream, timeout=timeout)
                if method == "get"
                else requests.post(url, data=data, timeout=timeout)
            )
            resp.raise_for_status()
            return resp
        except Exception as exc:
            log.warning("Attempt %d/%d failed: %s", attempt, retries, exc)
            if attempt < retries:
                time.sleep(min(5 * attempt, 30))
            else:
                raise


def purge_infinity(d):
    """Replace float('inf') values with None (JSON-safe)."""
    for k, v in list(d.items()):
        if isinstance(v, dict):
            purge_infinity(v)
        elif v == float("inf"):
            d[k] = None


def parse_hours(raw):
    """Parse the government XML-style hours field into a clean dict."""
    if not raw or raw == "":
        return {"automate_24_24": False, "jours": {"Statut": "Horaires indisponibles"}}
    try:
        h = json.loads(str(raw))
        auto = h.get("@automate-24-24") == "1"
        days = {}
        for j in h.get("jour", []):
            name = j.get("@nom")
            if j.get("@ferme") == "1":
                days[name] = "Fermé"
            else:
                slots = j.get("horaire")
                if isinstance(slots, dict):
                    days[name] = f"{slots.get('@ouverture')} - {slots.get('@fermeture')}"
                elif isinstance(slots, list):
                    days[name] = " / ".join(
                        f"{s.get('@ouverture')} - {s.get('@fermeture')}" for s in slots
                    )
                else:
                    days[name] = "Horaires indisponibles"
        return {"automate_24_24": auto, "jours": days}
    except Exception:
        return {"automate_24_24": False, "jours": {"Statut": "Horaires indisponibles"}}


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download_prices():
    log.info("Downloading fuel prices for %s ...", TODAY)
    resp = fetch(EXCEL_URL, stream=True, timeout=120, retries=10)
    with open(EXCEL_FILE, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    log.info("Fuel prices downloaded.")


def download_osm():
    log.info(
        "Querying Overpass API for station names (up to %d attempts, %d mirrors) ...",
        OVERPASS_MAX_ATTEMPTS,
        len(OVERPASS_ENDPOINTS),
    )
    query = (
        '[out:json][timeout:300];'
        '(node["ref:FR:prix-carburants"];'
        'way["ref:FR:prix-carburants"];'
        'relation["ref:FR:prix-carburants"];);out tags;'
    )
    headers = {"User-Agent": HTTP_USER_AGENT}
    payload = {"data": query}
    last_exc = None
    resp = None
    for attempt in range(1, OVERPASS_MAX_ATTEMPTS + 1):
        url = OVERPASS_ENDPOINTS[(attempt - 1) % len(OVERPASS_ENDPOINTS)]
        try:
            r = requests.post(url, data=payload, headers=headers, timeout=300)
            r.raise_for_status()
            resp = r
            log.info("Overpass OK on attempt %d/%d (%s)", attempt, OVERPASS_MAX_ATTEMPTS, url)
            break
        except Exception as exc:
            last_exc = exc
            log.warning(
                "Attempt %d/%d failed (%s): %s",
                attempt,
                OVERPASS_MAX_ATTEMPTS,
                url,
                exc,
            )
            if attempt < OVERPASS_MAX_ATTEMPTS:
                # Pause plus longue après plusieurs échecs d’affilée sur le même miroir
                cycle = (attempt - 1) // len(OVERPASS_ENDPOINTS) + 1
                time.sleep(min(5 * cycle, 120))
    if resp is None:
        raise last_exc

    mapping = {}
    for el in resp.json().get("elements", []):
        tags = el.get("tags", {})
        sid = tags.get("ref:FR:prix-carburants")
        if sid:
            mapping[sid] = {
                "nom": tags.get("name", tags.get("brand", "Nom de station-service Inconnu")),
                "url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
            }
    with open(OSM_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False)
    log.info("OSM mapping built — %d stations.", len(mapping))


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def build_database():
    log.info("Building database ...")
    df = pd.read_excel(EXCEL_FILE, dtype={"Code postal": str}).fillna("")

    with open(OSM_FILE, "r", encoding="utf-8") as f:
        osm = json.load(f)

    db = {
        "stations": {},
        "geo_tree": {},
        "cp_index": {},
        "recherche_texte": {},
        "dashboard": {},
        "stats": {
            "moyennes_nationales": {},
            "min_prices": {
                "national": {c: float("inf") for c in ALL_FUELS},
                "regional": {},
                "departemental": {},
            },
        },
    }

    nat_sum = {c: 0.0 for c in ALL_FUELS}
    nat_cnt = {c: 0 for c in ALL_FUELS}
    nat_presence = {c: 0 for c in ALL_FUELS}
    reg_agg = {}

    for _, row in df.iterrows():
        sid = str(row["id"])
        region = str(row["Région"]).strip() or "Inconnue"
        dept = str(row["Département"]).strip() or "Inconnu"
        city = str(row["ville"]).strip().upper() or "INCONNUE"
        cp = str(row["Code postal"]).strip()
        addr = str(row["adresse"]).strip()
        dk = f"{region}_{dept}"

        if region not in reg_agg:
            reg_agg[region] = {
                "station_count": 0,
                "sum": {c: 0.0 for c in ALL_FUELS},
                "cnt": {c: 0 for c in ALL_FUELS},
            }
        mins = db["stats"]["min_prices"]
        if region not in mins["regional"]:
            mins["regional"][region] = {c: float("inf") for c in ALL_FUELS}
        if dk not in mins["departemental"]:
            mins["departemental"][dk] = {c: float("inf") for c in ALL_FUELS}

        geom = str(row["geom"]).strip()
        lat, lon = None, None
        if geom and "," in geom:
            try:
                parts = geom.split(",")
                lat, lon = float(parts[0]), float(parts[1])
            except ValueError:
                pass

        if sid not in db["stations"]:
            reg_agg[region]["station_count"] += 1
            osm_info = osm.get(sid, {"nom": None, "url": None})
            db["stations"][sid] = {
                "nom_osm": osm_info["nom"],
                "url_osm": osm_info["url"],
                "adresse": addr,
                "ville": city,
                "code_postal": cp,
                "region": region,
                "departement": dept,
                "dept_key": dk,
                "lat": lat,
                "lon": lon,
                "horaires": parse_hours(row["horaires"]),
                "carburants_disponibles": {},
                "carburants_en_rupture": {},
            }

            db["geo_tree"].setdefault(region, {}).setdefault(dept, {}).setdefault(city, [])
            if sid not in db["geo_tree"][region][dept][city]:
                db["geo_tree"][region][dept][city].append(sid)

            db["cp_index"].setdefault(cp, [])
            if sid not in db["cp_index"][cp]:
                db["cp_index"][cp].append(sid)

            label = osm_info["nom"] or "Station-service"
            db["recherche_texte"][sid] = {
                "texte_norm": normalize_text(f"{osm_info['nom'] or ''} {city} {addr} {cp}"),
                "label_affichage": f"{label} - {addr}, {cp} {city}",
            }

        fuel = row["Carburant"]
        date_raw = str(row["Mise à jour des prix"])[:10] if row["Mise à jour des prix"] else ""

        obsolete = False
        if date_raw:
            try:
                age = (datetime.strptime(TODAY, "%Y-%m-%d") - datetime.strptime(date_raw, "%Y-%m-%d")).days
                obsolete = age > 7
            except Exception:
                pass

        if fuel:
            if obsolete:
                db["stations"][sid]["carburants_en_rupture"][fuel] = {
                    "debut": date_raw,
                    "motif": "Obsolète (>7 jours)",
                }
            else:
                price = float(row["Prix"])
                db["stations"][sid]["carburants_disponibles"][fuel] = {
                    "prix": price,
                    "date_maj": date_raw,
                }
                if fuel in ALL_FUELS:
                    nat_sum[fuel] += price
                    nat_cnt[fuel] += 1
                    nat_presence[fuel] += 1
                    reg_agg[region]["sum"][fuel] += price
                    reg_agg[region]["cnt"][fuel] += 1
                    if price < mins["national"][fuel]:
                        mins["national"][fuel] = price
                    if price < mins["regional"][region][fuel]:
                        mins["regional"][region][fuel] = price
                    if price < mins["departemental"][dk][fuel]:
                        mins["departemental"][dk][fuel] = price

        rupt = row["Carburant en rupture"]
        if rupt and rupt not in db["stations"][sid]["carburants_en_rupture"]:
            db["stations"][sid]["carburants_en_rupture"][rupt] = {
                "debut": str(row["Début rupture"])[:10] if row["Début rupture"] else "Inconnue",
                "motif": "Rupture signalée",
            }

    db["dashboard"] = {
        "national": {
            "avg_prices": {
                c: round(nat_sum[c] / nat_cnt[c], 3) if nat_cnt[c] else 0
                for c in ALL_FUELS
            },
            "fuel_presence": nat_presence,
        },
        "regional": {
            r: {
                "station_count": d["station_count"],
                "avg_prices": {
                    c: round(d["sum"][c] / d["cnt"][c], 3) if d["cnt"][c] else 0
                    for c in ALL_FUELS
                },
            }
            for r, d in reg_agg.items()
        },
    }

    purge_infinity(db["stats"]["min_prices"])

    # Build department-level dashboard
    dept_dash = {}
    for sid, st in db["stations"].items():
        dk = st["dept_key"]
        if dk not in dept_dash:
            dept_dash[dk] = {
                "nom": st["departement"],
                "region": st["region"],
                "station_count": 0,
                "sum": {c: 0.0 for c in ALL_FUELS},
                "cnt": {c: 0 for c in ALL_FUELS},
            }
        dept_dash[dk]["station_count"] += 1
        for c in ALL_FUELS:
            if c in st.get("carburants_disponibles", {}):
                p = st["carburants_disponibles"][c]["prix"]
                dept_dash[dk]["sum"][c] += p
                dept_dash[dk]["cnt"][c] += 1
    db["dashboard"]["departemental"] = {
        dk: {
            "nom": d["nom"],
            "region": d["region"],
            "station_count": d["station_count"],
            "avg_prices": {
                c: round(d["sum"][c] / d["cnt"][c], 3) if d["cnt"][c] else 0
                for c in ALL_FUELS
            },
        }
        for dk, d in dept_dash.items()
    }

    # Build department and region search indexes
    dept_index = {}  # code -> { name, region, station_ids }
    region_index = {}  # normalized_name -> { name, station_ids }
    for sid, st in db["stations"].items():
        cp = st["code_postal"]
        dept_code = cp[:3] if cp.startswith("97") else cp[:2]
        dept_name = st["departement"]
        region_name = st["region"]
        if dept_code not in dept_index:
            dept_index[dept_code] = {
                "nom": dept_name,
                "region": region_name,
                "nom_norm": normalize_text(dept_name),
                "stations": [],
            }
        dept_index[dept_code]["stations"].append(sid)
        if region_name not in region_index:
            region_index[region_name] = {
                "nom": region_name,
                "nom_norm": normalize_text(region_name),
                "stations": [],
            }
        region_index[region_name]["stations"].append(sid)
    db["dept_index"] = dept_index
    db["region_index"] = region_index

    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False)
    log.info("Database ready — %d stations.", len(db["stations"]))


# ---------------------------------------------------------------------------
# Minification
# ---------------------------------------------------------------------------

def minify_html(src):
    """Lightweight HTML minifier — collapses whitespace, strips comments."""
    src = re.sub(r"<!--.*?-->", "", src, flags=re.DOTALL)
    src = re.sub(r">\s+<", "><", src)
    src = re.sub(r"\s{2,}", " ", src)
    return src.strip()


def minify_js(src):
    """Strip JS single-line comments and collapse blank lines."""
    lines = []
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        if stripped:
            lines.append(line.rstrip())
    return "\n".join(lines)


def minify_json(path_in, path_out):
    """Re-serialize JSON without whitespace (saves ~40 %)."""
    with open(path_in, "r", encoding="utf-8") as f:
        data = json.load(f)
    with open(path_out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Site generation
# ---------------------------------------------------------------------------

def generate_site():
    os.makedirs(BUILD_DIR, exist_ok=True)

    # data.json — compact
    minify_json(DB_FILE, os.path.join(BUILD_DIR, "data.json"))

    # index.html — inject build date + minify
    with open(os.path.join(TEMPLATES_DIR, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    html = html.replace("{{BUILD_DATE}}", TODAY)
    with open(os.path.join(BUILD_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(minify_html(html))

    # app.js — minify
    with open(os.path.join(TEMPLATES_DIR, "app.js"), "r", encoding="utf-8") as f:
        js = f.read()
    with open(os.path.join(BUILD_DIR, "app.js"), "w", encoding="utf-8") as f:
        f.write(minify_js(js))

    for extra in ("manifest.webmanifest", "sw.js", "icon.svg"):
        src = os.path.join(TEMPLATES_DIR, extra)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(BUILD_DIR, extra))

    log.info("Static site written to %s/", BUILD_DIR)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log.info("Carbu'Web build started for %s", TODAY)

    cleanup_old_files()

    if not os.path.exists(DB_FILE):
        if not os.path.exists(EXCEL_FILE):
            download_prices()
        if not os.path.exists(OSM_FILE):
            download_osm()
        build_database()
    else:
        log.info("Existing database found, skipping download.")

    generate_site()
    log.info("Build complete.")


if __name__ == "__main__":
    main()
