"""Historique des prix par station, stocke durablement sur la branche git `history`.

Deux sources, fusionnees jour par jour :

1. Archives annuelles officielles (donnees.roulez-eco.fr/opendata/annee/AAAA) : tous les
   changements de prix depuis 2007. Elles font foi pour les jours qu'elles couvrent.
   L'annee en cours est republiee chaque nuit ; les annees passees sont importees
   progressivement (HISTORY_BACKFILL_PER_RUN par build, de la plus recente a la plus ancienne).
2. Releves du build courant (database du jour) : completent la journee en cours avant
   que l'archive de la nuit ne la consolide.

Modele : pour chaque (station, carburant), une liste de changements a resolution
journaliere `(jour, prix en millimes)` — prix de cloture du jour. Une entree n'est
conservee que si le prix change, ou pour reconfirmer un prix stable apres
HISTORY_KEEPALIVE_DAYS jours. Un releve vaut au plus HISTORY_TTL_DAYS jours.

Disposition du depot (servi tel quel sous build/history/, voir README_TEXT) :
  index.json                                  manifeste
  stations/<2 derniers chiffres>/<id>.json    historique d'une station
  zones/fr.json, zones/region/<slug>.json, zones/dept/<code>.json   moyennes journalieres
"""

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from array import array
from bisect import bisect_left
from itertools import accumulate
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

import requests

from .config import (
    ALL_FUELS,
    BUILD_DIR,
    DATASETS_DIR,
    DB_FILE,
    FUEL_PRICE_RANGES,
    HISTORY_ANNUAL_URL,
    HISTORY_BACKFILL_PER_RUN,
    HISTORY_BUILD_DIRNAME,
    HISTORY_DIR,
    HISTORY_ENABLED,
    HISTORY_FIRST_YEAR,
    HISTORY_KEEPALIVE_DAYS,
    HISTORY_MAX_RECORD_DROP,
    HISTORY_MAX_YEAR_FAILURES,
    HISTORY_SCHEMA,
    HISTORY_TTL_DAYS,
    HTTP_USER_AGENT,
    TODAY,
)
from .helpers import fetch, normalize_text

log = logging.getLogger("carbuweb")

PARIS = ZoneInfo("Europe/Paris")
EPOCH = date(1970, 1, 1)
_ID_RE = re.compile(r"^\d{4,10}$")


class HistoryIntegrityError(RuntimeError):
    """Le resultat ferait perdre des donnees : rien n'est ecrit."""


# ---------------------------------------------------------------------------
# Jours et encodage
# ---------------------------------------------------------------------------


def day_num(d: date) -> int:
    """Numero de jour depuis le 1970-01-01 (calendrier, sans fuseau)."""
    return (d - EPOCH).days


def day_str(n: int) -> str:
    return (EPOCH + timedelta(days=n)).isoformat()


def parse_day(s) -> int | None:
    s = str(s or "").strip()
    if len(s) < 10:
        return None
    try:
        return day_num(date.fromisoformat(s[:10]))
    except ValueError:
        return None


def encode_series(recs):
    """[(jour, prix), ...] -> [j0, p0, dj1, dp1, ...] (deltas, entiers courts en JSON)."""
    out = []
    pd = pp = 0
    for i, (d, p) in enumerate(recs):
        if i == 0:
            out += (d, p)
        else:
            out += (d - pd, p - pp)
        pd, pp = d, p
    return out


def decode_series(arr):
    n = len(arr) - len(arr) % 2
    return list(zip(accumulate(arr[0:n:2]), accumulate(arr[1:n:2])))


def last_record(arr):
    """Dernier (jour, prix) d'une serie encodee, sans la decoder entierement."""
    return sum(arr[0::2]), sum(arr[1::2])


def encode_daily(avg, cnt):
    """Series journalieres (moyenne, nb stations) -> deltas. Jour sans donnee : nb = 0, moyenne reportee."""
    a_out, n_out = [], []
    pa = pn = 0
    for v, c in zip(avg, cnt):
        if not c:
            v = pa
        a_out.append(v - pa)
        n_out.append(c - pn)
        pa, pn = v, c
    return a_out, n_out


def decode_daily(a, n):
    avg, cnt = [], []
    pa = pn = 0
    for da, dn in zip(a, n):
        pa += da
        pn += dn
        avg.append(pa if pn else 0)
        cnt.append(pn)
    return avg, cnt


