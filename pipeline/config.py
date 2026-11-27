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

# Plages de prix réalistes par carburant (€/L), dérivées des prix réels observés
# en France 2025-2026 avec marge de sécurité confortable. Un prix hors de cette
# plage est considéré comme aberrant et déplacé dans `carburants_filtres`.
FUEL_PRICE_RANGES = {
    "Gazole": (0.80, 3.50),
    "SP95":   (0.80, 3.50),
    "E10":    (0.80, 3.50),
    "SP98":   (0.80, 3.50),
    "E85":    (0.35, 2.50),
    "GPLc":   (0.30, 3.00),
}

# Seuil absolu d'ancienneté côté pipeline : un prix mis à jour il y a plus de
# ce nombre de jours est considéré comme "donnée fantôme" et filtré
# définitivement. Le filtrage fin (14j / 30j / 60j) est géré côté frontend
# pour permettre un toggle utilisateur instantané.
PRICE_ABSURD_AGE_DAYS = 365

# Colonnes flux instantané (export XLSX data.gouv, libellés FR)
RT_FUEL_COLUMNS = (
    ("Gazole", "Prix Gazole", "Prix Gazole mis à jour le"),
    ("SP95", "Prix SP95", "Prix SP95 mis à jour le"),
    ("E10", "Prix E10", "Prix E10 mis à jour le"),
    ("SP98", "Prix SP98", "Prix SP98 mis à jour le"),
    ("E85", "Prix E85", "Prix E85 mis à jour le"),
    ("GPLc", "Prix GPLc", "Prix GPLc mis à jour le"),
)

# Instances Overpass publiques, essayees en rotation (504 / surcharge / reseau).
# overpass.openstreetmap.fr est retire : il repond 403 systematiquement aux runners GitHub Actions.
# Voir https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",                      # Instance principale
    "https://overpass.private.coffee/api/interpreter",              # Instance publique sans limite stricte
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",      # Instance VK Maps
)

# Nombre total de tentatives (toutes instances confondues). En cas d'echec complet,
# le pipeline retombe sur le dernier mapping OSM connu (voir resolve_osm_mapping).
OVERPASS_MAX_ATTEMPTS = 12

# User-Agent explicite (repo + finalité) : requis par les politiques d'usage des API publiques.
HTTP_USER_AGENT = (
    "CarbuWeb-build/1.0 (+https://github.com/tbringuier/vibecode-carburant; "
    "dataset enrichment ref:FR:prix-carburants)"
)

DOWNLOAD_CACHE_BUSTER_PARAM = "_cb"

# ---------------------------------------------------------------------------
# Historique des prix (stockage durable sur la branche git `history`)
# ---------------------------------------------------------------------------


def _resolve_history_dir():
    """Dossier du depot d'historique (checkout de la branche `history` en CI)."""
    raw = os.environ.get("CARBUWEB_HISTORY_DIR", "").strip()
    if not raw:
        return os.path.join(BASE_DIR, ".history")
    return raw if os.path.isabs(raw) else os.path.join(BASE_DIR, raw)


HISTORY_DIR = _resolve_history_dir()
# CARBUWEB_HISTORY=0 desactive la phase historique (builds locaux rapides).
HISTORY_ENABLED = os.environ.get("CARBUWEB_HISTORY", "1").strip().lower() not in ("0", "off", "false", "no")
HISTORY_SCHEMA = 1
# Sous-dossier de build/ ou l'historique est publie (servi par GitHub Pages).
HISTORY_BUILD_DIRNAME = "history"

# Archives annuelles officielles : tous les changements de prix de l'annee, une par an
# depuis 2007. Le fichier de l'annee en cours est regenere chaque nuit (cumul depuis le 1er janvier).
HISTORY_ANNUAL_URL = "https://donnees.roulez-eco.fr/opendata/annee/{year}"
HISTORY_FIRST_YEAR = 2007
# Annees passees importees par build (import retroactif progressif, de la plus recente a la plus ancienne).
HISTORY_BACKFILL_PER_RUN = max(0, int(os.environ.get("CARBUWEB_HISTORY_BACKFILL", "2") or 0))
# Une annee dont l'import echoue autant de fois n'est plus retentee automatiquement.
HISTORY_MAX_YEAR_FAILURES = 3

# Un releve reste valable au plus HISTORY_TTL_DAYS jours sans nouvelle observation
# (au-dela : trou dans la courbe). Un prix inchange mais reconfirme est re-enregistre
# apres HISTORY_KEEPALIVE_DAYS jours pour garder la courbe continue (KEEPALIVE < TTL).
HISTORY_TTL_DAYS = 45
HISTORY_KEEPALIVE_DAYS = 30

# Garde-fou anti-perte : refuser d'ecrire si le nombre de releves chute de plus de 1 %.
HISTORY_MAX_RECORD_DROP = 0.01

HTTP_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, max-age=0",
    "Pragma": "no-cache",
}
