import re

ADULT_GROUP_PATTERNS = re.compile(
    r"(\badult[oa]s?\b|\bhentai\b|\bporn[oa]?\b|\ber[oó]tic[oa]s?\b|\bsex\s*priv[eé]\b|\bsexy\s*hot\b|\bplayboy\b|\bvenus\b|\bfor\s*man\b|\bredlight\b|\bbrazzers\b|\bxxx\b|\bhustler\b|\bpenthouse\b|\bdorcel\b)",
    re.IGNORECASE
)
LIVE_PORN_CHANNELS = re.compile(
    r"(\bplayboy\s*tv\b|\bsexy\s*hot\b|\bsex\s*priv[eé]\b|\bvenus\s*(hd|fhd|tv)?\b|\bhustler\s*tv\b|\bsextreme\b|\bbrazzers\s*tv\b|\bdorcel\s*tv\b|\bredlight\b|\bprivate\s*tv\b|\bmanpack\b|\bpornbox\b)",
    re.IGNORECASE
)

def is_adult_porn(item):
    grp = (item.get("subgroup") or item.get("group") or "").strip()
    name = (item.get("name") or item.get("title") or "").strip()
    stype = item.get("type", "live")
    if ADULT_GROUP_PATTERNS.search(grp):
        return True
    if stype == "live" and LIVE_PORN_CHANNELS.search(name):
        return True
    return False

"""
M3U / M3U8 Playlist Parser and Smart Categorizer
High-performance parser with intelligent classification into:
- 📺 Live TV (Canais ao Vivo)
- 🎬 Movies (Filmes VOD)
- 🍿 Series (Séries)
With automatic grouping of Series into Seasons and Episodes,
and subcategory extraction (Esportes, Terror, Animação, Notícias, etc.).
"""

import re
import urllib.request
import urllib.error
import ssl
import gzip
import zlib
from collections import defaultdict

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

ATTR_REGEX = re.compile(r'([a-zA-Z0-9_\-]+)=(?:"([^"]*)"|\'([^\']*)\'|([^\s,]+))')

SEASON_EP_REGEX = re.compile(
    r'^(.*?)\s*(?:[-–|:]\s*)?(?:[sS](\d{1,2})|[tT](\d{1,2})|temporada\s*(\d{1,2}))\s*(?:[eE](\d{1,3})|ep\.?\s*(\d{1,3})|cap\.?\s*(\d{1,3})|epis[oó]dio\s*(\d{1,3}))\s*(?:[-–:]\s*(.*))?$',
    re.IGNORECASE
)

def decompress_data(raw_data: bytes) -> bytes:
    """Decompresses raw data if it is gzipped or zlib-compressed."""
    if raw_data.startswith(b"\x1f\x8b"):
        try:
            return gzip.decompress(raw_data)
        except Exception:
            pass
    try:
        return zlib.decompress(raw_data)
    except Exception:
        pass
    return raw_data

def clean_subcategory_name(raw_group: str, stream_type: str = "") -> str:
    """Cleans up prefixes and symbols from category names."""
    cleaned = re.sub(r'^(?:CANAIS|FILMES|SERIES|SÉRIES|VOD|BR|BRASIL|TV|IPTV)\s*[\-:|/•]\s*', '', raw_group, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r'^\[[^\]]+\]\s*', '', cleaned).strip()
    cleaned = re.sub(r'^[•\-|*]\s*', '', cleaned).strip()
    return cleaned if cleaned else raw_group

