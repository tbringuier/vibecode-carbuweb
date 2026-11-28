import json
import os
import random
import unittest
import zipfile
from datetime import date
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pipeline import history as H
from pipeline.history import (
    HistoryIntegrityError,
    HistoryStore,
    compact,
    compute_zone_window,
    day_num,
    decode_daily,
    decode_series,
    encode_daily,
    encode_series,
    first_diff_day,
    ingest_annual,
    ingest_snapshot,
    merge_tail,
    merge_tail_encoded,
    parse_annual_price,
    replace_range,
    snapshot_day,
    splice_zone,
)

D = lambda s: day_num(date.fromisoformat(s))  # noqa: E731


def make_annual_zip(path, stations):
    """stations: {id: (cp, [(fuel, maj, valeur), ...])} -> archive au format officiel (ISO-8859-1)."""
    parts = ['<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>\n<pdv_liste>']
    for sid, (cp, prices) in stations.items():
        parts.append(f'<pdv id="{sid}" latitude="4620138" longitude="519829" cp="{cp}" pop="R">')
        parts.append("<adresse>1 RUE DE LA GARE</adresse><ville>SAINT-DENIS-LÈS-BOURG</ville>")
        for fuel, maj, val in prices:
            parts.append(f'<prix nom="{fuel}" id="1" maj="{maj}" valeur="{val}"/>')
        parts.append("</pdv>")
    parts.append("</pdv_liste>")
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("PrixCarburants_annuel.xml", "\n".join(parts).encode("iso-8859-1"))


class EncodingTests(unittest.TestCase):
    def test_series_round_trip(self):
        recs = [(D("2026-01-02"), 1638), (D("2026-01-03"), 1649), (D("2026-01-10"), 1601)]
        enc = encode_series(recs)
        self.assertEqual(enc[:2], [D("2026-01-02"), 1638])
        self.assertEqual(enc[2:], [1, 11, 7, -48])
        self.assertEqual(decode_series(enc), recs)
        self.assertEqual(decode_series([]), [])

    def test_daily_round_trip_with_missing_days(self):
        avg, cnt = [1700, 0, 1710, 1690], [10, 0, 12, 11]
        a, n = encode_daily(avg, cnt)
        self.assertEqual(a[1], 0)  # jour sans donnee : moyenne reportee (delta nul)
        self.assertEqual(decode_daily(a, n), (avg, cnt))


class MergeTests(unittest.TestCase):
    def test_compact_keeps_changes_and_keepalives(self):
        recs = [(0, 1700), (10, 1700), (20, 1700), (30, 1700), (40, 1700), (41, 1710)]
        self.assertEqual(compact(recs, keepalive=30), [(0, 1700), (30, 1700), (41, 1710)])

    def test_merge_tail(self):
        recs = []
        self.assertEqual(merge_tail(recs, 10, 1700), 10)
        self.assertIsNone(merge_tail(recs, 12, 1700))            # meme prix, < keepalive
        self.assertEqual(merge_tail(recs, 13, 1720), 13)          # changement
        self.assertEqual(merge_tail(recs, 13, 1730), 13)          # second changement du jour : cloture
        self.assertEqual(recs, [(10, 1700), (13, 1730)])
        self.assertEqual(merge_tail(recs, 13, 1700), 13)          # retour au prix precedent dans la journee
        self.assertEqual(recs, [(10, 1700)])
        self.assertIsNone(merge_tail(recs, 5, 1600))              # plus ancien : l'archive fait foi
        self.assertEqual(merge_tail(recs, 40, 1700, keepalive=30), 40)  # reconfirmation

    def test_merge_tail_encoded_matches_decoded_version(self):
        rng = random.Random(42)
        for _ in range(300):
            recs, arr = [], []
            day = 100
            for _ in range(rng.randint(1, 25)):
                day += rng.choice([-2, 0, 0, 1, 1, 3, 35])
                price = 1700 + rng.choice([0, 0, 5, -5, 10])
                r1 = merge_tail(recs, day, price, keepalive=30)
                r2 = merge_tail_encoded(arr, day, price, keepalive=30)
                self.assertEqual(r1, r2)
                self.assertEqual(decode_series(arr), recs)

    def test_replace_range_is_authoritative_inside_range_only(self):
        recs = [(1, 1500), (5, 1510), (8, 1520), (12, 1530)]
        out = replace_range(recs, 5, 10, [(6, 1500), (9, 1525)])
        # (5, 1510) et (8, 1520) remplaces ; (6, 1500) redondant avec (1, 1500) donc compacte.
        self.assertEqual(out, [(1, 1500), (9, 1525), (12, 1530)])

    def test_first_diff_day(self):
        self.assertIsNone(first_diff_day([(1, 1), (2, 2)], [(1, 1), (2, 2)]))
        self.assertEqual(first_diff_day([(1, 1), (5, 2)], [(1, 1), (3, 2)]), 3)
        self.assertEqual(first_diff_day([(1, 1)], [(1, 1), (7, 3)]), 7)