# ---------------------------------------------------------------------------
# Fusion des releves (liste triee de (jour, prix), un seul releve par jour)
# ---------------------------------------------------------------------------


def compact(recs, keepalive=HISTORY_KEEPALIVE_DAYS):
    """Ne garde que les changements de prix, plus une reconfirmation tous les `keepalive` jours."""
    out = []
    for d, p in recs:
        if out:
            ld, lp = out[-1]
            if p == lp and d - ld < keepalive:
                continue
        out.append((d, p))
    return out


def merge_tail(recs, d, p, keepalive=HISTORY_KEEPALIVE_DAYS):
    """Ajoute une observation en fin de serie (releve live). Modifie `recs`.

    Retourne le premier jour modifie, ou None. Une observation plus ancienne que le
    dernier releve est ignoree : l'archive officielle fait foi pour le passe.
    """
    if not recs:
        recs.append((d, p))
        return d
    ld, lp = recs[-1]
    if d > ld:
        if p != lp or d - ld >= keepalive:
            recs.append((d, p))
            return d
        return None
    if d == ld and p != lp:
        recs[-1] = (d, p)
        # Retour au prix precedent dans la journee : le releve du jour devient redondant.
        if len(recs) >= 2 and recs[-2][1] == p and d - recs[-2][0] < keepalive:
            recs.pop()
        return d
    return None


def merge_tail_encoded(arr, d, p, keepalive=HISTORY_KEEPALIVE_DAYS):
    """merge_tail() directement sur une serie encodee (cout : deux sommes en C, sans decodage)."""
    if not arr:
        arr += (d, p)
        return d
    ld, lp = last_record(arr)
    if d > ld:
        if p != lp or d - ld >= keepalive:
            arr += (d - ld, p - lp)
            return d
        return None
    if d == ld and p != lp:
        if len(arr) == 2:
            arr[1] = p
            return d
        pd, pp = ld - arr[-2], lp - arr[-1]
        if pp == p and d - pd < keepalive:
            del arr[-2:]
        else:
            arr[-1] = p - pp
        return d
    return None


def replace_range(recs, a, b, new_recs, keepalive=HISTORY_KEEPALIVE_DAYS):
    """Remplace les releves des jours [a, b] par `new_recs` (source faisant foi), puis compacte."""
    before = [r for r in recs if r[0] < a]
    after = [r for r in recs if r[0] > b]
    return compact(before + list(new_recs) + after, keepalive)


def first_diff_day(old, new):
    """Premier jour ou deux series divergent (None si identiques)."""
    n = min(len(old), len(new))
    for i in range(n):
        if old[i] != new[i]:
            return min(old[i][0], new[i][0])
    if len(old) != len(new):
        return old[n][0] if len(old) > n else new[n][0]
    return None


# ---------------------------------------------------------------------------
# Archives annuelles (XML ISO-8859-1 dans un zip)
# ---------------------------------------------------------------------------


def parse_annual_price(raw) -> int | None:
    """Prix en millimes. Formats rencontres : "1.789" (euros) depuis ~2022, "1789" (millimes) avant."""
    s = str(raw or "").strip().replace(",", ".")
    if not s:
        return None
    try:
        if "." in s:
            return round(float(s) * 1000)
        v = int(s)
    except ValueError:
        return None
    # Euros entiers ("2" = 2,000 EUR) : aucun carburant ne coute moins de 50 millimes.
    return v * 1000 if v < 50 else v


def _price_ok(fuel, millis):
    lo, hi = FUEL_PRICE_RANGES.get(fuel, (0.01, 10.0))
    return lo * 1000 <= millis <= hi * 1000


def day_series_from_observations(obs, a, b, keepalive=HISTORY_KEEPALIVE_DAYS):
    """[(maj, prix)] bruts -> serie journaliere compactee sur [a, b] (prix de cloture du jour)."""
    closing = {}
    for maj, p in sorted(obs):
        d = parse_day(maj)
        if d is not None and a <= d <= b:
            closing[d] = p
    return compact(sorted(closing.items()), keepalive)


