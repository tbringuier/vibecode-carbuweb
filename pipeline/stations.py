import logging
import os

import pandas as pd

from .config import EXCEL_RT_FILE, ALL_FUELS, RT_FUEL_COLUMNS, VALID_PRICE_MIN, VALID_PRICE_MAX, FUEL_PRICE_RANGES
from .helpers import (
    normalize_text,
    parse_geom_lat_lon,
    parse_hours,
    station_address_correlation_key,
    flux_maj_iso_and_date,
    flux_replaces_daily_entry,
)

log = logging.getLogger("carbuweb")


def register_station(db, osm, sid, region, dept, city, cp, addr, lat, lon, horaires_raw):
    """Enregistre une station dans la DB si absente. Idempotent."""
    if sid in db["stations"]:
        return
    dk = f"{region}_{dept}"
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
        "horaires": parse_hours(horaires_raw),
        "carburants_disponibles": {},
        "carburants_en_rupture": {},
        "carburants_filtres": {},
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


def inject_daily_prices(db, best_daily, ruptures):
    """Injecte les prix quotidiens dédoublonnés dans les stations."""
    for (sid, fuel), entry in best_daily.items():
        carb = {"prix": entry["prix"], "date_maj": entry["date_raw"]}
        if entry["maj_iso"]:
            carb["maj_iso"] = entry["maj_iso"]
        db["stations"][sid]["carburants_disponibles"][fuel] = carb

    for (sid, fuel), info in ruptures.items():
        if sid in db["stations"] and fuel not in db["stations"][sid]["carburants_disponibles"]:
            db["stations"][sid]["carburants_en_rupture"][fuel] = info


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


def merge_flux_instantane(db, osm=None):
    """Enrichit les prix depuis le flux instantané.

    - Si une station du flux est déjà dans la DB, on met à jour ses prix (le plus récent gagne).
    - Si une station du flux n'existe PAS dans la DB (absente du quotidien), on la crée
      à condition qu'elle ait au moins un prix valide.
    """
    if not os.path.isfile(EXCEL_RT_FILE):
        log.warning("Fichier flux absent (%s), fusion ignorée.", EXCEL_RT_FILE)
        db.setdefault("meta", {})["flux_instantane"] = {"fusionne": False, "fichier_attendu": EXCEL_RT_FILE}
        return

    if osm is None:
        osm = {}

    log.info("Fusion du flux instantané ...")
    df_rt = pd.read_excel(EXCEL_RT_FILE, dtype=str).fillna("")
    geom5, geom3 = _build_geom_correlation_indexes(db)

    merged_rows = 0
    correlated = 0
    skipped = 0
    created = 0

    for _, row in df_rt.iterrows():
        rid = str(row.get("id", "")).strip()
        if not rid:
            skipped += 1
            continue

        sid = _correlate_flux_row_to_station_id(row, db, geom5, geom3)

        # Si pas de station trouvée, créer depuis le flux
        if not sid:
            # Extraire les prix du flux pour cette ligne
            has_any_price = False
            for fuel, price_col, time_col in RT_FUEL_COLUMNS:
                p = _parse_rt_price_cell(row.get(price_col))
                lo, hi = FUEL_PRICE_RANGES.get(fuel, (VALID_PRICE_MIN, VALID_PRICE_MAX))
                if p is not None and lo <= p <= hi:
                    has_any_price = True
                    break
            if not has_any_price:
                skipped += 1
                continue
            # Créer la station
            lat, lon = parse_geom_lat_lon(row.get("geom"))
            region = str(row.get("Région", "")).strip() or "Inconnue"
            dept = str(row.get("Département", "")).strip() or "Inconnu"
            city = str(row.get("Ville", "")).strip().upper() or "INCONNUE"
            cp = str(row.get("Code postal", "")).strip()
            addr = str(row.get("Adresse", "")).strip()
            horaires = row.get("horaires", "")
            register_station(db, osm, rid, region, dept, city, cp, addr, lat, lon, horaires)
            sid = rid
            created += 1

        if sid != rid:
            correlated += 1
        st = db["stations"][sid]
        merged_rows += 1

        for fuel, price_col, time_col in RT_FUEL_COLUMNS:
            price = _parse_rt_price_cell(row.get(price_col))
            if price is None:
                continue
            lo, hi = FUEL_PRICE_RANGES.get(fuel, (VALID_PRICE_MIN, VALID_PRICE_MAX))
            if not (lo <= price <= hi):
                continue
            price = round(price, 3)
            maj_iso, flux_date = flux_maj_iso_and_date(row.get(time_col))
            if not maj_iso or not flux_date:
                continue
            existing = st["carburants_disponibles"].get(fuel)
            if not flux_replaces_daily_entry(existing, maj_iso):
                continue
            st["carburants_disponibles"][fuel] = {
                "prix": price,
                "date_maj": flux_date,
                "maj_iso": maj_iso,
            }
            st["carburants_en_rupture"].pop(fuel, None)

    db.setdefault("meta", {})["flux_instantane"] = {
        "fusionne": True,
        "lignes_flux": int(len(df_rt)),
        "stations_mises_a_jour": merged_rows,
        "stations_creees_depuis_flux": created,
        "correlations_geom_adresse": correlated,
        "sans_station_cible": skipped,
    }
    log.info(
        "Flux fusionné : %d stations mises à jour, %d créées, %d corrélations hors id, %d ignorées.",
        merged_rows, created, correlated, skipped,
    )
