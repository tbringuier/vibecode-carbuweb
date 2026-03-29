import logging

from .config import ALL_FUELS
from .helpers import normalize_text, purge_infinity, compute_latest_fuel_price_update_meta

log = logging.getLogger("carbuweb")


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


def build_search_indexes(db):
    """Construit dept_index et region_index dans la DB."""
    dept_index = {}
    region_index = {}
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
