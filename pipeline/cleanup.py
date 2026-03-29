import glob
import os

from .config import DATASETS_DIR, TODAY


def cleanup_old_files():
    """Remove dataset files from previous days."""
    os.makedirs(DATASETS_DIR, exist_ok=True)
    for path in glob.glob(os.path.join(DATASETS_DIR, "*")):
        if TODAY not in os.path.basename(path):
            try:
                os.remove(path)
            except OSError:
                pass