def classify_channel_type(group_title: str, name: str, url: str):
    """
    Intelligently classifies a stream into 'live', 'movie', or 'series'.
    Prioritizes specific Xtream path patterns and group prefixes.
    """
    g_lower = group_title.lower().strip()
    u_lower = url.lower().strip()

    # 1. URL path patterns
    if "/series/" in u_lower:
        return "series", clean_subcategory_name(group_title, "series")
    if "/movie/" in u_lower:
        return "movie", clean_subcategory_name(group_title, "movie")
    if "/live/" in u_lower:
        return "live", clean_subcategory_name(group_title, "live")

    # 2. Group prefixes
    if g_lower.startswith(("séries", "series", "série", "serie", "[séries]", "[series]")):
        return "series", clean_subcategory_name(group_title, "series")
    if g_lower.startswith(("filmes", "filme", "movies", "movie", "vod", "[filmes]", "[movies]")):
        return "movie", clean_subcategory_name(group_title, "movie")
    if g_lower.startswith(("canais", "canal", "tv", "ao vivo", "live", "24h", "24 horas", "[canais]", "[tv]")):
        return "live", clean_subcategory_name(group_title, "live")

    # 3. Group delimiters
    if "séries |" in g_lower or "series |" in g_lower or "séries/" in g_lower or "series/" in g_lower:
        return "series", clean_subcategory_name(group_title, "series")
    if "filmes |" in g_lower or "filme |" in g_lower or "filmes/" in g_lower or "filme/" in g_lower:
        return "movie", clean_subcategory_name(group_title, "movie")
    if "canais |" in g_lower or "canal |" in g_lower or "canais/" in g_lower:
        return "live", clean_subcategory_name(group_title, "live")

    # 4. Season / Episode regex
    if re.search(r'\b[sS]\d{1,2}\s*[eE]\d{1,2}\b', name) or re.search(r'\b[tT]\d{1,2}\s*[eE]\d{1,2}\b', name):
        return "series", clean_subcategory_name(group_title, "series")

    # 5. Keywords in group
    for kw in ["novela", "novelas", "dorama", "doramas", "anime", "animes"]:
        if kw in g_lower:
            return "series", clean_subcategory_name(group_title, "series")

    # 6. File extensions
    if u_lower.endswith((".mp4", ".mkv", ".avi")):
        return "movie", clean_subcategory_name(group_title, "movie")

    return "live", clean_subcategory_name(group_title, "live")

def split_channel_line(inf_content: str):
    """Splits an EXTINF line into attributes and channel title."""
    in_quotes = False
    quote_char = None
    comma_idx = -1

    for i, ch in enumerate(inf_content):
        if ch in ('"', "'"):
            if not in_quotes:
                in_quotes = True
                quote_char = ch
            elif ch == quote_char:
                in_quotes = False
                quote_char = None
        elif ch == ',' and not in_quotes:
            comma_idx = i
            break

    if comma_idx != -1:
        attrs_part = inf_content[:comma_idx].strip()
        name_part = inf_content[comma_idx + 1:].strip()
    else:
        attrs_part = inf_content.strip()
        name_part = ""

    return attrs_part, name_part

def parse_m3u_content(content: str) -> list:
    """Parses raw M3U / M3U8 string content and returns an optimized list of items."""
    channels = []
    current_channel = None
    channel_index = 1

    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue

        if line.startswith("#EXTINF:"):
            inf_content = line[8:]
            attrs_part, name_part = split_channel_line(inf_content)

            attrs = {}
            for match in ATTR_REGEX.finditer(attrs_part):
                key = match.group(1).lower()
                val = match.group(2) or match.group(3) or match.group(4) or ""
                attrs[key] = val

            tvg_id = attrs.get("tvg-id", "")
            tvg_name = attrs.get("tvg-name", "")
            tvg_logo = attrs.get("tvg-logo", "")
            raw_group = attrs.get("group-title", "Geral").strip() or "Geral"

            final_name = name_part or tvg_name or f"Canal {channel_index}"

            current_channel = {
                "id": str(channel_index),
                "name": final_name,
                "logo": tvg_logo,
                "group": raw_group,
                "subgroup": raw_group,
                "type": "live",
                "tvg_id": tvg_id,
                "url": ""
            }
        elif not line.startswith("#") and current_channel:
            raw_url = line
            stream_type, clean_sub = classify_channel_type(
                current_channel["group"], 
                current_channel["name"], 
                raw_url
            )
            current_channel["type"] = stream_type
            current_channel["subgroup"] = clean_sub
            current_channel["url"] = raw_url

            channels.append(current_channel)
            channel_index += 1
            current_channel = None

    return channels

