import glob
import os

from .config import DATASETS_DIR, TODAY


def previous_osm_mappings():
    """Mappings OSM des jours precedents, du plus recent au plus ancien."""
    paths = glob.glob(os.path.join(DATASETS_DIR, "osm_mapping-*.json"))
    return sorted((p for p in paths if TODAY not in os.path.basename(p)), reverse=True)


def cleanup_old_files():
    """Remove dataset files from previous days.

    Exception : le mapping OSM le plus recent des jours precedents est conserve
    comme secours si Overpass est injoignable (voir resolve_osm_mapping).
    """
    os.makedirs(DATASETS_DIR, exist_ok=True)
    keep = set(previous_osm_mappings()[:1])
    for path in glob.glob(os.path.join(DATASETS_DIR, "*")):
        if TODAY not in os.path.basename(path) and path not in keep:
            try:
                os.remove(path)
            except OSError:
                pass