def iter_annual(zip_path, a, b, keepalive=HISTORY_KEEPALIVE_DAYS):
    """Parcourt une archive annuelle station par station (memoire bornee a une station).

    Rend (id, meta, {carburant: serie journaliere sur [a, b]}).
    """
    with zipfile.ZipFile(zip_path) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".xml")), None)
        if not name:
            raise ValueError(f"Aucun XML dans {zip_path}")
        with zf.open(name) as fh:
            for _, el in ET.iterparse(fh, events=("end",)):
                if el.tag != "pdv":
                    continue
                sid = (el.get("id") or "").strip()
                if _ID_RE.match(sid):
                    obs = {}
                    for p in el.iter("prix"):
                        fuel = p.get("nom")
                        if fuel not in ALL_FUELS:
                            continue
                        millis = parse_annual_price(p.get("valeur"))
                        maj = (p.get("maj") or "").replace("T", " ")
                        if millis is None or not maj or not _price_ok(fuel, millis):
                            continue
                        obs.setdefault(fuel, []).append((maj, millis))
                    series = {}
                    for fuel, lst in obs.items():
                        s = day_series_from_observations(lst, a, b, keepalive)
                        if s:
                            series[fuel] = s
                    if series:
                        meta = {
                            "a": (el.findtext("adresse") or "").strip(),
                            "cp": (el.get("cp") or "").strip(),
                            "c": (el.findtext("ville") or "").strip(),
                        }
                        yield sid, {k: v for k, v in meta.items() if v}, series
                el.clear()


def _http_last_modified(url):
    """En-tete Last-Modified (chaine brute) ou None si injoignable / absent."""
    for attempt in range(1, 4):
        try:
            r = requests.head(url, allow_redirects=True, timeout=30, headers={"User-Agent": HTTP_USER_AGENT})
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.headers.get("Last-Modified") or None
        except Exception as exc:  # noqa: BLE001 — reseau : on retente puis on abandonne sans bloquer le build
            log.warning("Historique : HEAD %s (%d/3) : %s", url, attempt, exc)
            if attempt < 3:
                time.sleep(3 * attempt)
    return None


def _download(url, dest):
    resp = fetch(url, stream=True, timeout=300, retries=3)
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1 << 16):
            f.write(chunk)


# ---------------------------------------------------------------------------
# Depot sur disque
# ---------------------------------------------------------------------------


class HistoryStore:
    """Charge, modifie en memoire et reecrit uniquement les fichiers qui changent.

    Les series restent sous forme encodee (listes de petits entiers, partages par CPython) :
    la memoire suit la taille des fichiers, pas le nombre de releves. Seules les series
    modifiees sont decodees.
    """

    def __init__(self, root):
        self.root = root
        self.stations = {}  # id -> {"m": meta, "f": {carburant: [j0, p0, dj1, dp1, ...]}}
        self.dirty = set()
        self.manifest = {}

    def station_path(self, sid):
        return os.path.join(self.root, "stations", sid[-2:], f"{sid}.json")

    def load(self):
        mpath = os.path.join(self.root, "index.json")
        if os.path.isfile(mpath):
            with open(mpath, encoding="utf-8") as f:
                self.manifest = json.load(f)
            if self.manifest.get("v") != HISTORY_SCHEMA:
                raise HistoryIntegrityError(f"Schema d'historique inattendu : {self.manifest.get('v')}")
        sdir = os.path.join(self.root, "stations")
        if os.path.isdir(sdir):
            for shard in sorted(os.listdir(sdir)):
                spath = os.path.join(sdir, shard)
                if not os.path.isdir(spath):
                    continue
                for name in os.listdir(spath):
                    if not name.endswith(".json"):
                        continue
                    with open(os.path.join(spath, name), encoding="utf-8") as f:
                        raw = json.load(f)
                    self.stations[raw["id"]] = {"m": raw.get("m") or {}, "f": raw.get("f") or {}}
        return self

    def get(self, sid):
        h = self.stations.get(sid)
        if h is None:
            h = self.stations[sid] = {"m": {}, "f": {}}
        return h

    def counts(self):
        n_st = n_rec = 0
        first = last = None
        for h in self.stations.values():
            k = sum(len(arr) // 2 for arr in h["f"].values())
            if not k:
                continue
            n_st += 1
            n_rec += k
            for arr in h["f"].values():
                if arr:
                    d_last = sum(arr[0::2])
                    first = arr[0] if first is None else min(first, arr[0])
                    last = d_last if last is None else max(last, d_last)
        return n_st, n_rec, first, last

    def save_stations(self):
        written = 0
        for sid in sorted(self.dirty):
            h = self.stations.get(sid)
            if not h or not any(h["f"].values()):
                continue
            fuels = {fu: h["f"][fu] for fu in ALL_FUELS if h["f"].get(fu)}
            doc = {"v": HISTORY_SCHEMA, "id": sid, "m": h["m"], "f": fuels}
            _write_json(self.station_path(sid), doc)
            written += 1
        self.dirty.clear()
        return written


def _write_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, path)


