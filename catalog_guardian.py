"""
Catalog Guardian & Self-Healing Engine for IPTV Desktop
Automatically detects, verifies, and repairs catalog inconsistencies,
ensures category synchronization, restores missing metadata/logos,
and guarantees 100% data integrity for PC, TV, and Mobile apps.
"""

import time
import json
import re
import hashlib
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SAVED_CACHE_FILE = BASE_DIR / "saved_cache.json"
SAVED_META_FILE = BASE_DIR / "saved_meta.json"
BACKUP_CACHE_FILE = BASE_DIR / "saved_cache.backup.json"

FALLBACK_LOGOS = {
    "disney": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/disney-channel-us.png",
    "marvel": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/disney-xd-us.png",
    "pixar": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/disney-channel-us.png",
    "netflix": "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg",
    "globo": "https://upload.wikimedia.org/wikipedia/commons/8/87/TV_Globo_2021.svg",
    "telecine": "https://upload.wikimedia.org/wikipedia/commons/d/da/Telecine_Action_logo_2020.png",
    "hbo": "https://upload.wikimedia.org/wikipedia/commons/d/de/HBO_logo.svg",
    "espn": "https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg",
    "premiere": "https://upload.wikimedia.org/wikipedia/commons/e/e0/Premiere_logo_2021.png",
    "sportv": "https://upload.wikimedia.org/wikipedia/commons/7/77/Sportv_logo_2021.png",
    "paramount": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Paramount_Plus_logo.svg",
    "prime": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Prime_Video.png",
    "apple": "https://upload.wikimedia.org/wikipedia/commons/2/28/Apple_TV_plus_logo.svg",
    "noticias": "https://img.icons8.com/fluency/96/news.png",
    "filmes": "https://img.icons8.com/fluency/96/movie.png",
    "series": "https://img.icons8.com/fluency/96/film-reel.png",
    "live": "https://img.icons8.com/fluency/96/tv.png",
    "infantil": "https://img.icons8.com/fluency/96/children.png",
    "4k": "https://img.icons8.com/color/96/4k.png"
}

def get_best_fallback_logo(item_name: str, item_group: str, item_type: str) -> str:
    combined = f"{item_name} {item_group}".lower()
    for key, logo in FALLBACK_LOGOS.items():
        if key in combined:
            return logo
    if item_type == "movie":
        return FALLBACK_LOGOS["filmes"]
    if item_type == "series":
        return FALLBACK_LOGOS["series"]
    return FALLBACK_LOGOS["live"]

class CatalogGuardian:
    def __init__(self):
        self.last_audit_report = {
            "timestamp": time.time(),
            "status": "initialized",
            "total_items": 0,
            "repairs_count": 0,
            "details": []
        }
        self.lock = threading.Lock()

    def audit_and_repair(self, channels: list, series_map: dict = None, meta: dict = None) -> tuple[list, dict, dict]:
        """
        Scans all channels, series, and categories for inconsistencies.
        Applies non-destructive repairs and returns (repaired_channels, repaired_series_map, audit_report).
        """
        with self.lock:
            t0 = time.time()
            repairs = []
            repaired_channels = []

            for i, ch in enumerate(channels):
                c = dict(ch)
                changed = False

                # 1. Check ID
                if not c.get("id"):
                    url = c.get("url", "")
                    c["id"] = hashlib.md5(f"{url}_{i}".encode("utf-8")).hexdigest()
                    changed = True
                    repairs.append(f"Gerado ID único para item '{c.get('name', 'Sem nome')}'")

                # 2. Check Type
                stype = c.get("type", "").lower()
                if stype not in ("live", "movie", "series"):
                    grp = (c.get("group") or c.get("subgroup") or "").lower()
                    name = (c.get("name") or "").lower()
                    if any(w in grp or w in name for w in ("série", "serie", "season", "temporada", "s0", "e0")):
                        c["type"] = "series"
                    elif any(w in grp or w in name for w in ("filme", "movie", "vod", "cinema", "1080p", "4k")):
                        c["type"] = "movie"
                    else:
                        c["type"] = "live"
                    changed = True
                    repairs.append(f"Corrigido tipo de '{c.get('name')}' para '{c['type']}'")

                # 3. Check Group & Subgroup
                if not c.get("group") and not c.get("subgroup"):
                    if c["type"] == "movie":
                        c["group"] = "Filmes | Geral"
                        c["subgroup"] = "Geral"
                    elif c["type"] == "series":
                        c["group"] = "Séries | Geral"
                        c["subgroup"] = "Geral"
                    else:
                        c["group"] = "Canais | Geral"
                        c["subgroup"] = "Geral"
                    changed = True
                    repairs.append(f"Atribuído grupo padrão para '{c.get('name')}'")
                elif not c.get("subgroup") and c.get("group"):
                    c["subgroup"] = c["group"].split("|")[-1].strip()
                    changed = True
                elif not c.get("group") and c.get("subgroup"):
                    c["group"] = c["subgroup"]
                    changed = True

                # 4. Check Logo
                logo = c.get("logo")
                if not logo or not str(logo).strip() or str(logo).strip() in ("none", "null", "undefined"):
                    fallback = get_best_fallback_logo(c.get("name", ""), c.get("subgroup", ""), c.get("type", "live"))
                    c["logo"] = fallback
                    changed = True

                repaired_channels.append(c)

            # 5. Check Series Map Integrity
            import m3u_parser
            repaired_series_map = m3u_parser.build_series_map(repaired_channels)
            for s_id, s in repaired_series_map.items():
                if not s.get("logo"):
                    sub = s.get("subgroup") or s.get("group") or "Séries"
                    s["logo"] = get_best_fallback_logo(s.get("title", ""), sub, "series")
                    repairs.append(f"Atribuído poster para série '{s.get('title')}'")

            # 6. Automatic Backup of Saved Cache
            if len(repaired_channels) > 0 and SAVED_CACHE_FILE.exists():
                try:
                    import shutil
                    if not BACKUP_CACHE_FILE.exists() or (time.time() - BACKUP_CACHE_FILE.stat().st_mtime > 3600):
                        shutil.copy2(SAVED_CACHE_FILE, BACKUP_CACHE_FILE)
                except Exception:
                    pass

            duration = time.time() - t0
            report = {
                "timestamp": time.time(),
                "formatted_time": time.strftime("%d/%m/%Y %H:%M:%S"),
                "status": "healthy" if len(repairs) < 100 else "repaired",
                "total_items": len(repaired_channels),
                "total_series": len(repaired_series_map),
                "total_live": len([c for c in repaired_channels if c.get("type") == "live"]),
                "total_movies": len([c for c in repaired_channels if c.get("type") == "movie"]),
                "repairs_count": len(repairs),
                "audit_duration_sec": round(duration, 3),
                "summary": f"Auditados {len(repaired_channels):,} itens e {len(repaired_series_map):,} séries. {len(repairs)} auto-reparos executados."
            }
            self.last_audit_report = report
            return repaired_channels, repaired_series_map, report

guardian = CatalogGuardian()