class AnnualParsingTests(unittest.TestCase):
    def test_price_formats(self):
        self.assertEqual(parse_annual_price("1.789"), 1789)
        self.assertEqual(parse_annual_price("2.04"), 2040)
        self.assertEqual(parse_annual_price("999"), 999)      # millimes (archives 2007-2021)
        self.assertEqual(parse_annual_price("2"), 2000)       # euros entiers
        self.assertEqual(parse_annual_price("1,5"), 1500)
        self.assertIsNone(parse_annual_price(""))
        self.assertIsNone(parse_annual_price("abc"))

    def test_iter_annual_closing_price_per_day_both_formats(self):
        with TemporaryDirectory() as tmp:
            z = os.path.join(tmp, "a.zip")
            make_annual_zip(z, {
                "1000001": ("01000", [
                    ("Gazole", "2007-01-04 08:00:00.841521", "999"),
                    ("Gazole", "2007-01-04 18:43:38.841521", "989"),   # cloture du 4
                    ("Gazole", "2007-01-05T09:00:00", "989"),           # meme prix : compacte
                    ("Gazole", "2007-01-09T09:00:00", "1.002"),
                    ("Gazole", "2007-01-10T09:00:00", "9999"),          # hors plage : ignore
                    ("Kerosene", "2007-01-10T09:00:00", "1.5"),         # carburant inconnu
                    ("SP95", "2006-12-31T23:00:00", "1.2"),             # hors annee
                ]),
                "abc": ("01000", [("Gazole", "2007-01-04T08:00:00", "1.0")]),  # id invalide
            })
            rows = list(H.iter_annual(z, D("2007-01-01"), D("2007-12-31")))
        self.assertEqual(len(rows), 1)
        sid, meta, series = rows[0]
        self.assertEqual(sid, "1000001")
        self.assertEqual(meta["cp"], "01000")
        self.assertEqual(meta["c"], "SAINT-DENIS-LÈS-BOURG")
        self.assertEqual(series, {"Gazole": [(D("2007-01-04"), 989), (D("2007-01-09"), 1002)]})


class SnapshotTests(unittest.TestCase):
    def test_snapshot_day_uses_utc_date_like_official_archives(self):
        self.assertEqual(snapshot_day({"maj_iso": "2026-11-26T01:01:00+01:00"}), D("2026-11-26"))
        self.assertEqual(snapshot_day({"maj_iso": "2026-11-26T00:30:00+01:00"}), D("2026-11-25"))
        self.assertEqual(snapshot_day({"date_maj": "2026-11-20"}), D("2026-11-20"))
        self.assertIsNone(snapshot_day({}))

    def test_annual_then_snapshot(self):
        store = HistoryStore("/nonexistent")
        db = {"stations": {"1000001": {
            "nom_osm": "Total", "adresse": "1 rue", "code_postal": "01000", "ville": "BOURG",
            "carburants_disponibles": {
                "Gazole": {"prix": 1.75, "date_maj": "2026-11-25", "maj_iso": "2026-11-25T09:00:00+01:00"},
                "Kerosene": {"prix": 1.5, "date_maj": "2026-11-25"},
            },
        }}}
        self.assertEqual(ingest_snapshot(store, db, today=D("2026-11-27")), D("2026-11-25"))
        self.assertEqual(store.stations["1000001"]["m"]["n"], "Total")
        with TemporaryDirectory() as tmp:
            z = os.path.join(tmp, "a.zip")
            make_annual_zip(z, {"1000001": ("01000", [
                ("Gazole", "2026-11-20T08:00:00", "1.700"),
                ("Gazole", "2026-11-25T08:00:00", "1.740"),
            ])})
            changed, n_st, max_day = ingest_annual(store, z, D("2026-01-01"), D("2026-11-25"))
        self.assertEqual((n_st, max_day), (1, D("2026-11-25")))
        self.assertEqual(changed, D("2026-11-20"))
        # L'archive fait foi pour le 25 (1,740) ; la meta du releve live n'est pas ecrasee.
        self.assertEqual(decode_series(store.stations["1000001"]["f"]["Gazole"]), [(D("2026-11-20"), 1700), (D("2026-11-25"), 1740)])
        self.assertEqual(store.stations["1000001"]["m"]["n"], "Total")
        db["stations"]["1000001"]["carburants_disponibles"]["Gazole"] = {"prix": 1.76, "maj_iso": "2026-11-26T10:00:00+01:00"}
        ingest_snapshot(store, db, today=D("2026-11-27"))
        self.assertEqual(decode_series(store.stations["1000001"]["f"]["Gazole"])[-1], (D("2026-11-26"), 1760))


