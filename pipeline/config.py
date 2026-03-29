import os
import re
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASETS_DIR = os.path.join(BASE_DIR, "datasets")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
BUILD_DIR = os.path.join(BASE_DIR, "build")


def _resolve_build_date():
    """Date calendaire des fichiers dataset (YYYY-MM-DD).

    Sur CI, GitHub Actions définit CARBUWEB_BUILD_DATE (Europe/Paris) pour
    aligner les noms de fichiers avec la clé du cache OpenStreetMap.
    """
    raw = os.environ.get("CARBUWEB_BUILD_DATE", "").strip()
    if raw and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    return datetime.now().strftime("%Y-%m-%d")


TODAY = _resolve_build_date()

EXCEL_FILE = os.path.join(DATASETS_DIR, f"prix-carburant-{TODAY}.xlsx")
EXCEL_RT_FILE = os.path.join(DATASETS_DIR, f"prix-carburant-flux-{TODAY}.xlsx")
OSM_FILE = os.path.join(DATASETS_DIR, f"osm_mapping-{TODAY}.json")
DB_FILE = os.path.join(DATASETS_DIR, f"database-{TODAY}.json")

EXCEL_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-carburants-quotidien/exports/xlsx"
    "?lang=fr&timezone=Europe%2FParis&use_labels=true"
)

EXCEL_RT_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/exports/xlsx"
    "?lang=fr&timezone=Europe%2FParis&use_labels=true"
)

ALL_FUELS = ["Gazole", "SP95", "E10", "SP98", "E85", "GPLc"]

# Plage de prix valides (€/L). Tout prix en dehors est rejeté comme aberrant.
VALID_PRICE_MIN = 0.01
VALID_PRICE_MAX = 10.0

# Colonnes flux instantané (export XLSX data.gouv, libellés FR)
RT_FUEL_COLUMNS = (
    ("Gazole", "Prix Gazole", "Prix Gazole mis à jour le"),
    ("SP95", "Prix SP95", "Prix SP95 mis à jour le"),
    ("E10", "Prix E10", "Prix E10 mis à jour le"),
    ("SP98", "Prix SP98", "Prix SP98 mis à jour le"),
    ("E85", "Prix E85", "Prix E85 mis à jour le"),
    ("GPLc", "Prix GPLc", "Prix GPLc mis à jour le"),
)

# Instances Overpass publiques (rotation en cas de 504 / surcharge). Ordre : miroir FR puis instance principale.
# Voir https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
OVERPASS_ENDPOINTS = (
    "https://overpass.openstreetmap.fr/api/interpreter",        # Miroir FR, parfait pour tes données
    "https://overpass-api.de/api/interpreter",                  # Instance principale (fiable mais limites strictes)
)

OVERPASS_MAX_ATTEMPTS = 100

# Ton User-Agent est parfait : explicite, pointe vers le repo et donne la raison d'utilisation.
# C'est la meilleure pratique pour éviter les bannissements sur ces API publiques.
HTTP_USER_AGENT = (
    "CarbuWeb-build/1.0 (+https://github.com/tbringuier/vibecode-carburant; "
    "dataset enrichment ref:FR:prix-carburants)"
)