def parse_m3u_file(filepath: str) -> list:
    """Loads and parses a local M3U file."""
    with open(filepath, "rb") as f:
        raw_data = f.read()

    decompressed = decompress_data(raw_data)

    for encoding in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            content = decompressed.decode(encoding)
            return parse_m3u_content(content)
        except UnicodeDecodeError:
            continue

    return parse_m3u_content(decompressed.decode("utf-8", errors="ignore"))

def extract_xtream_credentials(url: str):
    """Extrai (base_url, username, password) de URLs Xtream padrao ou curtas (/ts/user/pass)."""
    if not url:
        return None
    u = url.strip()
    m_q = re.search(r'^(https?://[^/?#]+).*?[?&]username=([^&#]+).*?[?&]password=([^&#]+)', u, re.IGNORECASE)
    if m_q:
        return m_q.group(1), m_q.group(2), m_q.group(3)
    m_p = re.search(r'^(https?://[^/?#]+)/(?:ts|m3u|m3u8|hls|plus|live)/([^/?#]+)/([^/?#]+)', u, re.IGNORECASE)
    if m_p:
        return m_p.group(1), m_p.group(2), m_p.group(3)
    m_d = re.search(r'^(https?://[^/?#]+)/([a-zA-Z0-9_.\-]+)/([a-zA-Z0-9_.\-]+)$', u)
    if m_d and not m_d.group(2).endswith(('.m3u', '.m3u8', '.php', '.ts')):
        return m_d.group(1), m_d.group(2), m_d.group(3)
    return None