class ZoneTests(unittest.TestCase):
    def test_zone_window_averages_with_ttl(self):
        store = HistoryStore("/nonexistent")
        store.stations = {
            "1000001": {"m": {"cp": "01000"}, "f": {"Gazole": encode_series([(100, 1700), (103, 1800)])}},
            "1000002": {"m": {"cp": "01090"}, "f": {"Gazole": encode_series([(101, 1600)])}},
            "2000001": {"m": {"cp": "02000"}, "f": {"Gazole": encode_series([(50, 1500)])}},  # expire (ttl) avant la fenetre
        }
        depts = {"01": {"nom": "Ain", "region": "Auvergne-Rhône-Alpes"}}
        win = compute_zone_window(store, 100, 104, depts, ttl=45)
        avg, cnt = win["d:01"]["Gazole"]
        self.assertEqual(cnt, [1, 2, 2, 2, 2])
        self.assertEqual(avg, [1700, 1650, 1650, 1700, 1700])
        self.assertEqual(win["r:Auvergne-Rhône-Alpes"]["Gazole"], (avg, cnt))
        self.assertEqual(win["fr"]["Gazole"][1], cnt)
        self.assertNotIn("d:02", win)

    def test_splice_extends_both_ends(self):
        zf = splice_zone(None, 10, 12, {"Gazole": ([1, 2, 3], [1, 1, 1])})
        zf = splice_zone(zf, 7, 8, {"Gazole": ([5, 6], [2, 2])})
        zf = splice_zone(zf, 14, 14, {"Gazole": ([9], [3])})
        self.assertEqual((zf["d0"], zf["len"]), (7, 8))
        self.assertEqual(zf["f"]["Gazole"], ([5, 6, 0, 1, 2, 3, 0, 9], [2, 2, 0, 1, 1, 1, 0, 3]))