def _write_text_if_changed(path, text):
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


def ingest_annual(store, zip_path, a, b, keepalive=HISTORY_KEEPALIVE_DAYS):
    """Importe une archive annuelle sur [a, b]. Retourne (premier jour modifie ou None, nb stations, dernier jour vu)."""
    changed = None
    n_st = 0
    max_day = None
    for sid, meta, series in iter_annual(zip_path, a, b, keepalive):
        n_st += 1
        h = store.get(sid)
        if not h["m"] and meta:
            # Station fermee depuis : seule l'archive connait son adresse (le releve live prime sinon).
            h["m"] = meta
            store.dirty.add(sid)
        for fuel, new in series.items():
            last = new[-1][0]
            max_day = last if max_day is None else max(max_day, last)
            old = decode_series(h["f"].get(fuel, []))
            merged = replace_range(old, a, b, new, keepalive)
            fd = first_diff_day(old, merged)
            if fd is not None:
                h["f"][fuel] = encode_series(merged)
                store.dirty.add(sid)
                changed = fd if changed is None else min(changed, fd)
    return changed, n_st, max_day


def snapshot_day(entry):
    """Jour d'un prix du build, aligne sur la convention des archives officielles.

    Les exports data.economie.gouv.fr ajoutent un decalage Paris a des horodatages
    deja locaux (+1 h / +2 h) : repasser en UTC retrouve la date des archives.
    """
    iso = entry.get("maj_iso")
    if iso:
        try:
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc)
            return day_num(dt.date())
        except ValueError:
            pass
    return parse_day(entry.get("date_maj"))


def ingest_snapshot(store, db, today, keepalive=HISTORY_KEEPALIVE_DAYS):
    """Ajoute les prix courants du build. Retourne le premier jour modifie ou None."""
    changed = None
    for sid, st in (db.get("stations") or {}).items():
        if not _ID_RE.match(str(sid)):
            continue
        obs = []
        for fuel, e in (st.get("carburants_disponibles") or {}).items():
            if fuel not in ALL_FUELS:
                continue
            try:
                p = round(float(e["prix"]) * 1000)
            except (KeyError, TypeError, ValueError):
                continue
            d = snapshot_day(e)
            if d is None or d > today + 1 or not _price_ok(fuel, p):
                continue
            obs.append((fuel, d, p))
        if not obs:
            continue
        h = store.get(sid)
        meta = {
            "n": st.get("nom_osm") or "",
            "a": st.get("adresse") or "",
            "cp": st.get("code_postal") or "",
            "c": st.get("ville") or "",
        }
        meta = {k: v for k, v in meta.items() if v}
        if h["m"] != meta:
            h["m"] = meta
            store.dirty.add(sid)
        for fuel, d, p in obs:
            cd = merge_tail_encoded(h["f"].setdefault(fuel, []), d, p, keepalive)
            if cd is not None:
                store.dirty.add(sid)
                changed = cd if changed is None else min(changed, cd)
    return changed


# ---------------------------------------------------------------------------
# Moyennes par zone (France, regions, departements)
# ---------------------------------------------------------------------------


def dept_code(cp):
    cp = str(cp or "").strip()
    if len(cp) < 2 or not cp[:2].isdigit():
        return ""
    return cp[:3] if cp.startswith("97") else cp[:2]


def region_slug(name):
    return normalize_text(name).replace(" ", "-")


def station_zones(meta, depts):
    zones = ["fr"]
    dc = dept_code(meta.get("cp"))
    if dc:
        zones.append("d:" + dc)
        reg = (depts.get(dc) or {}).get("region")
        if reg:
            zones.append("r:" + reg)
    return zones


