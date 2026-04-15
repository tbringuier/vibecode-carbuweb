import html as html_lib
import json
import logging
import re
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from .config import ALL_FUELS

log = logging.getLogger("carbuweb")


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
    """Chaîne ISO 8601 avec offset Europe/Paris garanti.

    Les exports Excel utilisent souvent « YYYY-MM-DD HH:MM:SS » sans « T » ni offset.
    Les données gouvernementales sont publiées en heure locale française.
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
    s = s.replace(" ", "")
    # If an offset is already present (e.g. +02:00, +01:00, Z), keep it.
    if re.search(r"[+-]\d{2}:\d{2}$", s) or s.endswith("Z"):
        return s
    # No offset: assume Europe/Paris local time — add the correct offset for that date.
    try:
        naive = datetime.fromisoformat(s)
        paris = naive.replace(tzinfo=ZoneInfo("Europe/Paris"))
        return paris.isoformat(timespec="seconds")
    except (ValueError, TypeError):
        return s



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


def check_price_validity(fuel: str, price: float, entry: dict, fuel_ranges: dict, absurd_age_days: int) -> str | None:
    """Décide si une entrée prix est aberrante. Retourne la raison si filtrée, None si valide.

    Raisons possibles :
    - "hors_plage" : prix en dehors de la plage réaliste du carburant
    - "anciennete_absurde" : prix mis à jour il y a plus de `absurd_age_days` jours
    """
    lo, hi = fuel_ranges.get(fuel, (0.01, 10.0))
    if not (lo <= price <= hi):
        return "hors_plage"
    dt = _entry_price_datetime(entry)
    if dt is not None:
        from datetime import timezone
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        entry_utc = _dt_naive_utc(dt)
        if (now_utc - entry_utc).days > absurd_age_days:
            return "anciennete_absurde"
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
    """Fragment HTML sûr pour le pied de page (date d'actualisation des prix)."""
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
            "<span>Dernière actualisation prix carburants\u202f: "
            f'<time id="footer-fuel-data-datetime" datetime="{iso_e}" '
            f'class="font-medium text-slate-700 tabular-nums" title="{title}">{label_e}</time>'
            "</span>"
        )
    return (
        "<span>Dernière actualisation prix carburants\u202f: "
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
            try:
                noon = datetime.strptime(d, "%Y-%m-%d").replace(
                    hour=12, tzinfo=ZoneInfo("Europe/Paris")
                )
                return noon.isoformat(timespec="seconds"), d
            except ValueError:
                return f"{d}T12:00:00", d
    return None, ""


def flux_replaces_daily_entry(existing: dict | None, flux_maj_iso: str) -> bool:
    """Le flux prime s'il est au moins aussi récent que le prix quotidien déjà chargé."""
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