def fetch_xtream_api_channels(base_url: str, username: str, password: str, timeout: int = 25) -> list:
    """Busca Canais ao Vivo, Filmes e Series diretamente via Xtream Player API."""
    import json
    headers = {
        "User-Agent": "IPTVSmarters/1.0.0 (Linux; Android 10; SM-G988B)",
        "Accept": "application/json, */*"
    }

    def get_json(action: str):
        api_u = f"{base_url}/player_api.php?username={username}&password={password}&action={action}"
        req = urllib.request.Request(api_u, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            raw = decompress_data(resp.read())
            return json.loads(raw.decode("utf-8", errors="ignore"))

    channels = []
    idx = 1
    try:
        cat_names = {}
        for c_act in ("get_live_categories", "get_vod_categories", "get_series_categories"):
            try:
                cats = get_json(c_act)
                if isinstance(cats, list):
                    for c in cats:
                        cid = str(c.get("category_id", ""))
                        cname = str(c.get("category_name", "Geral")).strip()
                        if cid and cname:
                            cat_names[f"{c_act}_{cid}"] = cname
            except Exception:
                pass

        try:
            lives = get_json("get_live_streams")
            if isinstance(lives, list):
                for item in lives:
                    sid = item.get("stream_id")
                    if not sid:
                        continue
                    cid = str(item.get("category_id", ""))
                    grp = cat_names.get(f"get_live_categories_{cid}", "Canais ao Vivo")
                    name = str(item.get("name") or f"Canal {idx}").strip()
                    logo = str(item.get("stream_icon") or "").strip()
                    stream_u = f"{base_url}/live/{username}/{password}/{sid}.ts"
                    channels.append({
                        "id": str(sid),
                        "name": name,
                        "logo": logo,
                        "group": grp,
                        "subgroup": clean_subcategory_name(grp, "live"),
                        "type": "live",
                        "tvg_id": str(item.get("epg_channel_id") or ""),
                        "url": stream_u
                    })
                    idx += 1
        except Exception:
            pass

        try:
            vods = get_json("get_vod_streams")
            if isinstance(vods, list):
                for item in vods:
                    sid = item.get("stream_id")
                    if not sid:
                        continue
                    cid = str(item.get("category_id", ""))
                    grp = cat_names.get(f"get_vod_categories_{cid}", "Filmes")
                    name = str(item.get("name") or f"Filme {idx}").strip()
                    logo = str(item.get("stream_icon") or item.get("cover") or "").strip()
                    ext = str(item.get("container_extension") or "mp4").strip()
                    stream_u = f"{base_url}/movie/{username}/{password}/{sid}.{ext}"
                    channels.append({
                        "id": str(sid),
                        "name": name,
                        "logo": logo,
                        "group": grp,
                        "subgroup": clean_subcategory_name(grp, "movie"),
                        "type": "movie",
                        "tvg_id": "",
                        "url": stream_u
                    })
                    idx += 1
        except Exception:
            pass

        try:
            series_list = get_json("get_series")
            if isinstance(series_list, list):
                for item in series_list:
                    sid = item.get("series_id")
                    if not sid:
                        continue
                    cid = str(item.get("category_id", ""))
                    grp = cat_names.get(f"get_series_categories_{cid}", "Séries")
                    name = str(item.get("name") or f"Série {idx}").strip()
                    logo = str(item.get("cover") or "").strip()
                    stream_u = f"{base_url}/series/{username}/{password}/{sid}.mp4"
                    channels.append({
                        "id": str(sid),
                        "series_id": str(sid),
                        "name": f"{name} S01E01",
                        "logo": logo,
                        "group": grp,
                        "subgroup": clean_subcategory_name(grp, "series"),
                        "type": "series",
                        "tvg_id": "",
                        "url": stream_u
                    })
                    idx += 1
        except Exception:
            pass
    except Exception as e:
        print(f"[Xtream API Fallback Notice] {e}")

    return channels


def parse_m3u_url(url: str, timeout: int = 60) -> list:
    """Downloads and parses an M3U playlist or Xtream link from a remote URL."""
    headers = {
        "User-Agent": "IPTVSmarters/1.0.0 (Linux; Android 10; SM-G988B)",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive"
    }

    creds = extract_xtream_credentials(url)
    if "player_api.php" in url.lower() and creds:
        ch_api = fetch_xtream_api_channels(creds[0], creds[1], creds[2], timeout=min(timeout, 30))
        if ch_api:
            return ch_api

    raw_data = None
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as response:
            raw_data = response.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            try:
                headers["User-Agent"] = "VLC/3.0.18 LibVLC/3.0.18"
                req2 = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req2, timeout=timeout, context=SSL_CONTEXT) as response2:
                    raw_data = response2.read()
            except Exception:
                pass
        elif not creds:
            raise e
    except Exception as e:
        if not creds:
            raise e

    channels = []
    if raw_data:
        decompressed = decompress_data(raw_data)
        for encoding in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
            try:
                content = decompressed.decode(encoding)
                channels = parse_m3u_content(content)
                break
            except UnicodeDecodeError:
                continue
        if not channels:
            channels = parse_m3u_content(decompressed.decode("utf-8", errors="ignore"))

    if not channels and creds:
        channels = fetch_xtream_api_channels(creds[0], creds[1], creds[2], timeout=min(timeout, 30))

    return channels

