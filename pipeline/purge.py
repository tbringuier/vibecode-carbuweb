import logging

log = logging.getLogger("carbuweb")


def purge_priceless_stations(db):
    """Supprime les stations sans aucun prix de tous les index."""
    before = len(db["stations"])
    empty_sids = [sid for sid, st in db["stations"].items() if not st["carburants_disponibles"]]
    for sid in empty_sids:
        st = db["stations"][sid]
        # Retirer des index
        cp = st["code_postal"]
        if cp in db["cp_index"]:
            db["cp_index"][cp] = [s for s in db["cp_index"][cp] if s != sid]
            if not db["cp_index"][cp]:
                del db["cp_index"][cp]
        region, dept, city = st["region"], st["departement"], st["ville"]
        if region in db["geo_tree"] and dept in db["geo_tree"][region] and city in db["geo_tree"][region][dept]:
            db["geo_tree"][region][dept][city] = [s for s in db["geo_tree"][region][dept][city] if s != sid]
            if not db["geo_tree"][region][dept][city]:
                del db["geo_tree"][region][dept][city]
        db["recherche_texte"].pop(sid, None)
        del db["stations"][sid]
    log.info("Stations purgées (0 prix) : %d → %d stations actives.", len(empty_sids), len(db["stations"]))