def zone_path(root, zone):
    if zone == "fr":
        return os.path.join(root, "zones", "fr.json")
    kind, key = zone.split(":", 1)
    if kind == "r":
        return os.path.join(root, "zones", "region", f"{region_slug(key)}.json")
    return os.path.join(root, "zones", "dept", f"{key}.json")


def compute_zone_window(store, lo, hi, depts, ttl=HISTORY_TTL_DAYS):
    """Moyenne journaliere et nb de stations par zone/carburant sur [lo, hi].

    Tableaux de differences : chaque releve couvre [jour, min(jour suivant, jour + ttl)),
    cout proportionnel au nombre de releves, pas au nombre de jours x stations.
    """
    n = hi - lo + 1
    acc = {}

    def arrays(zone, fuel):
        z = acc.setdefault(zone, {})
        pair = z.get(fuel)
        if pair is None:
            pair = z[fuel] = (array("q", bytes(8 * (n + 1))), array("q", bytes(8 * (n + 1))))
        return pair

    for h in store.stations.values():
        zones = None
        for fuel, arr in h["f"].items():
            if not arr or arr[0] > hi:
                continue
            days = list(accumulate(arr[0::2]))
            # Un releve anterieur a lo - ttl ne couvre aucun jour de la fenetre.
            i0 = bisect_left(days, lo - ttl)
            if i0 >= len(days):
                continue
            prices = list(accumulate(arr[1::2]))
            if zones is None:
                zones = station_zones(h["m"], depts)
            targets = [arrays(z, fuel) for z in zones]
            last = len(days)
            for i in range(i0, last):
                d, p = days[i], prices[i]
                if d > hi:
                    break
                e = days[i + 1] if i + 1 < last else hi + 1
                e = min(e, d + ttl, hi + 1)
                s = max(d, lo)
                if s >= e:
                    continue
                s -= lo
                e -= lo
                for sums, cnts in targets:
                    sums[s] += p
                    sums[e] -= p
                    cnts[s] += 1
                    cnts[e] -= 1

    out = {}
    for zone, fuels in acc.items():
        for fuel, (sums, cnts) in fuels.items():
            avg, cnt = [0] * n, [0] * n
            s = c = 0
            for k in range(n):
                s += sums[k]
                c += cnts[k]
                cnt[k] = c
                avg[k] = round(s / c) if c else 0
            out.setdefault(zone, {})[fuel] = (avg, cnt)
    return out


def load_zone(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return {
        "d0": raw["d0"],
        "len": raw["len"],
        "f": {fu: decode_daily(v["a"], v["n"]) for fu, v in raw.get("f", {}).items()},
    }


def splice_zone(zf, lo, hi, window):
    """Insere les valeurs calculees sur [lo, hi] dans les series d'une zone (etendues si besoin)."""
    if not zf or not zf["len"]:
        zf = {"d0": lo, "len": 0, "f": {}}
    d0, length = zf["d0"], zf["len"]
    new_d0 = min(d0, lo) if length else lo
    new_end = max(d0 + length - 1, hi) if length else hi
    new_len = new_end - new_d0 + 1
    w = hi - lo + 1
    fuels = {}
    for fuel in set(zf["f"]) | set(window):
        avg, cnt = zf["f"].get(fuel, ([], []))
        pad = (d0 - new_d0) if length else 0
        A = [0] * pad + list(avg)
        C = [0] * pad + list(cnt)
        A += [0] * (new_len - len(A))
        C += [0] * (new_len - len(C))
        wa, wc = window.get(fuel, ([0] * w, [0] * w))
        off = lo - new_d0
        A[off:off + w] = wa
        C[off:off + w] = wc
        if any(C):
            fuels[fuel] = (A, C)
    return {"d0": new_d0, "len": new_len, "f": fuels}


def save_zone(path, zone, label, zf):
    fuels = {}
    for fu in ALL_FUELS:
        if fu in zf["f"]:
            a, n = encode_daily(*zf["f"][fu])
            fuels[fu] = {"a": a, "n": n}
    _write_json(path, {"v": HISTORY_SCHEMA, "zone": zone, "label": label, "d0": zf["d0"], "len": zf["len"], "f": fuels})


def merge_ranges(ranges):
    out = []
    for lo, hi in sorted(r for r in ranges if r[0] <= r[1]):
        if out and lo <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], hi))
        else:
            out.append((lo, hi))
    return out


