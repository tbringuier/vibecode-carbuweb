import glob
import html as html_lib
import json
import logging
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from .config import BASE_DIR, BUILD_DIR, TEMPLATES_DIR, DB_FILE, TODAY
from .helpers import compute_latest_fuel_price_update_meta, footer_fuel_data_update_html

log = logging.getLogger("carbuweb")


def minify_html(src):
    """Lightweight HTML minifier — collapses whitespace, strips comments."""
    src = re.sub(r"<!--.*?-->", "", src, flags=re.DOTALL)
    src = re.sub(r">\s+<", "><", src)
    src = re.sub(r"\s{2,}", " ", src)
    return src.strip()


def minify_js(src):
    """Strip JS single-line comments and collapse blank lines."""
    lines = []
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        if stripped:
            lines.append(line.rstrip())
    return "\n".join(lines)


def minify_json(path_in, path_out):
    """Re-serialize JSON without whitespace (saves ~40 %)."""
    with open(path_in, "r", encoding="utf-8") as f:
        data = json.load(f)
    with open(path_out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def _format_fr_int(n):
    """Espace fin insécable comme séparateur de milliers (usage affichage FR)."""
    s = f"{int(n):,}"
    return s.replace(",", "\u202f")


def _resolve_git_footer_placeholders():
    """SHA et URL de commit pour le pied de page (CI : GITHUB_SHA / GITHUB_REPOSITORY)."""
    sha = os.environ.get("GITHUB_SHA", "").strip()
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not sha:
        try:
            sha = subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                cwd=BASE_DIR,
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).strip()
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            sha = ""
    short = sha[:7] if len(sha) >= 7 else sha
    if not repo:
        try:
            url = subprocess.check_output(
                ["git", "remote", "get-url", "origin"],
                cwd=BASE_DIR,
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).strip()
            m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
            if m:
                repo = f"{m.group(1)}/{m.group(2)}"
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            repo = ""
    commit_url = f"https://github.com/{repo}/commit/{sha}" if repo and sha else ""
    return short, commit_url


def _git_commit_footer_html(commit_short, commit_url):
    """Fragment HTML sûr pour le pied de page (lien commit ou texte seul)."""
    label = html_lib.escape(commit_short or "—", quote=False)
    if commit_url:
        aria = html_lib.escape(
            f"Code source sur GitHub, commit {commit_short or ''} (build depuis la branche main)",
            quote=True,
        )
        return (
            f'<a href="{html_lib.escape(commit_url, quote=True)}" class="footer-git-commit" '
            f'rel="noopener noreferrer" target="_blank" aria-label="{aria}">'
            f'<code>{label}</code></a>'
        )
    return f"<code>{label}</code>"


