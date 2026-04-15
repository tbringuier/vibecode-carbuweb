import importlib
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, mock_open, patch

import pandas as pd

from pipeline import download as download_module
from pipeline import helpers as helpers_module
from pipeline.dedup import deduplicate_daily
from pipeline.download import EXCEL_RT_URL, download_daily_prices, download_flux_prices
from pipeline.helpers import build_download_url, flux_maj_iso_and_date, parse_price_cell, price_entry_should_replace
from pipeline.stations import inject_daily_prices, merge_flux_instantane, register_station

main_module = importlib.import_module("pipeline.main")


class ParsePriceCellTests(unittest.TestCase):
    def test_accepts_float_and_fr_decimal_string(self):
        self.assertEqual(parse_price_cell(2.236), 2.236)
        self.assertEqual(parse_price_cell("2,236"), 2.236)
        self.assertEqual(parse_price_cell("2.236"), 2.236)

    def test_rejects_empty_values(self):
        self.assertIsNone(parse_price_cell(""))
        self.assertIsNone(parse_price_cell("nan"))
        self.assertIsNone(parse_price_cell(None))


class PriceEntryReplacementTests(unittest.TestCase):
    def test_more_precise_datetime_beats_same_day_date_only(self):
        daily_entry = {"prix": 2.215, "date_maj": "2026-04-15"}
        realtime_entry = {
            "prix": 2.236,
            "date_maj": "2026-04-15",
            "maj_iso": "2026-04-15T12:11:36+02:00",
        }

        self.assertTrue(price_entry_should_replace(daily_entry, realtime_entry))
        self.assertFalse(price_entry_should_replace(realtime_entry, daily_entry))

    def test_equal_timestamp_can_prefer_incoming_entry(self):
        existing = {
            "prix": 2.215,
            "date_maj": "2026-04-15",
            "maj_iso": "2026-04-15T12:11:36+02:00",
        }
        incoming = {
            "prix": 2.236,
            "date_maj": "2026-04-15",
            "maj_iso": "2026-04-15T12:11:36+02:00",
        }

        self.assertFalse(price_entry_should_replace(existing, incoming))
        self.assertTrue(price_entry_should_replace(existing, incoming, prefer_incoming_on_tie=True))

    def test_live_chateaubriant_case_prefers_realtime(self):
        daily_entry = {
            "prix": 2.215,
            "date_maj": "2026-04-13",
            "maj_iso": "2026-04-13T13:24:08+02:00",
        }
        realtime_entry = {
            "prix": 2.236,
            "date_maj": "2026-04-15",
            "maj_iso": "2026-04-15T12:11:36+02:00",
        }

        self.assertTrue(price_entry_should_replace(daily_entry, realtime_entry, prefer_incoming_on_tie=True))

    def test_date_only_flux_does_not_beat_more_precise_same_day_daily_timestamp(self):
        flux_iso, flux_date = flux_maj_iso_and_date("2026-04-15")
        daily_entry = {
            "prix": 2.215,
            "date_maj": "2026-04-15",
            "maj_iso": "2026-04-15T09:15:00+02:00",
        }
        realtime_entry = {"prix": 2.236, "date_maj": flux_date, "maj_iso": flux_iso}

        self.assertIsNone(flux_iso)
        self.assertEqual(flux_date, "2026-04-15")
        self.assertFalse(price_entry_should_replace(daily_entry, realtime_entry, prefer_incoming_on_tie=True))


