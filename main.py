#!/usr/bin/env python3
"""Carbu'Web - Build pipeline.

Downloads government fuel price data, enriches it with OpenStreetMap station
names, computes statistics, and produces a static site ready to be served.

Usage:
    python main.py
"""

import glob
import html as html_lib
import json
import logging
import os
import re
import shutil
import subprocess
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

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


def _resolve_build_date():
    """Date calendaire des fichiers dataset (YYYY-MM-DD).

    Sur CI, GitHub Actions définit CARBUWEB_BUILD_DATE (Europe/Paris) pour
    aligner les noms de fichiers avec la clé du cache OpenStreetMap.
    """
    raw = os.environ.get("CARBUWEB_BUILD_DATE", "").strip()
    if raw and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    return datetime.now().strftime("%Y-%m-%d")


TODAY = _resolve_build_date()

EXCEL_FILE = os.path.join(DATASETS_DIR, f"prix-carburant-{TODAY}.xlsx")
EXCEL_RT_FILE = os.path.join(DATASETS_DIR, f"prix-carburant-flux-{TODAY}.xlsx")
OSM_FILE = os.path.join(DATASETS_DIR, f"osm_mapping-{TODAY}.json")
DB_FILE = os.path.join(DATASETS_DIR, f"database-{TODAY}.json")

EXCEL_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-carburants-quotidien/exports/xlsx"
    "?lang=fr&timezone=Europe%2FParis&use_labels=true"
)

EXCEL_RT_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/exports/xlsx"
    "?lang=fr&timezone=Europe%2FParis&use_labels=true"
)

ALL_FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]

# Au-delà de ce délai (jours calendaires depuis la date de mise à jour du prix), la donnée est ignorée.
MAX_PRICE_DATA_AGE_DAYS = 7

# Colonnes flux instantané (export XLSX data.gouv, libellés FR)
RT_FUEL_COLUMNS = (
    ("Gazole", "Prix Gazole", "Prix Gazole mis à jour le"),
    ("SP95", "Prix SP95", "Prix SP95 mis à jour le"),
    ("E10", "Prix E10", "Prix E10 mis à jour le"),
    ("SP98", "Prix SP98", "Prix SP98 mis à jour le"),
    ("E85", "Prix E85", "Prix E85 mis à jour le"),
    ("GPLc", "Prix GPLc", "Prix GPLc mis à jour le"),
)

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


def parse_geom_lat_lon(geom_str):
    """Extrait (lat, lon) depuis le champ geom « lat, lon »."""
    if geom_str is None or (isinstance(geom_str, float) and pd.isna(geom_str)):
        return None, None
    s = str(geom_str).strip().replace(" ", "")
    if "," not in s:
        return None, None
    a, b = s.split(",", 1)
    try:
        return float(a), float(b)
    except ValueError:
        return None, None


def station_address_correlation_key(adresse, cp, ville):
    return "|".join(
        (
            normalize_text(str(adresse or "")),
            str(cp or "").strip(),
            normalize_text(str(ville or "")),
        )
    )