class UpdateHistoryTests(unittest.TestCase):
    def _db(self, path, prix):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "stations": {"1000001": {
                    "nom_osm": "Total", "adresse": "1 rue", "code_postal": "01000", "ville": "BOURG",
                    "carburants_disponibles": {"Gazole": {"prix": prix, "maj_iso": "2026-11-26T10:00:00+01:00"}},
                }},
                "dept_index": {"01": {"nom": "Ain", "region": "Auvergne-Rhône-Alpes"}},
                "meta": {"latest_fuel_price_update_iso": "2026-11-26T10:00+01:00"},
            }, f)

    def test_end_to_end_write_publish_and_integrity_guard(self):
        with TemporaryDirectory() as tmp, patch.object(H, "TODAY", "2026-11-27"):
            store_dir, db_file, build = (os.path.join(tmp, x) for x in ("store", "db.json", "build"))
            z = os.path.join(tmp, "a.zip")
            make_annual_zip(z, {
                "1000001": ("01000", [("Gazole", "2026-11-20T08:00:00", "1.700")]),
                "1000002": ("01090", [("SP98", "2026-11-21T08:00:00", "1.900")]),
            })
            self._db(db_file, 1.75)
            H.update_history(store_dir, db_file, years=[2026], local_zips={2026: z})
            with open(os.path.join(store_dir, "index.json"), encoding="utf-8") as f:
                idx = json.load(f)
            self.assertEqual((idx["stations"], idx["records"]), (2, 3))
            self.assertEqual(idx["zones_until"], "2026-11-27")
            self.assertEqual(idx["regions"], {"Auvergne-Rhône-Alpes": "auvergne-rhone-alpes"})
            with open(os.path.join(store_dir, "stations", "01", "1000001.json"), encoding="utf-8") as f:
                doc = json.load(f)
            self.assertEqual(decode_series(doc["f"]["Gazole"]), [(D("2026-11-20"), 1700), (D("2026-11-26"), 1750)])
            for zone in ("fr.json", "region/auvergne-rhone-alpes.json", "dept/01.json"):
                self.assertTrue(os.path.isfile(os.path.join(store_dir, "zones", zone)), zone)

            # Re-run idempotent : seuls manifeste/zones bougent, aucun fichier station reecrit.
            store = H.update_history(store_dir, db_file, years=[])
            self.assertEqual(store.manifest["records"], 3)

            self.assertTrue(H.publish_history(store_dir, build))
            published = sorted(os.listdir(os.path.join(build, "history")))
            self.assertEqual(published, ["index.json", "stations", "zones"])

            # Perte simulee de releves : rien n'est ecrit.
            os.remove(os.path.join(store_dir, "stations", "02", "1000002.json"))
            with self.assertRaises(HistoryIntegrityError):
                H.update_history(store_dir, db_file, years=[])

    def test_failed_update_restores_last_committed_state(self):
        import subprocess
        with TemporaryDirectory() as tmp:
            store_dir = os.path.join(tmp, "store")
            os.makedirs(store_dir)
            git = lambda *a: subprocess.run(["git", *a], cwd=store_dir, check=True, capture_output=True)  # noqa: E731
            git("init", "-q", "-b", "history")
            with open(os.path.join(store_dir, "index.json"), "w") as f:
                f.write("{}")
            git("add", "-A")
            git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
            with open(os.path.join(store_dir, "index.json"), "w") as f:
                f.write('{"partiel": true}')
            os.makedirs(os.path.join(store_dir, "stations", "01"))
            with open(os.path.join(store_dir, "stations", "01", "1000001.json"), "w") as f:
                f.write("{}")
            with patch.object(H, "HISTORY_ENABLED", True), patch.object(H, "HISTORY_DIR", store_dir), \
                    patch.object(H, "update_history", side_effect=RuntimeError("boom")), \
                    patch.object(H, "publish_history"):
                H.run_history_phase()
            with open(os.path.join(store_dir, "index.json")) as f:
                self.assertEqual(f.read(), "{}")
            self.assertFalse(os.path.exists(os.path.join(store_dir, "stations")))

    def test_backfill_budget_keeps_recent_years_and_defers_older_ones(self):
        calls = []

        def fake_ingest(store, year, today, local_zip=None, force=False):
            calls.append(year)
            return None

        clock = iter([0])  # t0 = 0, puis toute lecture de l'horloge renvoie 1000 s
        with TemporaryDirectory() as tmp, patch.object(H, "TODAY", "2026-11-27"), \
                patch.object(H, "HISTORY_FIRST_YEAR", 2020), \
                patch.object(H, "_ingest_year", side_effect=fake_ingest), \
                patch.object(H.time, "time", side_effect=lambda: next(clock, 1000)):
            H.update_history(os.path.join(tmp, "store"), None, budget_s=10)
        # 2026 et 2025 toujours verifiees ; budget depasse avant l'import retroactif (2024…).
        self.assertEqual(calls, [2026, 2025])

    def test_plan_years(self):
        manifest = {"annual": {"2026": {}, "2025": {}, "2024": {}}, "failures": {"2023": 3}}
        with patch.object(H, "HISTORY_FIRST_YEAR", 2019):
            self.assertEqual(H._plan_years(manifest, 2026, 2), [2026, 2025, 2022, 2021])
            self.assertEqual(H._plan_years({}, 2026, 0), [2026, 2025])


if __name__ == "__main__":
    unittest.main()