def get_grouped_categories(channels: list, series_map: dict = None) -> dict:
    """Returns counts by main section ('live', 'movie', 'series') and subcategories under each."""
    counts = {
        "live": {"total": 0, "subgroups": {}},
        "movie": {"total": 0, "subgroups": {}},
        "series": {"total": 0, "subgroups": {}}
    }

    for ch in channels:
        if is_adult_porn(ch):
            continue
        stype = ch.get("type", "live")
        if stype not in counts:
            stype = "live"

        counts[stype]["total"] += 1
        sub = ch.get("subgroup") or ch.get("group") or "Geral"
        sub_counts = counts[stype]["subgroups"]
        sub_counts[sub] = sub_counts.get(sub, 0) + 1

    # Harmonização de Séries: Se series_map estiver disponível, calcula contagens por TÍTULOS de séries (não episódios brutos)
    if series_map:
        series_sub_counts = {}
        for s in series_map.values():
            sub = s.get("subgroup") or s.get("group") or "Séries"
            clean_sub = clean_subcategory_name(sub, "series") or sub
            series_sub_counts[clean_sub] = series_sub_counts.get(clean_sub, 0) + 1
        series_total = len(series_map)
        series_subgroups = [{"name": "Todos", "count": series_total}] + [
            {"name": k, "count": v} for k, v in sorted(series_sub_counts.items())
        ]
    else:
        series_total = counts["series"]["total"]
        series_subgroups = [{"name": "Todos", "count": series_total}] + [
            {"name": k, "count": v} for k, v in sorted(counts["series"]["subgroups"].items())
        ]

    result = {
        "live": {
            "total": counts["live"]["total"],
            "subgroups": [{"name": "Todos", "count": counts["live"]["total"]}] + [
                {"name": k, "count": v} for k, v in sorted(counts["live"]["subgroups"].items())
            ]
        },
        "movie": {
            "total": counts["movie"]["total"],
            "subgroups": [{"name": "Todos", "count": counts["movie"]["total"]}] + [
                {"name": k, "count": v} for k, v in sorted(counts["movie"]["subgroups"].items())
            ]
        },
        "series": {
            "total": series_total,
            "subgroups": series_subgroups
        }
    }
    return result

def normalize_text(s: str) -> str:
    """Normalizes string removing accents, special characters, and lowercase for robust matching."""
    if not s:
        return ""
    import unicodedata
    norm = unicodedata.normalize('NFKD', str(s)).encode('ASCII', 'ignore').decode('ASCII').lower()
    return re.sub(r'[^a-z0-9]', '', norm)

def filter_channels(channels: list, stream_type: str = None, subgroup: str = None, search: str = None) -> list:
    """Filters channel list by stream type, subcategory and search keyword with accent-insensitive matching."""
    result = channels
    if stream_type and stream_type in ("live", "movie", "series"):
        result = [ch for ch in result if ch.get("type") == stream_type]

    if subgroup and subgroup != "Todos":
        sub_norm = normalize_text(subgroup)
        sub_lower = subgroup.lower().strip()
        is_disney_query = any(w in sub_lower for w in ["disney", "marvel"])
        result = [
            ch for ch in result
            if (ch.get("subgroup") == subgroup or ch.get("group") == subgroup or
                (ch.get("subgroup") and ch.get("subgroup").lower().strip() == sub_lower) or
                (ch.get("group") and ch.get("group").lower().strip() == sub_lower) or
                (is_disney_query and any(w in (ch.get("group", "") + " " + ch.get("subgroup", "")).lower() for w in ["disney", "marvel"])) or
                (sub_norm and (normalize_text(ch.get("subgroup", "")) == sub_norm or
                               normalize_text(ch.get("group", "")) == sub_norm or
                               sub_norm in normalize_text(ch.get("subgroup", "")) or
                               sub_norm in normalize_text(ch.get("group", "")))))
        ]

    if search:
        search_norm = normalize_text(search)
        search_lower = search.lower().strip()
        result = [
            ch for ch in result
            if search_lower in ch.get("name", "").lower() or 
               search_lower in ch.get("subgroup", "").lower() or
               search_lower in ch.get("group", "").lower() or
               (search_norm and search_norm in normalize_text(ch.get("name", "")))
        ]
    return result

