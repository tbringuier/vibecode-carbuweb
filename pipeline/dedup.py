import logging

from collections import Counter

from .config import VALID_PRICE_MIN, VALID_PRICE_MAX, FUEL_PRICE_RANGES
from .helpers import parse_geom_lat_lon, daily_maj_date_and_iso, parse_price_cell, price_entry_should_replace

log = logging.getLogger("carbuweb")


def deduplicate_daily(df):
    """Dédoublonne le quotidien et retourne (best_daily, ruptures, station_rows).

    Le fichier contient des doublons (même station+carburant, même prix/date).
    On garde la ligne la plus récente pour chaque (station, carburant).
    """
    best_daily = {}  # (sid, fuel) -> {prix, maj_iso, date_maj}
    ruptures = {}    # (sid, fuel) -> {debut, motif}
    station_rows = {}  # sid -> first row data for station creation
    rejected = Counter()  # fuel -> nb prix rejetés (hors plage)

    for _, row in df.iterrows():
        sid = str(row["id"])
        region = str(row["Région"]).strip() or "Inconnue"
        dept = str(row["Département"]).strip() or "Inconnu"
        city = str(row["ville"]).strip().upper() or "INCONNUE"
        cp = str(row["Code postal"]).strip()
        addr = str(row["adresse"]).strip()

        if sid not in station_rows:
            lat, lon = parse_geom_lat_lon(row["geom"])
            station_rows[sid] = {
                "region": region, "dept": dept, "city": city, "cp": cp,
                "addr": addr, "lat": lat, "lon": lon, "horaires": row["horaires"],
            }

        fuel = row["Carburant"]
        if fuel:
            maj_iso, date_maj = daily_maj_date_and_iso(row["Mise à jour des prix"])
            price = parse_price_cell(row["Prix"])
            lo, hi = FUEL_PRICE_RANGES.get(fuel, (VALID_PRICE_MIN, VALID_PRICE_MAX))
            if price is not None and not (lo <= price <= hi):
                rejected[fuel] += 1
                price = None
            if price is not None:
                key = (sid, fuel)
                entry = {"prix": round(price, 3), "date_maj": date_maj, "maj_iso": maj_iso}
                existing = best_daily.get(key)
                if existing is None or price_entry_should_replace(existing, entry):
                    best_daily[key] = entry

        rupt = row["Carburant en rupture"]
        if rupt:
            rkey = (sid, rupt)
            if rkey not in ruptures:
                ruptures[rkey] = {
                    "debut": str(row["Début rupture"])[:10] if row["Début rupture"] else "Inconnue",
                    "motif": "Rupture signalée",
                }

    log.info(
        "Quotidien : %d lignes → %d stations, %d prix dédoublonnés, %d ruptures.",
        len(df), len(station_rows), len(best_daily), len(ruptures),
    )
    if rejected:
        detail = ", ".join(f"{f}: {n}" for f, n in sorted(rejected.items()))
        log.info("Quotidien : %d prix rejetés (hors plage carburant) — %s", sum(rejected.values()), detail)

    return best_daily, ruptures, station_rows
