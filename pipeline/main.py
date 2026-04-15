"""Pipeline orchestration — build_database() and main() entry point."""

import json
import logging
import os

import pandas as pd

from .aggregates import build_search_indexes, recompute_price_aggregates
from .cleanup import cleanup_old_files
from .config import ALL_FUELS, DB_FILE, EXCEL_FILE, OSM_FILE, TODAY, FUEL_PRICE_RANGES, PRICE_ABSURD_AGE_DAYS
from .dedup import deduplicate_daily
from .download import download_daily_prices, download_flux_prices, download_osm
from .generate import generate_site
from .helpers import compute_latest_fuel_price_update_meta, check_price_validity
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

    # ---- Phase 3b : Filtrage qualité (prix aberrants + données fantômes) ----
    filter_stats = {}  # raison -> {fuel -> count}
    for sid, st in db["stations"].items():
        to_filter = []
        for fuel, entry in st["carburants_disponibles"].items():
            try:
                price_val = float(entry["prix"])
            except (TypeError, ValueError):
                continue
            reason = check_price_validity(fuel, price_val, entry, FUEL_PRICE_RANGES, PRICE_ABSURD_AGE_DAYS)
            if reason:
                to_filter.append((fuel, entry, reason))
        for fuel, entry, reason in to_filter:
            st.setdefault("carburants_filtres", {})[fuel] = {**entry, "raison": reason}
            del st["carburants_disponibles"][fuel]
            filter_stats.setdefault(reason, {}).setdefault(fuel, 0)
            filter_stats[reason][fuel] += 1
    for reason, fuels in filter_stats.items():
        total = sum(fuels.values())
        detail = ", ".join(f"{f}: {n}" for f, n in sorted(fuels.items()))
        log.info("Filtrage qualité [%s] : %d prix filtrés (%s)", reason, total, detail)

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
    download_daily_prices()
    download_flux_prices()
    if not os.path.exists(OSM_FILE):
        download_osm()
    build_database()

    generate_site()
    log.info("Build complete.")