# --------------------------------------------------------------------------
# Series Grouping Engine (Series -> Seasons -> Episodes)
# --------------------------------------------------------------------------
def build_series_map(channels: list) -> dict:
    """
    Groups individual series episode items into high-level Series objects
    with seasons and sorted episodes. Uses deterministic MD5 series IDs.
    """
    import hashlib
    series_items = [ch for ch in channels if ch.get("type") == "series"]
    series_map = {}

    for ch in series_items:
        name = ch.get("name", "").strip()
        m = SEASON_EP_REGEX.match(name)
        if m:
            series_title = m.group(1).strip()
            season_num = int(m.group(2) or m.group(3) or m.group(4) or 1)
            ep_num = int(m.group(5) or m.group(6) or m.group(7) or m.group(8) or 1)
            ep_title = (m.group(9) or f"Episódio {ep_num}").strip()
        else:
            series_title = name
            season_num = 1
            ep_num = 1
            ep_title = name

        if series_title not in series_map:
            stable_id = str(int(hashlib.md5(series_title.encode("utf-8", "ignore")).hexdigest()[:12], 16))
            raw_sub = ch.get("subgroup") or ch.get("group") or "Geral"
            clean_sub = clean_subcategory_name(raw_sub, "series")
            series_map[series_title] = {
                "id": stable_id,
                "title": series_title,
                "group": ch.get("group", "Séries"),
                "subgroup": clean_sub,
                "logo": ch.get("logo", ""),
                "seasons": defaultdict(list)
            }

        # Keep a logo if available
        if not series_map[series_title]["logo"] and ch.get("logo"):
            series_map[series_title]["logo"] = ch.get("logo")

        series_map[series_title]["seasons"][season_num].append({
            "episode": ep_num,
            "title": ep_title,
            "url": ch.get("url"),
            "name": ch.get("name"),
            "logo": ch.get("logo", "")
        })

    # Sort episodes within seasons
    for s_title, s_obj in series_map.items():
        s_obj["seasons_count"] = len(s_obj["seasons"])
        total_eps = 0
        for season_num in s_obj["seasons"]:
            s_obj["seasons"][season_num].sort(key=lambda x: x["episode"])
            total_eps += len(s_obj["seasons"][season_num])
        s_obj["episodes_count"] = total_eps

    return series_map

def filter_series_list(series_map: dict, subgroup: str = None, search: str = None) -> list:
    """Returns a filtered list of series summaries with accent-insensitive matching and Disney aliases."""
    result = []
    sub_norm = normalize_text(subgroup) if (subgroup and subgroup != "Todos") else None
    sub_lower = subgroup.lower().strip() if (subgroup and subgroup != "Todos") else None
    is_disney_query = any(w in (sub_lower or "") for w in ["disney", "marvel"])
    search_norm = normalize_text(search) if search else None
    search_lower = search.lower().strip() if search else None

    for s_title, s_data in series_map.items():
        if sub_norm:
            grp = s_data.get("group", "")
            subg = s_data.get("subgroup", "")
            match_sub = (grp == subgroup or subg == subgroup or
                         grp.lower().strip() == sub_lower or subg.lower().strip() == sub_lower or
                         (is_disney_query and any(w in (grp + " " + subg).lower() for w in ["disney", "marvel"])) or
                         normalize_text(grp) == sub_norm or normalize_text(subg) == sub_norm or
                         sub_norm in normalize_text(grp) or sub_norm in normalize_text(subg))
            if not match_sub:
                continue

        if search_lower:
            match_search = (search_lower in s_title.lower() or 
                            search_lower in s_data.get("subgroup", "").lower() or
                            search_lower in s_data.get("group", "").lower() or
                            (search_norm and (search_norm in normalize_text(s_title) or search_norm in normalize_text(s_data.get("subgroup", "")))))
            if not match_search:
                continue

        result.append({
            "id": s_data["id"],
            "title": s_data["title"],
            "group": s_data["group"],
            "subgroup": s_data["subgroup"],
            "logo": s_data["logo"],
            "seasons_count": s_data["seasons_count"],
            "episodes_count": s_data["episodes_count"]
        })

    # Sort alphabetically by title
    result.sort(key=lambda x: x["title"].lower())
    return result
