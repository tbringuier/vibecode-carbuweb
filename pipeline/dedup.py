import logging

from .config import VALID_PRICE_MIN, VALID_PRICE_MAX
from .helpers import parse_geom_lat_lon, daily_maj_date_and_iso, _parse_iso_datetime, _dt_naive_utc

log = logging.getLogger("carbuweb")


def deduplicate_daily(df):
    """Dédoublonne le quotidien et retourne (best_daily, ruptures, station_rows).

    Le fichier contient des doublons (même station+carburant, même prix/date).
    On garde la ligne la plus récente pour chaque (station, carburant).
    """
    best_daily = {}  # (sid, fuel) -> {prix, maj_raw, maj_iso, date_raw}
    ruptures = {}    # (sid, fuel) -> {debut, motif}
    station_rows = {}  # sid -> first row data for station creation

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
            maj_iso, date_raw = daily_maj_date_and_iso(row["Mise à jour des prix"])
            try:
                price = float(row["Prix"])
            except (ValueError, TypeError):
                price = None
            if price is not None and VALID_PRICE_MIN <= price <= VALID_PRICE_MAX:
                key = (sid, fuel)
                entry = {"prix": round(price, 3), "date_raw": date_raw, "maj_iso": maj_iso}
                existing = best_daily.get(key)
                if existing is None:
                    best_daily[key] = entry
                else:
                    # Garder le plus récent
                    new_dt = _parse_iso_datetime(maj_iso) if maj_iso else None
                    old_dt = _parse_iso_datetime(existing["maj_iso"]) if existing.get("maj_iso") else None
                    if new_dt and old_dt:
                        if _dt_naive_utc(new_dt) > _dt_naive_utc(old_dt):
                            best_daily[key] = entry
                    elif new_dt and not old_dt:
                        best_daily[key] = entry
                    elif date_raw and existing.get("date_raw") and date_raw > existing["date_raw"]:
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

    return best_daily, ruptures, station_rows
