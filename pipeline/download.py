import json
import logging
import time

import requests

from .config import (
    EXCEL_FILE,
    EXCEL_RT_FILE,
    EXCEL_URL,
    EXCEL_RT_URL,
    OSM_FILE,
    OVERPASS_ENDPOINTS,
    OVERPASS_MAX_ATTEMPTS,
    HTTP_USER_AGENT,
    TODAY,
)
from .helpers import fetch

log = logging.getLogger("carbuweb")


def download_daily_prices():
    """Télécharge l'export quotidien data.gouv (toujours, pour données à jour)."""
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
                # Pause plus longue après plusieurs échecs d'affilée sur le même miroir
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
                "nom": tags.get("name", tags.get("brand")) or None,
                "url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
            }
    with open(OSM_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False)
    log.info("OSM mapping built — %d stations.", len(mapping))