class DownloadFreshnessTests(unittest.TestCase):
    def test_build_download_url_preserves_query_and_adds_unique_cache_buster(self):
        first = build_download_url(EXCEL_RT_URL)
        second = build_download_url(EXCEL_RT_URL)

        self.assertIn("timezone=Europe%2FParis", first)
        self.assertIn("_cb=", first)
        self.assertNotEqual(first, second)

    def test_download_daily_prices_calls_fetch_with_cache_busted_url(self):
        fake_response = MagicMock()
        fake_response.iter_content.return_value = []
        with (
            patch("pipeline.download.build_download_url", return_value="https://example.test/daily?_cb=123") as build_url,
            patch("pipeline.download.fetch", return_value=fake_response) as fetch_mock,
            patch("builtins.open", mock_open()),
        ):
            download_daily_prices()

        build_url.assert_called_once_with(download_module.EXCEL_URL)
        fetch_mock.assert_called_once_with("https://example.test/daily?_cb=123", stream=True, timeout=180, retries=10)

    def test_download_flux_prices_calls_fetch_with_cache_busted_url(self):
        fake_response = MagicMock()
        fake_response.iter_content.return_value = []
        with (
            patch("pipeline.download.build_download_url", return_value="https://example.test/rt?_cb=456") as build_url,
            patch("pipeline.download.fetch", return_value=fake_response) as fetch_mock,
            patch("builtins.open", mock_open()),
        ):
            download_flux_prices()

        build_url.assert_called_once_with(download_module.EXCEL_RT_URL)
        fetch_mock.assert_called_once_with("https://example.test/rt?_cb=456", stream=True, timeout=180, retries=10)

    def test_fetch_sends_no_cache_headers_and_user_agent(self):
        response = MagicMock()
        response.raise_for_status.return_value = None
        with patch("pipeline.helpers.requests.get", return_value=response) as get_mock:
            helpers_module.fetch("https://example.test/export.xlsx", timeout=42, retries=1)

        self.assertEqual(get_mock.call_count, 1)
        kwargs = get_mock.call_args.kwargs
        self.assertEqual(kwargs["timeout"], 42)
        self.assertIn("User-Agent", kwargs["headers"])
        self.assertEqual(kwargs["headers"]["User-Agent"], helpers_module.HTTP_USER_AGENT)
        self.assertIn("Cache-Control", kwargs["headers"])
        self.assertIn("Pragma", kwargs["headers"])


class PipelineIntegrationTests(unittest.TestCase):
    def test_daily_then_realtime_merge_promotes_live_chateaubriant_price(self):
        daily = pd.DataFrame([
            {
                "id": 44110001,
                "Région": "Pays de la Loire",
                "Département": "44",
                "ville": "Châteaubriant",
                "Code postal": "44110",
                "adresse": "ROUTE DE SAINT AUBIN DES CHATEAUX",
                "geom": "47.7161,-1.3764",
                "horaires": "",
                "Carburant": "Gazole",
                "Prix": "2,215",
                "Mise à jour des prix": "2026-04-13T13:24:08+02:00",
                "Carburant en rupture": "",
                "Début rupture": "",
            }
        ])
        best_daily, ruptures, station_rows = deduplicate_daily(daily)
        db = {
            "stations": {},
            "geo_tree": {},
            "cp_index": {},
            "recherche_texte": {},
            "meta": {},
        }
        for sid, info in station_rows.items():
            register_station(
                db,
                {},
                sid,
                info["region"],
                info["dept"],
                info["city"],
                info["cp"],
                info["addr"],
                info["lat"],
                info["lon"],
                info["horaires"],
            )
        inject_daily_prices(db, best_daily, ruptures)

        realtime = pd.DataFrame([
            {
                "id": "44110001",
                "Région": "Pays de la Loire",
                "Département": "44",
                "Ville": "Châteaubriant",
                "Code postal": "44110",
                "Adresse": "ROUTE DE SAINT AUBIN DES CHATEAUX",
                "geom": "47.7161,-1.3764",
                "horaires": "",
                "Prix Gazole": "2.236",
                "Prix Gazole mis à jour le": "2026-04-15T12:11:36+02:00",
            }
        ])

        with TemporaryDirectory() as tmpdir:
            rt_path = f"{tmpdir}/realtime.xlsx"
            realtime.to_excel(rt_path, index=False)
            with patch("pipeline.stations.EXCEL_RT_FILE", rt_path):
                merge_flux_instantane(db, {})

        gazole = db["stations"]["44110001"]["carburants_disponibles"]["Gazole"]
        self.assertEqual(gazole["prix"], 2.236)
        self.assertEqual(gazole["date_maj"], "2026-04-15")
        self.assertEqual(gazole["maj_iso"], "2026-04-15T12:11:36+02:00")


class MainOrchestrationTests(unittest.TestCase):
    def test_main_always_refreshes_price_exports_even_if_database_exists(self):
        with (
            patch("pipeline.main.cleanup_old_files") as cleanup_mock,
            patch("pipeline.main.download_daily_prices") as daily_mock,
            patch("pipeline.main.download_flux_prices") as flux_mock,
            patch("pipeline.main.download_osm") as osm_mock,
            patch("pipeline.main.build_database") as build_mock,
            patch("pipeline.main.generate_site") as site_mock,
            patch("pipeline.main.os.path.exists", side_effect=lambda path: path == main_module.OSM_FILE),
        ):
            main_module.main()

        cleanup_mock.assert_called_once_with()
        daily_mock.assert_called_once_with()
        flux_mock.assert_called_once_with()
        osm_mock.assert_not_called()
        build_mock.assert_called_once_with()
        site_mock.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