def update_zones(store, ranges, depts):
    """Recalcule les moyennes de zone sur les plages modifiees et reecrit les fichiers concernes."""
    ranges = merge_ranges(ranges)
    if not ranges:
        return 0
    zones = {}
    for lo, hi in ranges:
        t0 = time.time()
        win = compute_zone_window(store, lo, hi, depts)
        log.info("Historique : moyennes de zone %s → %s (%d zones, %.1fs)", day_str(lo), day_str(hi), len(win), time.time() - t0)
        known = set(zones) | set(win)
        for zone in known:
            if zone not in zones:
                zones[zone] = load_zone(zone_path(store.root, zone))
            zones[zone] = splice_zone(zones[zone], lo, hi, win.get(zone, {}))
    for zone, zf in zones.items():
        if not zf["f"]:
            continue
        if zone == "fr":
            label = "France"
        elif zone.startswith("r:"):
            label = zone[2:]
        else:
            label = (depts.get(zone[2:]) or {}).get("nom") or zone[2:]
        save_zone(zone_path(store.root, zone), zone, label, zf)
    return len(zones)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

README_TEXT = """# Carbu'Web — historique des prix des carburants

Branche generee automatiquement par la CI (`pipeline/history.py`). Ne pas modifier a la main.
Servie telle quelle sous `https://carbuweb.folf.fr/history/`.

## Sources

1. Archives annuelles officielles `donnees.roulez-eco.fr/opendata/annee/AAAA` (tous les
   changements de prix depuis 2007) — elles font foi pour les jours qu'elles couvrent.
2. Prix releves a chaque build du site — completent la journee en cours.

## Modele

Resolution journaliere : pour chaque station et carburant, le prix de cloture de chaque
jour ou il change. Un prix stable reconfirme est reenregistre tous les {keepalive} jours ;
un releve vaut au plus {ttl} jours (au-dela : pas de donnee). Prix en millimes d'euro.

## Fichiers

- `index.json` : manifeste (schema, couverture, sources importees, zones).
- `stations/<2 derniers chiffres de l'id>/<id>.json` :
  `{{"v":1,"id":"…","m":{{"n":nom,"a":adresse,"cp":…,"c":ville}},"f":{{"Gazole":[j0,p0,dj1,dp1,…]}}}}`
  `j` = jours depuis le 1970-01-01, `p` = prix en millimes ; apres le premier couple,
  valeurs en delta par rapport au precedent.
- `zones/fr.json`, `zones/region/<slug>.json`, `zones/dept/<code>.json` : moyennes journalieres
  `{{"d0":jour,"len":n,"f":{{"Gazole":{{"a":[…],"n":[…]}}}}}}` — `a` moyenne (millimes) et `n` nombre
  de stations, en deltas ; `n = 0` : pas de donnee ce jour.

## Stockage git

La branche garde une fenetre glissante de commits recents puis est consolidee en un commit
racine : sa taille suit le volume de donnees, pas le nombre de builds. Tout l'historique
peut etre reconstruit depuis les archives officielles.
"""


def _plan_years(manifest, year_now, backfill):
    """Annees a verifier : courante et precedente (republiees), puis import retroactif progressif."""
    done = manifest.get("annual") or {}
    fails = manifest.get("failures") or {}
    plan = [y for y in (year_now, year_now - 1) if y >= HISTORY_FIRST_YEAR]
    missing = [
        y for y in range(year_now - 2, HISTORY_FIRST_YEAR - 1, -1)
        if str(y) not in done and int(fails.get(str(y), 0)) < HISTORY_MAX_YEAR_FAILURES
    ]
    return plan + missing[:backfill]