def normalize_price_update_iso(raw):
    """Chaîne ISO 8601 exploitable (souvent avec offset) pour stockage et comparaison.

    Les exports Excel utilisent souvent « YYYY-MM-DD HH:MM:SS » sans « T » ; on normalise.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        return None
    if "T" not in s:
        m = re.match(r"^(\d{4}-\d{2}-\d{2})[\sT]+(.+)$", s)
        if m:
            s = m.group(1) + "T" + m.group(2).lstrip()
    if "T" not in s:
        return None
    return s.replace(" ", "")


def _calendar_age_days(ref_cal: str, update_date: str) -> int | None:
    """Nombre de jours entre update_date (AAAA-MM-JJ) et ref_cal (inclus). None si invalide."""
    if not update_date or len(update_date) < 10:
        return None
    d = update_date[:10]
    try:
        return (
            datetime.strptime(ref_cal, "%Y-%m-%d") - datetime.strptime(d, "%Y-%m-%d")
        ).days
    except ValueError:
        return None


def _price_row_is_stale_by_calendar(update_date: str) -> bool:
    """True si la date de mise à jour est strictement plus vieille que MAX_PRICE_DATA_AGE_DAYS."""
    age = _calendar_age_days(TODAY, update_date)
    if age is None:
        return True
    return age > MAX_PRICE_DATA_AGE_DAYS


def _parse_iso_datetime(s: str) -> datetime | None:
    if not s:
        return None
    t = s.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(t)
    except ValueError:
        return None


def _dt_naive_utc(d: datetime) -> datetime:
    if d.tzinfo is None:
        return d
    return d.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def _entry_price_datetime(entry: dict) -> datetime | None:
    """Instant représentatif pour comparer deux sources (quotidien vs flux)."""
    iso = entry.get("maj_iso")
    if iso:
        return _parse_iso_datetime(iso)
    dm = (entry.get("date_maj") or "").strip()
    if len(dm) >= 10 and dm[4] == "-" and dm[7] == "-":
        try:
            return datetime.strptime(dm[:10], "%Y-%m-%d")
        except ValueError:
            pass
    return None


def compute_latest_fuel_price_update_meta(db: dict) -> dict:
    """Date/heure la plus récente parmi tous les prix affichés (quotidien + flux fusionné)."""
    best_utc = None
    best_has_iso = False
    for st in db.get("stations", {}).values():
        for entry in st.get("carburants_disponibles", {}).values():
            dt = _entry_price_datetime(entry)
            if dt is None:
                continue
            has_iso = bool(entry.get("maj_iso"))
            if dt.tzinfo is None:
                u = dt.replace(tzinfo=ZoneInfo("UTC"))
            else:
                u = dt.astimezone(ZoneInfo("UTC"))
            if best_utc is None or u > best_utc:
                best_utc = u
                best_has_iso = has_iso
    if best_utc is None:
        return {
            "latest_fuel_price_update_iso": "",
            "latest_fuel_price_update_label_fr": "—",
        }
    paris = best_utc.astimezone(ZoneInfo("Europe/Paris"))
    iso_attr = paris.isoformat(timespec="minutes")
    if best_has_iso:
        label_fr = paris.strftime("%d/%m/%Y à %H:%M")
    else:
        label_fr = paris.strftime("%d/%m/%Y")
    return {
        "latest_fuel_price_update_iso": iso_attr,
        "latest_fuel_price_update_label_fr": label_fr,
    }


def footer_fuel_data_update_html(meta: dict) -> str:
    """Fragment HTML sûr pour le pied de page (date d’actualisation des prix)."""
    iso = (meta.get("latest_fuel_price_update_iso") or "").strip()
    label = (meta.get("latest_fuel_price_update_label_fr") or "—").strip() or "—"
    label_e = html_lib.escape(label, quote=False)
    title = html_lib.escape(
        "Dernière mise à jour relevée sur un prix (jeu quotidien ou flux instantané, après fusion)",
        quote=True,
    )
    if iso:
        iso_e = html_lib.escape(iso, quote=True)
        return (
            '<span class="whitespace-nowrap">Dernière actualisation prix carburants\u202f: '
            f'<time id="footer-fuel-data-datetime" datetime="{iso_e}" '
            f'class="font-medium text-slate-700 tabular-nums" title="{title}">{label_e}</time>'
            "</span>"
        )
    return (
        '<span class="whitespace-nowrap">Dernière actualisation prix carburants\u202f: '
        f'<span id="footer-fuel-data-datetime" class="font-medium text-slate-600">{label_e}</span></span>'
    )


def flux_maj_iso_and_date(raw) -> tuple[str | None, str]:
    """(maj_iso, date AAAA-MM-JJ) pour une cellule « mis à jour le » du flux."""
    iso = normalize_price_update_iso(raw)
    if iso:
        return iso, iso[:10]
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None, ""
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        return None, ""
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            datetime.strptime(s[:10], "%Y-%m-%d")
        except ValueError:
            return None, ""
        rest = s[10:].strip()
        if not rest:
            d = s[:10]
            return f"{d}T12:00:00", d
    return None, ""


def flux_replaces_daily_entry(existing: dict | None, flux_maj_iso: str) -> bool:
    """Le flux prime s’il est au moins aussi récent que le prix quotidien déjà chargé."""
    if not existing:
        return True
    ex_dt = _entry_price_datetime(existing)
    fl_dt = _parse_iso_datetime(flux_maj_iso)
    if fl_dt is None:
        return False
    if ex_dt is None:
        return True
    return _dt_naive_utc(fl_dt) >= _dt_naive_utc(ex_dt)


def daily_maj_date_and_iso(cell):
    """(maj_iso ou None, date AAAA-MM-JJ) depuis la colonne quotidienne."""
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return None, ""
    s = str(cell).strip()
    if not s or s.lower() == "nan":
        return None, ""
    date_part = s[:10] if len(s) >= 10 and s[4:5] == "-" else ""
    return normalize_price_update_iso(s), date_part


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

def download_daily_prices():
    """Télécharge l’export quotidien data.gouv (toujours, pour données à jour)."""
    log.info("Téléchargement prix quotidiens (%s) ...", TODAY)
    resp = fetch(EXCEL_URL, stream=True, timeout=180, retries=10)
    with open(EXCEL_FILE, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    log.info("Prix quotidiens OK → %s", EXCEL_FILE)


def download_flux_prices():
    """Toujours retélécharger le flux instantané (ne pas réutiliser un fichier figé)."""
    log.info("Téléchargement flux instantané (%s) ...", TODAY)
    resp = fetch(EXCEL_RT_URL, stream=True, timeout=180, retries=10)
    with open(EXCEL_RT_FILE, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    log.info("Flux instantané OK → %s", EXCEL_RT_FILE)


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
# Flux instantané + agrégats
# ---------------------------------------------------------------------------

def _build_geom_correlation_indexes(db):
    """Index géographiques pour rattacher une ligne flux à une station quotidienne."""
    geom5 = {}
    geom3 = {}
    for sid, st in db["stations"].items():
        lat, lon = st.get("lat"), st.get("lon")
        if lat is None or lon is None:
            continue
        k5 = (round(lat, 5), round(lon, 5))
        geom5.setdefault(k5, []).append(sid)
        k3 = (round(lat, 3), round(lon, 3))
        geom3.setdefault(k3, []).append(sid)
    return geom5, geom3


def _correlate_flux_row_to_station_id(row, db, geom5, geom3):
    """Priorité : id identique, sinon geom (5 puis 3 décimales) + adresse/CP/ville."""
    rid = str(row.get("id", "")).strip()
    if rid and rid in db["stations"]:
        return rid

    lat, lon = parse_geom_lat_lon(row.get("geom"))
    if lat is None:
        return None

    rt_key = station_address_correlation_key(
        row.get("Adresse"),
        row.get("Code postal"),
        row.get("Ville"),
    )

    def disambiguate(candidates):
        if len(candidates) == 1:
            return candidates[0]
        matched = [
            s
            for s in candidates
            if station_address_correlation_key(
                db["stations"][s]["adresse"],
                db["stations"][s]["code_postal"],
                db["stations"][s]["ville"],
            )
            == rt_key
        ]
        return matched[0] if len(matched) == 1 else None

    k5 = (round(lat, 5), round(lon, 5))
    sid = disambiguate(geom5.get(k5, []))
    if sid:
        return sid
    k3 = (round(lat, 3), round(lon, 3))
    return disambiguate(geom3.get(k3, []))


def _parse_rt_price_cell(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip().replace(",", ".")
    if not s or s.lower() == "nan":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def merge_flux_instantane(db):
    """Enrichit les prix et horodatages depuis le flux instantané (sans doubler les stations)."""
    if not os.path.isfile(EXCEL_RT_FILE):
        log.warning("Fichier flux absent (%s), fusion ignorée.", EXCEL_RT_FILE)
        db.setdefault("meta", {})["flux_instantane"] = {"fusionne": False, "fichier_attendu": EXCEL_RT_FILE}
        return

    log.info("Fusion du flux instantané ...")
    df_rt = pd.read_excel(EXCEL_RT_FILE, dtype=str).fillna("")
    geom5, geom3 = _build_geom_correlation_indexes(db)

    merged_rows = 0
    correlated = 0
    skipped = 0

    for _, row in df_rt.iterrows():
        rid = str(row.get("id", "")).strip()
        sid = _correlate_flux_row_to_station_id(row, db, geom5, geom3)
        if not sid:
            skipped += 1
            continue
        if sid != rid:
            correlated += 1
        st = db["stations"][sid]
        merged_rows += 1

        for fuel, price_col, time_col in RT_FUEL_COLUMNS:
            price = _parse_rt_price_cell(row.get(price_col))
            if price is None:
                continue
            maj_iso, flux_date = flux_maj_iso_and_date(row.get(time_col))
            if not maj_iso or not flux_date:
                continue
            if _price_row_is_stale_by_calendar(flux_date):
                continue
            existing = st["carburants_disponibles"].get(fuel)
            if not flux_replaces_daily_entry(existing, maj_iso):
                continue
            date_maj = flux_date
            st["carburants_disponibles"][fuel] = {
                "prix": price,
                "date_maj": date_maj,
                "maj_iso": maj_iso,
            }
            st["carburants_en_rupture"].pop(fuel, None)

    db.setdefault("meta", {})["flux_instantane"] = {
        "fusionne": True,
        "lignes_flux": int(len(df_rt)),
        "stations_mises_a_jour": merged_rows,
        "correlations_geom_adresse": correlated,
        "sans_station_cible": skipped,
    }
    log.info(
        "Flux fusionné : %d stations mises à jour (%d corrélations hors id, %d lignes ignorées).",
        merged_rows,
        correlated,
        skipped,
    )


def recompute_price_aggregates(db):
    """Recalcule minima nationaux / régionaux / départementaux et tableaux de bord."""
    nat_sum = {c: 0.0 for c in ALL_FUELS}
    nat_cnt = {c: 0 for c in ALL_FUELS}
    nat_presence = {c: 0 for c in ALL_FUELS}
    mins = {
        "national": {c: float("inf") for c in ALL_FUELS},
        "regional": {},
        "departemental": {},
    }
    reg_agg = {}
    dept_agg = {}

    for sid, st in db["stations"].items():
        region = st["region"]
        dk = st["dept_key"]

        if region not in reg_agg:
            reg_agg[region] = {
                "station_count": 0,
                "sum": {c: 0.0 for c in ALL_FUELS},
                "cnt": {c: 0 for c in ALL_FUELS},
            }
        reg_agg[region]["station_count"] += 1

        if dk not in dept_agg:
            dept_agg[dk] = {
                "nom": st["departement"],
                "region": region,
                "station_count": 0,
                "sum": {c: 0.0 for c in ALL_FUELS},
                "cnt": {c: 0 for c in ALL_FUELS},
            }
        dept_agg[dk]["station_count"] += 1

        if region not in mins["regional"]:
            mins["regional"][region] = {c: float("inf") for c in ALL_FUELS}
        if dk not in mins["departemental"]:
            mins["departemental"][dk] = {c: float("inf") for c in ALL_FUELS}

        for fuel, info in st.get("carburants_disponibles", {}).items():
            if fuel not in ALL_FUELS:
                continue
            price = float(info["prix"])
            nat_sum[fuel] += price
            nat_cnt[fuel] += 1
            nat_presence[fuel] += 1
            reg_agg[region]["sum"][fuel] += price
            reg_agg[region]["cnt"][fuel] += 1
            dept_agg[dk]["sum"][fuel] += price
            dept_agg[dk]["cnt"][fuel] += 1
            if price < mins["national"][fuel]:
                mins["national"][fuel] = price
            if price < mins["regional"][region][fuel]:
                mins["regional"][region][fuel] = price
            if price < mins["departemental"][dk][fuel]:
                mins["departemental"][dk][fuel] = price

    db["stats"]["min_prices"] = mins
    purge_infinity(db["stats"]["min_prices"])

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
        "departemental": {
            dk: {
                "nom": d["nom"],
                "region": d["region"],
                "station_count": d["station_count"],
                "avg_prices": {
                    c: round(d["sum"][c] / d["cnt"][c], 3) if d["cnt"][c] else 0
                    for c in ALL_FUELS
                },
            }
            for dk, d in dept_agg.items()
        },
    }


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

    for _, row in df.iterrows():
        sid = str(row["id"])
        region = str(row["Région"]).strip() or "Inconnue"
        dept = str(row["Département"]).strip() or "Inconnu"
        city = str(row["ville"]).strip().upper() or "INCONNUE"
        cp = str(row["Code postal"]).strip()
        addr = str(row["adresse"]).strip()
        dk = f"{region}_{dept}"

        lat, lon = parse_geom_lat_lon(row["geom"])

        if sid not in db["stations"]:
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
        maj_iso, date_raw = daily_maj_date_and_iso(row["Mise à jour des prix"])

        obsolete = False
        if date_raw:
            obsolete = _price_row_is_stale_by_calendar(date_raw)

        if fuel:
            if obsolete:
                db["stations"][sid]["carburants_en_rupture"][fuel] = {
                    "debut": date_raw,
                    "motif": f"Obsolète (>{MAX_PRICE_DATA_AGE_DAYS} jours)",
                }
            else:
                price = float(row["Prix"])
                entry = {
                    "prix": price,
                    "date_maj": date_raw,
                }
                if maj_iso:
                    entry["maj_iso"] = maj_iso
                db["stations"][sid]["carburants_disponibles"][fuel] = entry

        rupt = row["Carburant en rupture"]
        if rupt and rupt not in db["stations"][sid]["carburants_en_rupture"]:
            db["stations"][sid]["carburants_en_rupture"][rupt] = {
                "debut": str(row["Début rupture"])[:10] if row["Début rupture"] else "Inconnue",
                "motif": "Rupture signalée",
            }

    merge_flux_instantane(db)
    recompute_price_aggregates(db)
    db.setdefault("meta", {}).update(compute_latest_fuel_price_update_meta(db))
    log.info(
        "Dernière actualisation prix carburants (max. toutes stations) : %s",
        db["meta"].get("latest_fuel_price_update_label_fr"),
    )

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


def _format_fr_int(n):
    """Espace fin insécable comme séparateur de milliers (usage affichage FR)."""
    s = f"{int(n):,}"
    return s.replace(",", "\u202f")


def _resolve_git_footer_placeholders():
    """SHA et URL de commit pour le pied de page (CI : GITHUB_SHA / GITHUB_REPOSITORY)."""
    sha = os.environ.get("GITHUB_SHA", "").strip()
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not sha:
        try:
            sha = subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                cwd=BASE_DIR,
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).strip()
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            sha = ""
    short = sha[:7] if len(sha) >= 7 else sha
    if not repo:
        try:
            url = subprocess.check_output(
                ["git", "remote", "get-url", "origin"],
                cwd=BASE_DIR,
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).strip()
            m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
            if m:
                repo = f"{m.group(1)}/{m.group(2)}"
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            repo = ""
    commit_url = f"https://github.com/{repo}/commit/{sha}" if repo and sha else ""
    return short, commit_url


def _git_commit_footer_html(commit_short, commit_url):
    """Fragment HTML sûr pour le pied de page (lien commit ou texte seul)."""
    label = html_lib.escape(commit_short or "—", quote=False)
    if commit_url:
        aria = html_lib.escape(
            f"Code source sur GitHub, commit {commit_short or ''} (build depuis la branche main)",
            quote=True,
        )
        return (
            f'<a href="{html_lib.escape(commit_url, quote=True)}" class="footer-git-commit" '
            f'rel="noopener noreferrer" target="_blank" aria-label="{aria}">'
            f'<code>{label}</code></a>'
        )
    return f"<code>{label}</code>"


# ---------------------------------------------------------------------------
# Site generation
# ---------------------------------------------------------------------------

def generate_site():
    os.makedirs(BUILD_DIR, exist_ok=True)
    build_json = os.path.join(BUILD_DIR, "data.json")

    with open(DB_FILE, "r", encoding="utf-8") as f:
        db_out = json.load(f)

    meta = db_out.get("meta") if isinstance(db_out.get("meta"), dict) else {}
    if not (meta.get("latest_fuel_price_update_iso") or "").strip():
        meta = {**meta, **compute_latest_fuel_price_update_meta(db_out)}
    db_out.setdefault("meta", {})
    db_out["meta"]["latest_fuel_price_update_iso"] = meta.get("latest_fuel_price_update_iso", "")
    db_out["meta"]["latest_fuel_price_update_label_fr"] = meta.get(
        "latest_fuel_price_update_label_fr", "—"
    )

    with open(build_json, "w", encoding="utf-8") as f:
        json.dump(db_out, f, ensure_ascii=False, separators=(",", ":"))

    # index.html — métadonnées de build + minify
    with open(os.path.join(TEMPLATES_DIR, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    build_dt = datetime.now(ZoneInfo("Europe/Paris"))
    build_paris = build_dt.strftime("%d/%m/%Y à %H:%M")
    station_count = len(db_out.get("stations") or {})
    commit_short, commit_url = _resolve_git_footer_placeholders()
    html = html.replace("{{BUILD_DATE}}", TODAY)
    html = html.replace("{{BUILD_DATETIME_PARIS}}", build_paris)
    html = html.replace("{{BUILD_DATETIME_ISO}}", build_dt.isoformat(timespec="minutes"))
    html = html.replace("{{STATION_COUNT}}", _format_fr_int(station_count))
    html = html.replace(
        "{{FUEL_DATA_UPDATE_FOOTER_HTML}}", footer_fuel_data_update_html(db_out["meta"])
    )
    html = html.replace("{{GIT_COMMIT_HTML}}", _git_commit_footer_html(commit_short, commit_url))
    with open(os.path.join(BUILD_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(minify_html(html))

    # app.js — minify
    with open(os.path.join(TEMPLATES_DIR, "app.js"), "r", encoding="utf-8") as f:
        js = f.read()
    with open(os.path.join(BUILD_DIR, "app.js"), "w", encoding="utf-8") as f:
        f.write(minify_js(js))

    for extra in ("manifest.webmanifest", "sw.js", "icon.svg", "CNAME"):
        src = os.path.join(TEMPLATES_DIR, extra)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(BUILD_DIR, extra))

    log.info("Static site written to %s/", BUILD_DIR)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log.info("Carbu'Web build started for %s", TODAY)
    if os.environ.get("CARBUWEB_BUILD_DATE"):
        log.info("Date imposée par environnement (CI) : CARBUWEB_BUILD_DATE=%s", TODAY)

    cleanup_old_files()

    if not os.path.exists(DB_FILE):
        download_daily_prices()
        download_flux_prices()
        if not os.path.exists(OSM_FILE):
            download_osm()
        build_database()
    else:
        log.info("Existing database found, skipping download.")

    generate_site()
    log.info("Build complete.")


if __name__ == "__main__":
    main()
