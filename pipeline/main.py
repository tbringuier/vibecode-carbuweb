"""Pipeline orchestration — build_database() and main() entry point."""

import json
import logging
import os

import pandas as pd

from .aggregates import build_search_indexes, recompute_price_aggregates
from .cleanup import cleanup_old_files
from .config import ALL_FUELS, DB_FILE, EXCEL_FILE, OSM_FILE, TODAY
from .dedup import deduplicate_daily
from .download import download_daily_prices, download_flux_prices, download_osm
from .generate import generate_site
from .helpers import compute_latest_fuel_price_update_meta
from .purge import purge_priceless_stations
from .stations import inject_daily_prices, merge_flux_instantane, register_station

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("carbuweb")


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

    # ---- Phase 1 : Dédoublonner le quotidien ----
    best_daily, ruptures, station_rows = deduplicate_daily(df)

    # ---- Phase 2 : Créer les stations et injecter les prix quotidiens ----
    for sid, info in station_rows.items():
        register_station(
            db, osm, sid, info["region"], info["dept"], info["city"],
            info["cp"], info["addr"], info["lat"], info["lon"], info["horaires"],
        )

    inject_daily_prices(db, best_daily, ruptures)

    # ---- Phase 3 : Fusionner le flux instantané ----
    merge_flux_instantane(db, osm)

    # ---- Phase 4 : Purger les stations sans prix ----
    purge_priceless_stations(db)

    # ---- Phase 5 : Agrégats + index ----
    recompute_price_aggregates(db)
    db.setdefault("meta", {}).update(compute_latest_fuel_price_update_meta(db))
    log.info(
        "Dernière actualisation prix carburants : %s",
        db["meta"].get("latest_fuel_price_update_label_fr"),
    )

    build_search_indexes(db)

    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False)
    log.info("Database ready — %d stations.", len(db["stations"]))


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
