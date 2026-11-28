import json
import os
import unittest
from datetime import date, datetime
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo

from pipeline.export import (
    build_payloads,
    encode_hours,
    entry_minutes,
    normalize_day_hours,
    osm_ref,
    write_frontend_data,
)


def station(dept, region, cp, prices=None, horaires=None, **kw):
    return {
        "nom_osm": kw.get("nom"), "url_osm": kw.get("url"), "adresse": "1 RUE DE LA GARE", "ville": "BOURG",
        "code_postal": cp, "region": region, "departement": dept, "lat": 46.2, "lon": 5.2,
        "horaires": horaires or {"automate_24_24": False, "jours": {"Statut": "Horaires indisponibles"}},
        "carburants_disponibles": prices or {}, "carburants_en_rupture": kw.get("ruptures", {}),
    }


class HoursTests(unittest.TestCase):
    def test_day_normalisation(self):
        self.assertEqual(normalize_day_hours("07.00 - 12.00 / 14.00 - 19.00"), "07:00-12:00,14:00-19:00")
        self.assertEqual(normalize_day_hours("Fermé"), "")
        self.assertIsNone(normalize_day_hours("Horaires indisponibles"))
        self.assertIsNone(normalize_day_hours(None))

    def test_encode(self):
        table = {}
        jours = {d: "07.00 - 21.00" for d in ("Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi")}
        jours.update({"Samedi": "Fermé"})
        self.assertEqual(encode_hours({"automate_24_24": True, "jours": jours}, table), [1, 0, 0, 0, 0, 0, 1, -1])
        self.assertEqual(table, {"07:00-21:00": 0, "": 1})
        # « Ferme » partout sans automate : valeur par defaut de la source, consideree inconnue.
        closed = {d: "Fermé" for d in ("Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche")}
        self.assertEqual(encode_hours({"automate_24_24": False, "jours": closed}, {}), 0)
        self.assertEqual(encode_hours({"automate_24_24": True, "jours": {"Statut": "Horaires indisponibles"}}, {}), 1)


class FieldTests(unittest.TestCase):
    def test_osm_ref(self):
        self.assertEqual(osm_ref("https://www.openstreetmap.org/node/2061523189"), "n2061523189")
        self.assertEqual(osm_ref("https://www.openstreetmap.org/way/42"), "w42")
        self.assertEqual(osm_ref(None), "")

    def test_entry_minutes(self):
        m = entry_minutes({"maj_iso": "2026-11-27T01:44:00+01:00"})
        self.assertEqual(m * 60, int(datetime(2026, 11, 27, 0, 44, tzinfo=ZoneInfo("UTC")).timestamp()))
        noon = entry_minutes({"date_maj": "2026-11-27"})
        self.assertEqual(noon * 60, int(datetime(2026, 11, 27, 12, 0, tzinfo=ZoneInfo("Europe/Paris")).timestamp()))
        self.assertIsNone(entry_minutes({}))


class PayloadTests(unittest.TestCase):
    def setUp(self):
        p = lambda v, iso: {"prix": v, "date_maj": iso[:10], "maj_iso": iso}  # noqa: E731
        self.db = {
            "stations": {
                "1000001": station("Ain", "Auvergne-Rhône-Alpes", "01000", {"Gazole": p(1.789, "2026-11-27T08:00:00+01:00"), "E85": p("0.859", "2026-11-26T08:00:00+01:00")}, nom="Total", url="https://www.openstreetmap.org/node/1"),
                "1000002": station("Inconnu", "Inconnue", "01090", {"SP98": p(1.9, "2026-11-27T09:00:00+01:00")}, ruptures={"Gazole": {"debut": "2026-11-01"}, "E10": {"debut": "2017-01-01"}}),
                "20000001": station("Corse-du-Sud", "Corse", "20000", {"Gazole": p(2.1, "2026-11-27T09:00:00+01:00")}),
                "20200001": station("Haute-Corse", "Corse", "20200", {"Gazole": p(2.2, "2026-11-27T09:00:00+01:00")}),
            },
            "meta": {"latest_fuel_price_update_iso": "2026-11-27T09:00+01:00", "latest_fuel_price_update_label_fr": "27/11/2026 à 09:00"},
        }

    def test_payloads_are_aligned_and_compact(self):
        st, data = build_payloads(self.db, today=date(2026, 11, 28))
        self.assertEqual(len(st["s"]), data["n"])
        self.assertEqual(len(data["p"]), data["n"])
        ids = [r[0] for r in st["s"]]
        self.assertEqual(ids, ["1000001", "1000002", "20000001", "20200001"])
        depts = {d[0]: (d[1], st["regions"][d[2]]) for d in st["depts"]}
        self.assertEqual(depts["Corse-du-Sud"], ("2A", "Corse"))
        self.assertEqual(depts["Haute-Corse"], ("2B", "Corse"))
        # Departement inconnu : deduit du code postal ; region deduite du departement.
        self.assertEqual(st["depts"][st["s"][1][6]][0], "Ain")
        self.assertEqual(st["regions"][st["depts"][st["s"][1][6]][2]], "Auvergne-Rhône-Alpes")
        self.assertEqual(st["brands"][st["s"][0][1]], "Total")
        self.assertEqual(st["s"][0][2], "n1")
        # Prix : [carburant, millimes, minutes depuis t0], dans l'ordre FUELS.
        p0 = data["p"][0]
        self.assertEqual(p0[0:2], [0, 1789])
        self.assertEqual(p0[3:5], [4, 859])
        self.assertEqual(data["t0"] + p0[2], entry_minutes({"maj_iso": "2026-11-27T08:00:00+01:00"}))
        # Ruptures : seules les recentes sont publiees.
        self.assertEqual(data["r"], {"1": [0, (date(2026, 11, 1) - date(1970, 1, 1)).days]})

    def test_write_frontend_data_replaces_previous_stations_file(self):
        with TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "stations.old.json"), "w").close()
            name = write_frontend_data(self.db, tmp, today=date(2026, 11, 28))
            files = sorted(os.listdir(tmp))
            self.assertEqual(files, sorted(["data.json", name]))
            with open(os.path.join(tmp, "data.json"), encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual(data["stations"], name)
            self.assertEqual(data["updated_label"], "27/11/2026 à 09:00")
            # Nom adresse par contenu : stable si les stations ne changent pas.
            self.assertEqual(write_frontend_data(self.db, tmp, today=date(2026, 11, 28)), name)


if __name__ == "__main__":
    unittest.main()