def _ingest_year(store, year, today, local_zip=None, force=False):
    """Importe l'archive d'une annee si elle a change. Retourne une plage modifiee ou None."""
    url = HISTORY_ANNUAL_URL.format(year=year)
    prev = (store.manifest.get("annual") or {}).get(str(year))
    lm = None if local_zip else _http_last_modified(url)
    if not local_zip and not force:
        if lm is None:
            if prev is None:
                log.info("Historique : archive %d indisponible pour l'instant.", year)
            return None
        if prev and prev.get("last_modified") == lm:
            return None
    a = day_num(date(year, 1, 1))
    b = min(day_num(date(year, 12, 31)), today)
    if lm:
        try:
            b = min(b, day_num(parsedate_to_datetime(lm).astimezone(timezone.utc).date()))
        except (TypeError, ValueError):
            pass

    t0 = time.time()
    tmp = None
    try:
        if local_zip:
            path = local_zip
        else:
            os.makedirs(DATASETS_DIR, exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=f"annuel-{year}-", suffix=".zip", dir=DATASETS_DIR)
            os.close(fd)
            _download(url, tmp)
            path = tmp
        changed, n_st, max_day = ingest_annual(store, path, a, b)
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
    store.manifest.setdefault("annual", {})[str(year)] = {
        "last_modified": lm,
        "ingested": datetime.now(PARIS).isoformat(timespec="seconds"),
        "stations": n_st,
        "max_day": day_str(max_day) if max_day is not None else None,
    }
    (store.manifest.get("failures") or {}).pop(str(year), None)
    log.info(
        "Historique : archive %d importee (%d stations, jusqu'au %s, %.1fs).",
        year, n_st, day_str(max_day) if max_day is not None else "—", time.time() - t0,
    )
    if changed is None:
        return None
    return (changed, min(b + HISTORY_TTL_DAYS + HISTORY_KEEPALIVE_DAYS, today))


def _dept_info(manifest, db):
    depts = {k: dict(v) for k, v in (manifest.get("depts") or {}).items()}
    for code, d in ((db or {}).get("dept_index") or {}).items():
        reg = d.get("region")
        depts[code] = {"nom": d.get("nom") or code, "region": reg if reg and reg != "Inconnue" else None}
    return depts


def update_history(store_dir=HISTORY_DIR, db_file=DB_FILE, years=None, backfill=HISTORY_BACKFILL_PER_RUN,
                   local_zips=None, rebuild_zones=False):
    """Met a jour le depot d'historique. N'ecrit rien si une etape echoue ou si l'integrite est douteuse."""
    t0 = time.time()
    store = HistoryStore(store_dir).load()
    prev_st, prev_rec = int(store.manifest.get("stations") or 0), int(store.manifest.get("records") or 0)
    today = day_num(date.fromisoformat(TODAY))
    db = None
    if db_file and os.path.isfile(db_file):
        with open(db_file, encoding="utf-8") as f:
            db = json.load(f)
    depts = _dept_info(store.manifest, db)
    dirty = []

    local_zips = local_zips or {}
    plan = years if years is not None else _plan_years(store.manifest, date.fromisoformat(TODAY).year, backfill)
    for year in plan:
        try:
            r = _ingest_year(store, year, today, local_zip=local_zips.get(year), force=years is not None)
            if r:
                dirty.append(r)
        except Exception as exc:  # noqa: BLE001 — une archive defectueuse ne doit pas bloquer les autres
            fails = store.manifest.setdefault("failures", {})
            fails[str(year)] = int(fails.get(str(year), 0)) + 1
            log.warning("Historique : import de l'archive %d en echec (%s) — tentative %d.", year, exc, fails[str(year)])

    if db:
        cd = ingest_snapshot(store, db, today)
        if cd is not None:
            dirty.append((cd, today))
        store.manifest["snapshot"] = (db.get("meta") or {}).get("latest_fuel_price_update_iso") or None

    n_st, n_rec, first, last = store.counts()
    if n_st < prev_st:
        raise HistoryIntegrityError(f"Stations : {prev_st} → {n_st}")
    if prev_rec and n_rec < prev_rec * (1 - HISTORY_MAX_RECORD_DROP):
        raise HistoryIntegrityError(f"Releves : {prev_rec} → {n_rec}")
    if not n_st:
        log.info("Historique : aucune donnee a enregistrer.")
        return store

    zu = parse_day(store.manifest.get("zones_until"))
    if rebuild_zones or zu is None:
        shutil.rmtree(os.path.join(store_dir, "zones"), ignore_errors=True)
        dirty = [(first, today)]
    elif zu < today:
        dirty.append((zu + 1, today))
    written = store.save_stations()
    n_zones = update_zones(store, dirty, depts)

    store.manifest.update({
        "v": HISTORY_SCHEMA,
        "generated": datetime.now(PARIS).isoformat(timespec="seconds"),
        "fuels": ALL_FUELS,
        "ttl_days": HISTORY_TTL_DAYS,
        "keepalive_days": HISTORY_KEEPALIVE_DAYS,
        "first_day": day_str(first),
        "last_day": day_str(last),
        "zones_until": day_str(today),
        "stations": n_st,
        "records": n_rec,
        "years": sorted(int(y) for y in (store.manifest.get("annual") or {})),
        "regions": {r: region_slug(r) for r in sorted({d["region"] for d in depts.values() if d.get("region")})},
        "depts": dict(sorted(depts.items())),
    })
    _write_json(os.path.join(store_dir, "index.json"), store.manifest)
    _write_text_if_changed(
        os.path.join(store_dir, "README.md"),
        README_TEXT.format(ttl=HISTORY_TTL_DAYS, keepalive=HISTORY_KEEPALIVE_DAYS),
    )
    _write_text_if_changed(os.path.join(store_dir, ".gitattributes"), "*.json -diff linguist-generated=true\n")
    log.info(
        "Historique : %d stations, %d releves (%s → %s) — %d fichiers station, %d zones ecrits en %.1fs.",
        n_st, n_rec, day_str(first), day_str(last), written, n_zones, time.time() - t0,
    )
    return store