def generate_site():
    os.makedirs(BUILD_DIR, exist_ok=True)
    build_json = os.path.join(BUILD_DIR, "data.json")

    with open(DB_FILE, "r", encoding="utf-8") as f:
        db_out = json.load(f)

    meta = db_out.get("meta") if isinstance(db_out.get("meta"), dict) else {}
    if not (meta.get("latest_fuel_price_update_iso") or "").strip():
        meta = {**meta, **compute_latest_fuel_price_update_meta(db_out)}
    db_out.setdefault("meta", {})
    db_out["meta"]["latest_fuel_price_update_iso"] = meta.get("latest_fuel_price_update_iso", "")
    db_out["meta"]["latest_fuel_price_update_label_fr"] = meta.get(
        "latest_fuel_price_update_label_fr", "—"
    )

    with open(build_json, "w", encoding="utf-8") as f:
        json.dump(db_out, f, ensure_ascii=False, separators=(",", ":"))

    # Build timestamp for cache-busting filenames
    build_ts = str(int(time.time()))

    # Timestamped asset filenames
    app_js_name = f"app.{build_ts}.js"
    icon_svg_name = f"icon.{build_ts}.svg"
    styles_css_name = f"styles.{build_ts}.css"

    # CSS — concatenate in order, minify, write.
    # Order matters: variables -> base -> layout -> feature CSS -> components -> map -> utilities.
    # Utilities last so utility classes can override earlier rules when the same specificity applies.
    CSS_ORDER = [
        "variables.css", "base.css", "layout.css", "nav.css",
        "search.css", "station.css", "explore.css", "favorites.css",
        "vehicles.css", "components.css", "map.css", "utilities.css",
    ]
    css_dir = os.path.join(TEMPLATES_DIR, "css")
    css_parts = []
    for name in CSS_ORDER:
        path = os.path.join(css_dir, name)
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                css_parts.append(f.read())
    css_combined = "\n".join(css_parts)
    # Simple CSS minification
    css_combined = re.sub(r"/\*.*?\*/", "", css_combined, flags=re.DOTALL)
    css_combined = re.sub(r"\s{2,}", " ", css_combined).strip()
    with open(os.path.join(BUILD_DIR, styles_css_name), "w", encoding="utf-8") as f:
        f.write(css_combined)

    # index.html — métadonnées de build + asset placeholders + minify
    with open(os.path.join(TEMPLATES_DIR, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    build_dt = datetime.now(ZoneInfo("Europe/Paris"))
    build_paris = build_dt.strftime("%d/%m/%Y à %H:%M")
    station_count = len(db_out.get("stations") or {})
    commit_short, commit_url = _resolve_git_footer_placeholders()
    html = html.replace("{{BUILD_DATE}}", TODAY)
    html = html.replace("{{BUILD_DATETIME_PARIS}}", build_paris)
    html = html.replace("{{BUILD_DATETIME_ISO}}", build_dt.isoformat(timespec="minutes"))
    html = html.replace("{{STATION_COUNT}}", _format_fr_int(station_count))
    html = html.replace(
        "{{FUEL_DATA_UPDATE_FOOTER_HTML}}", footer_fuel_data_update_html(db_out["meta"])
    )
    html = html.replace("{{GIT_COMMIT_HTML}}", _git_commit_footer_html(commit_short, commit_url))
    html = html.replace("{{APP_JS}}", app_js_name)
    html = html.replace("{{ICON_SVG}}", icon_svg_name)
    html = html.replace("{{STYLES_CSS}}", styles_css_name)
    with open(os.path.join(BUILD_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(minify_html(html))

    # app.js — minify with timestamped name
    with open(os.path.join(TEMPLATES_DIR, "app.js"), "r", encoding="utf-8") as f:
        js = f.read()
    with open(os.path.join(BUILD_DIR, app_js_name), "w", encoding="utf-8") as f:
        f.write(minify_js(js))

    # JS modules — minify and copy to build/js/
    js_src_dir = os.path.join(TEMPLATES_DIR, "js")
    js_build_dir = os.path.join(BUILD_DIR, "js")
    os.makedirs(js_build_dir, exist_ok=True)
    if os.path.isdir(js_src_dir):
        for js_file in sorted(os.listdir(js_src_dir)):
            if js_file.endswith(".js"):
                with open(os.path.join(js_src_dir, js_file), "r", encoding="utf-8") as f:
                    js_content = f.read()
                with open(os.path.join(js_build_dir, js_file), "w", encoding="utf-8") as f:
                    f.write(minify_js(js_content))

    # icon.svg — copy with timestamped name
    icon_src = os.path.join(TEMPLATES_DIR, "icon.svg")
    if os.path.isfile(icon_src):
        shutil.copy2(icon_src, os.path.join(BUILD_DIR, icon_svg_name))

    # Clean up old timestamped files from previous builds
    for pattern in ("app.*.js", "icon.*.svg", "styles.*.css"):
        for old in glob.glob(os.path.join(BUILD_DIR, pattern)):
            basename = os.path.basename(old)
            if basename not in (app_js_name, icon_svg_name, styles_css_name):
                os.remove(old)

    for extra in ("sw.js", "CNAME", "manifest.webmanifest"):
        src = os.path.join(TEMPLATES_DIR, extra)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(BUILD_DIR, extra))

    log.info("Static site written to %s/  (assets: %s, %s, %s)", BUILD_DIR, app_js_name, styles_css_name, icon_svg_name)