def publish_history(store_dir=HISTORY_DIR, build_dir=BUILD_DIR):
    """Copie les donnees servies (sans .git ni README) dans build/history/."""
    dst = os.path.join(build_dir, HISTORY_BUILD_DIRNAME)
    shutil.rmtree(dst, ignore_errors=True)
    if not os.path.isfile(os.path.join(store_dir, "index.json")):
        log.info("Historique : aucun depot dans %s, rien a publier.", store_dir)
        return False
    os.makedirs(dst)
    shutil.copy2(os.path.join(store_dir, "index.json"), dst)
    for sub in ("stations", "zones"):
        src = os.path.join(store_dir, sub)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(dst, sub), ignore=shutil.ignore_patterns("*.tmp"))
    return True


def restore_store(store_dir):
    """Remet le depot dans son dernier etat commite (echec en cours d'ecriture).

    Sans cela, la CI pourrait publier un melange de fichiers neufs et d'un manifeste ancien.
    """
    if not os.path.isdir(os.path.join(store_dir, ".git")):
        return False
    for cmd in (["git", "reset", "--hard", "--quiet"], ["git", "clean", "-fdq"]):
        subprocess.run(cmd, cwd=store_dir, check=False, capture_output=True, timeout=120)
    log.warning("Historique : depot remis a son dernier etat commite.")
    return True


def run_history_phase():
    """Phase historique du build : ne fait jamais echouer la generation du site."""
    if not HISTORY_ENABLED:
        log.info("Historique desactive (CARBUWEB_HISTORY=0).")
        return
    try:
        update_history(HISTORY_DIR)
    except Exception:  # noqa: BLE001
        log.exception("Historique : mise a jour abandonnee, le site est publie avec l'historique precedent.")
        restore_store(HISTORY_DIR)
    try:
        publish_history(HISTORY_DIR)
    except Exception:  # noqa: BLE001
        log.exception("Historique : copie vers build/ impossible.")


def main(argv=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser(prog="python -m pipeline.history", description="Historique des prix Carbu'Web")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("update", help="archives a jour + releves du dernier build (defaut)")
    bf = sub.add_parser("backfill", help="importer des annees precises")
    bf.add_argument("years", nargs="+", type=int)
    bf.add_argument("--zip", action="append", default=[], metavar="ANNEE=CHEMIN", help="archive locale deja telechargee")
    sub.add_parser("rebuild-zones", help="recalculer toutes les moyennes de zone")
    sub.add_parser("publish", help="copier le depot dans build/history/")
    args = ap.parse_args(argv)

    if args.cmd == "backfill":
        zips = {}
        for z in args.zip:
            y, _, p = z.partition("=")
            zips[int(y)] = p
        update_history(years=args.years, local_zips=zips)
    elif args.cmd == "rebuild-zones":
        update_history(years=[], rebuild_zones=True)
    elif args.cmd == "publish":
        publish_history()
    else:
        update_history()
    publish_history()


if __name__ == "__main__":
    main()
