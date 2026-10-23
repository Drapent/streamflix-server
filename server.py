"""
Local HTTP Server and REST API for IPTV Desktop
Provides persistent playlist storage, instant startup caching,
smart categorization (Live TV / Movies / Series),
dedicated Series -> Seasons -> Episodes grouping, and high-speed streaming.
"""

import http.server
import socketserver
import json
import os
import time
import urllib.parse
import urllib.request
import re
import shutil
import hashlib
import threading
from datetime import datetime, timedelta
from pathlib import Path

import m3u_parser
import stream_proxy
import sync_hub
from catalog_guardian import guardian

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOADS_META_FILE = BASE_DIR / "downloads.json"
FAVORITES_FILE = BASE_DIR / "favorites.json"
DEFAULT_PLAYLIST_FILE = BASE_DIR / "default_playlist.m3u"
SAVED_CACHE_FILE = BASE_DIR / "saved_cache.json"
SAVED_META_FILE = BASE_DIR / "saved_meta.json"
SAVED_M3U_FILE = BASE_DIR / "saved_playlist.m3u"

CURRENT_CHANNELS = []
CURRENT_PLAYLIST_NAME = "Canais Padrão (Demonstração)"
CURRENT_PLAYLIST_META = {}
CURRENT_SERIES_MAP = {}
CURRENT_GROUPED_CATEGORIES = {}
CURRENT_CATALOG_VERSION = int(time.time())
TV_PAIR_SESSIONS = {}


# ==============================================================================
# FILTRO DE PROTEÇÃO FAMILIAR (REMOÇÃO DE CONTEÚDO PORNÔ / +18 EXPLÍCITO)
# ==============================================================================
ADULT_GROUP_PATTERNS = re.compile(
    r"(\badult[oa]s?\b|\bhentai\b|\bporn[oa]?\b|\ber[oó]tic[oa]s?\b|\bsex\s*priv[eé]\b|\bsexy\s*hot\b|\bplayboy\b|\bvenus\b|\bfor\s*man\b|\bredlight\b|\bbrazzers\b|\bxxx\b|\bhustler\b|\bpenthouse\b|\bdorcel\b)",
    re.IGNORECASE
)
LIVE_PORN_CHANNELS = re.compile(
    r'(\bplayboy\s*tv\b|\bsexy\s*hot\b|\bsex\s*priv[eé]\b|\bvenus\s*(hd|fhd|tv)?\b|\bhustler\s*tv\b|\bsextreme\b|\bbrazzers\s*tv\b|\bdorcel\s*tv\b|\bredlight\b|\bprivate\s*tv\b|\bmanpack\b|\bpornbox\b)',
    re.IGNORECASE
)

def is_adult_porn(item):
    grp = (item.get('subgroup') or item.get('group') or '').strip()
    name = (item.get('name') or item.get('title') or '').strip()
    stype = item.get('type', 'live')
    if ADULT_GROUP_PATTERNS.search(grp):
        return True
    if stype == 'live' and LIVE_PORN_CHANNELS.search(name):
        return True
    return False

def filter_family_safe(channels):
    return [ch for ch in channels if not is_adult_porn(ch)]

def refresh_indexes():
    global CURRENT_SERIES_MAP, CURRENT_GROUPED_CATEGORIES, CURRENT_CHANNELS
    CURRENT_CHANNELS = filter_family_safe(CURRENT_CHANNELS)
    t0 = time.time()
    CURRENT_SERIES_MAP = m3u_parser.build_series_map(CURRENT_CHANNELS)
    cats = m3u_parser.get_grouped_categories(CURRENT_CHANNELS, CURRENT_SERIES_MAP)
    for sec in ["live", "movie", "series"]:
        if sec in cats and "subgroups" in cats[sec]:
            cats[sec]["subgroups"] = [sg for sg in cats[sec]["subgroups"] if not ADULT_GROUP_PATTERNS.search(sg.get("name", ""))]
    CURRENT_GROUPED_CATEGORIES = cats
    print(f"[Otimização] Categorias e {len(CURRENT_SERIES_MAP):,} séries indexadas em {time.time() - t0:.2f}s")

def index_series():
    refresh_indexes()

def run_catalog_guardian(auto_save=True):
    """Executa auditoria profunda e auto-reparo de inconsistências no catálogo."""
    global CURRENT_CHANNELS, CURRENT_SERIES_MAP, CURRENT_GROUPED_CATEGORIES, CURRENT_CATALOG_VERSION
    repaired_ch, repaired_s, report = guardian.audit_and_repair(CURRENT_CHANNELS, CURRENT_SERIES_MAP, CURRENT_PLAYLIST_META)
    if report.get("repairs_count", 0) > 0:
        print(f"[Guardian] {report['repairs_count']} inconsistências corrigidas no catálogo!")
        CURRENT_CHANNELS = repaired_ch
        CURRENT_SERIES_MAP = repaired_s
        CURRENT_GROUPED_CATEGORIES = m3u_parser.get_grouped_categories(CURRENT_CHANNELS, CURRENT_SERIES_MAP)
        if auto_save:
            save_playlist_cache(CURRENT_CHANNELS, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META)
    return report

# ==============================================================================
# OFFLINE DOWNLOADS MANAGER (PC, TV & MOBILE)
# ==============================================================================
DOWNLOAD_TASKS = {}

def load_downloads():
    if not DOWNLOADS_META_FILE.exists():
        return []
    try:
        with open(DOWNLOADS_META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_downloads(items):
    try:
        with open(DOWNLOADS_META_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Downloads] Erro ao salvar: {e}")

def start_download_task(item):
    url = item.get("streamUrl") or item.get("url")
    if not url:
        return {"success": False, "error": "URL do stream ausente"}

    item_id = item.get("id") or hashlib.md5(url.encode()).hexdigest()[:12]
    ext = ".mp4"
    if ".mkv" in url.lower():
        ext = ".mkv"
    elif ".ts" in url.lower():
        ext = ".ts"

    local_filename = f"{item_id}{ext}"
    local_path = DOWNLOADS_DIR / local_filename

    downloads = load_downloads()
    existing = next((d for d in downloads if d.get("id") == item_id), None)
    if existing and existing.get("status") == "completed" and local_path.exists():
        return {"success": True, "item": existing, "message": "Item já baixado para assistir offline."}

    download_entry = {
        "id": item_id,
        "title": item.get("title") or item.get("name") or "Conteúdo",
        "seriesTitle": item.get("seriesTitle"),
        "season": item.get("season"),
        "episode": item.get("episode"),
        "type": item.get("type", "movie"),
        "poster": item.get("poster") or item.get("logo") or "",
        "streamUrl": url,
        "localFile": str(local_filename),
        "localPath": str(local_path),
        "status": "downloading",
        "progress": 0,
        "downloadedBytes": 0,
        "totalBytes": 0,
        "createdAt": int(time.time())
    }

    if existing:
        downloads = [d if d.get("id") != item_id else download_entry for d in downloads]
    else:
        downloads.insert(0, download_entry)
    save_downloads(downloads)

    def worker():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "VLC/3.0.18 LibVLC/3.0.18"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                download_entry["totalBytes"] = total
                downloaded = 0
                with open(local_path, "wb") as f_out:
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        f_out.write(chunk)
                        downloaded += len(chunk)
                        download_entry["downloadedBytes"] = downloaded
                        if total > 0:
                            download_entry["progress"] = round((downloaded / total) * 100, 1)

                download_entry["status"] = "completed"
                download_entry["progress"] = 100
                d_list = load_downloads()
                for idx, d in enumerate(d_list):
                    if d.get("id") == item_id:
                        d_list[idx] = download_entry
                        break
                save_downloads(d_list)
                print(f"[Downloads] Sucesso no download: {download_entry['title']}")
        except Exception as err:
            print(f"[Downloads] Falha no download {item_id}: {err}")
            download_entry["status"] = "error"
            download_entry["error"] = str(err)
            d_list = load_downloads()
            for idx, d in enumerate(d_list):
                if d.get("id") == item_id:
                    d_list[idx] = download_entry
                    break
            save_downloads(d_list)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    return {"success": True, "item": download_entry}

def delete_download_item(item_id):
    downloads = load_downloads()
    item = next((d for d in downloads if d.get("id") == item_id), None)
    if item:
        local_path = DOWNLOADS_DIR / item.get("localFile", "")
        if local_path.exists():
            try:
                local_path.unlink()
            except Exception:
                pass
        downloads = [d for d in downloads if d.get("id") != item_id]
        save_downloads(downloads)
        return {"success": True}
    return {"success": False, "error": "Item não encontrado"}

def stream_downloaded_file(handler, item_id):
    downloads = load_downloads()
    item = next((d for d in downloads if d.get("id") == item_id), None)
    if not item:
        handler.send_error(404, "Download não encontrado")
        return
    local_path = DOWNLOADS_DIR / item.get("localFile", "")
    if not local_path.exists():
        handler.send_error(404, "Arquivo de download offline não encontrado no disco")
        return

    file_size = local_path.stat().st_size
    range_header = handler.headers.get("Range")

    content_type = "video/mp4"
    if str(local_path).endswith(".mkv"):
        content_type = "video/x-matroska"
    elif str(local_path).endswith(".ts"):
        content_type = "video/mp2t"

    if range_header:
        m = re.search(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else file_size - 1
            end = min(end, file_size - 1)
            chunk_length = end - start + 1
            handler.send_response(206)
            handler.send_header("Content-Type", content_type)
            handler.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            handler.send_header("Content-Length", str(chunk_length))
            handler.send_header("Accept-Ranges", "bytes")
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.end_headers()
            with open(local_path, "rb") as f:
                f.seek(start)
                handler.wfile.write(f.read(chunk_length))
            return

    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(file_size))
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    with open(local_path, "rb") as f:
        shutil.copyfileobj(f, handler.wfile)

# ==============================================================================
# EPG (ELECTRONIC PROGRAM GUIDE) SCHEDULE ENGINE
# ==============================================================================
GENRE_PROGRAMS = {
    "esporte": [
        ("Futebol ao Vivo: Campeonato", 120, "Transmissão ao vivo com narração e comentários dos melhores momentos."),
        ("Central do Esporte & Análise", 60, "Resumo dos jogos, debate tático e gols da rodada."),
        ("Giro Esportivo Internacional", 45, "Notícias dos principais campeonatos do mundo e bastidores."),
        ("Mesa Redonda: Debate dos Craques", 90, "Debate acalorado sobre os lances polêmicos da semana.")
    ],
    "noticia": [
        ("Edição das 18h: Notícias do Dia", 60, "As principais manchetes do Brasil e do mundo com reportagens exclusivas."),
        ("Jornal da Noite em Ponto", 45, "Cobertura política, econômica e internacional em tempo real."),
        ("Plantão Urgente & Especialistas", 45, "Análises aprofundadas dos fatos que marcaram o dia."),
        ("Revista Semanal de Informação", 60, "Grandes reportagens investigativas e documentários especiais.")
    ],
    "filme": [
        ("Sessão Cine Prime: Estreia de Sucesso", 120, "Grandes sucessos do cinema mundial em alta definição e som imersivo."),
        ("Cine Ação & Suspense", 110, "Histórias eletrizantes repletas de adrenalina e reviravoltas."),
        ("Festival Clássicos do Cinema", 105, "Obras-primas premiadas que marcaram a história da sétima arte."),
        ("Cine Família: Aventura para Todos", 95, "Filmes imperdíveis para reunir toda a família com muita emoção.")
    ],
    "infantil": [
        ("Aventuras Animadas: Maratona", 30, "Novos episódios dos personagens favoritos da garotada."),
        ("Super Desenhos Divertidos", 40, "Muita risada, descobertas e brincadeiras para todas as idades."),
        ("Clube da Animação Especial", 45, "Aventuras épicas em mundos fantásticos e mágicos."),
        ("Cine Desenho Kids", 75, "Filmes de animação emocionantes com mensagens educativas.")
    ],
    "documentario": [
        ("Planeta Selvagem: Natureza Extrema", 50, "Expedições aos ecossistemas mais fascinantes da Terra."),
        ("Mistérios do Universo & Ciência", 60, "Novas descobertas sobre o cosmos, física moderna e tecnologia."),
        ("Grandes Civilizações da História", 55, "Segredos e tesouros das civilizações antigas revelados por arqueólogos."),
        ("Engenharia Impossível", 50, "Como foram construídas as maiores megaestruturas da humanidade.")
    ],
    "variedades": [
        ("Show da Noite & Entrevistas", 60, "Música ao vivo, bate-papo descontraído e convidados ilustres."),
        ("Culinária de Alto Nível", 45, "Receitas práticas, dicas de chefs e desafios gastronômicos."),
        ("Vida e Saúde: Bem Estar", 50, "Dicas de saúde, nutrição e qualidade de vida para o seu dia a dia."),
        ("Novela das Nove: Capítulo Inédito", 60, "Emoção, intrigas e revelações no capítulo mais esperado da semana.")
    ]
}

def detect_genre(channel_name, group_name=""):
    txt = (str(channel_name) + " " + str(group_name)).lower()
    if any(k in txt for k in ["espn", "sportv", "sport", "futebol", "premiere", "combate", "nba", "racing", "conmebol", "copa"]):
        return "esporte"
    if any(k in txt for k in ["news", "noticia", "jornal", "globonews", "cnn", "bandnews", "jovem pan", "record news"]):
        return "noticia"
    if any(k in txt for k in ["telecine", "hbo", "cinema", "filme", "movie", "megapix", "cinemax", "warner", "tnt", "space", "paramount", "universal"]):
        return "filme"
    if any(k in txt for k in ["cartoon", "disney", "nickelodeon", "gloob", "nick", "kids", "infantil", "desenho", "animax", "baby"]):
        return "infantil"
    if any(k in txt for k in ["discovery", "history", "nat geo", "national geographic", "animal planet", "doc", "curta"]):
        return "documentario"
    return "variedades"

def get_channel_epg(channel, now=None):
    if now is None:
        now = datetime.now()
    c_name = channel.get("name", "Canal")
    c_group = channel.get("group", "")
    genre = detect_genre(c_name, c_group)
    programs = GENRE_PROGRAMS.get(genre, GENRE_PROGRAMS["variedades"])

    day_str = now.strftime("%Y-%m-%d")
    seed_str = f"{c_name}_{day_str}"
    seed_val = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)

    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    current_time = start_of_day
    daily_schedule = []

    idx = seed_val % len(programs)
    while current_time < start_of_day + timedelta(days=1, hours=6):
        title, dur, desc = programs[idx % len(programs)]
        part_num = (idx % 12) + 1
        full_title = f"{title}" if "Sessão" in title or "Jornal" in title else f"{title} (Ep. {part_num})"
        end_time = current_time + timedelta(minutes=dur)
        daily_schedule.append({
            "title": full_title,
            "category": genre.capitalize(),
            "start": current_time.strftime("%H:%M"),
            "end": end_time.strftime("%H:%M"),
            "startTime": int(current_time.timestamp()),
            "endTime": int(end_time.timestamp()),
            "durationMinutes": dur,
            "description": desc,
            "rating": "Livre" if genre in ["infantil", "documentario"] else ("10+" if genre == "esporte" else "14+")
        })
        current_time = end_time
        idx += 1

    now_ts = int(now.timestamp())
    current_prog = None
    next_progs = []

    for i, p in enumerate(daily_schedule):
        if p["startTime"] <= now_ts < p["endTime"]:
            current_prog = dict(p)
            elapsed = now_ts - p["startTime"]
            total_dur = p["endTime"] - p["startTime"]
            pct = int((elapsed / total_dur) * 100) if total_dur > 0 else 0
            current_prog["progressPercent"] = max(1, min(99, pct))
            current_prog["remainingMinutes"] = max(1, int((p["endTime"] - now_ts) / 60))
            next_progs = daily_schedule[i+1:i+4]
            break

    if not current_prog:
        current_prog = daily_schedule[0]
        current_prog["progressPercent"] = 50
        current_prog["remainingMinutes"] = 30
        next_progs = daily_schedule[1:4]

    return {
        "channelId": str(channel.get("id")),
        "channelName": c_name,
        "logo": channel.get("logo", ""),
        "url": channel.get("url", ""),
        "group": c_group,
        "genre": genre,
        "currentProgram": current_prog,
        "nextPrograms": next_progs
    }

def get_epg_feed(channels, group=None, query_str="", limit=50, offset=0):
    live_channels = [ch for ch in channels if ch.get("type") == "live"]
    if group and group != "Todos":
        g_clean = group.lower()
        live_channels = [ch for ch in live_channels if g_clean in (ch.get("group", "") + " " + ch.get("subgroup", "")).lower()]
    if query_str:
        q_norm = query_str.lower()
        live_channels = [ch for ch in live_channels if q_norm in ch.get("name", "").lower() or q_norm in ch.get("group", "").lower()]
    
    total = len(live_channels)
    slice_channels = live_channels[offset:offset+limit]
    now = datetime.now()
    epg_items = [get_channel_epg(c, now) for c in slice_channels]
    return {
        "success": True,
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": epg_items
    }

# ==============================================================================
# PRIME & STREAMFLIX HOME SHELVES & ROWS ENGINE
# ==============================================================================
_PROGRESS_TITLE_CACHE = {}
_PLACEHOLDER_TITLES = {"", "sem título", "sem titulo", "none", "null", "undefined", "n/a"}

def _is_placeholder_title(value):
    return str(value or "").strip().lower() in _PLACEHOLDER_TITLES

def resolve_progress_titles(items):
    """Preenche títulos 'Sem Título'/'None' consultando o catálogo pela URL do stream.

    Usa um cache em memória para que a varredura do catálogo aconteça no máximo
    uma vez por URL, mantendo o carregamento da Home instantâneo.
    """
    if not items:
        return items

    def _url_of(it):
        return it.get("streamUrl") or it.get("url") or it.get("contentId") or ""

    # 1) Descobre quais URLs ainda precisam ser resolvidas
    wanted = set()
    for it in items:
        if _is_placeholder_title(it.get("title")):
            u = _url_of(it)
            if u and u not in _PROGRESS_TITLE_CACHE:
                wanted.add(u)

    # 2) Uma única passada no catálogo resolve todas as URLs pendentes
    if wanted:
        found = {}
        for ch in CURRENT_CHANNELS:
            u = ch.get("url")
            if u in wanted:
                found[u] = ch
                if len(found) == len(wanted):
                    break
        for u in wanted:
            _PROGRESS_TITLE_CACHE[u] = (found.get(u) or {}).get("name", "")

    # 3) Aplica os títulos resolvidos em uma cópia limpa do item
    for it in items:
        if not _is_placeholder_title(it.get("title")):
            continue
        resolved = _PROGRESS_TITLE_CACHE.get(_url_of(it), "")
        if not resolved:
            it["title"] = "Continue assistindo"
            continue
        m = m3u_parser.SEASON_EP_REGEX.match(resolved.strip())
        if m:
            series_title = m.group(1).strip()
            it["title"] = series_title
            it["seriesTitle"] = series_title
            it["season"] = int(m.group(2) or m.group(3) or m.group(4) or 1)
            it["episode"] = int(m.group(5) or m.group(6) or m.group(7) or m.group(8) or 1)
            it["type"] = "series"
        else:
            it["title"] = resolved
    return items

def _progress_display_title(item):
    title = item.get("title")
    if _is_placeholder_title(title):
        title = item.get("seriesTitle") or item.get("name")
    if _is_placeholder_title(title):
        title = "Continue assistindo"
    if item.get("type") == "series":
        season = item.get("season")
        episode = item.get("episode")
        if season not in (None, "") and episode not in (None, ""):
            suffix = f" • T{season}:E{episode}"
            if suffix.strip(" •") not in str(title):
                title = f"{title}{suffix}"
    return title

def get_netflix_home_data(account_code="PADRAO", profile_id="p1", data_saver=False):
    rows = []
    prog_res = sync_hub.get_progress(account_code, profile_id)
    continue_items = prog_res.get("items", []) if isinstance(prog_res, dict) else (prog_res or [])
    resolve_progress_titles(continue_items)
    hero_item = None

    if continue_items:
        first = continue_items[0]
        hero_item = {
            "id": first.get("contentId"),
            "title": _progress_display_title(first),
            "seriesTitle": first.get("seriesTitle"),
            "season": first.get("season"),
            "episode": first.get("episode"),
            "type": first.get("type", "movie"),
            "poster": first.get("poster"),
            "backdrop": first.get("poster") if not data_saver else "",
            "plot": "Retome de onde você parou com a experiência completa de streaming.",
            "streamUrl": first.get("streamUrl"),
            "positionMs": first.get("positionMs", 0),
            "durationMs": first.get("durationMs", 0),
            "progressPercent": first.get("progressPercent", 0),
            "rating": "9.2",
            "year": "2025"
        }

    top_movies = [ch for ch in CURRENT_CHANNELS if ch.get("type") == "movie"]
    top_live = [ch for ch in CURRENT_CHANNELS if ch.get("type") == "live"]

    if not hero_item and top_movies:
        m = top_movies[0]
        hero_item = {
            "id": m.get("id"),
            "title": m.get("name"),
            "type": "movie",
            "poster": m.get("logo"),
            "backdrop": m.get("logo") if not data_saver else "",
            "plot": "Um dos filmes mais aclamados da atualidade. Assista agora em 4K Ultra HD com som cristalino.",
            "streamUrl": m.get("url"),
            "rating": "9.4",
            "year": "2025"
        }
    elif not hero_item and CURRENT_SERIES_MAP:
        s_title = next(iter(CURRENT_SERIES_MAP))
        s_data = CURRENT_SERIES_MAP[s_title]
        hero_item = {
            "id": s_title,
            "title": s_title,
            "type": "series",
            "poster": s_data.get("logo"),
            "backdrop": s_data.get("logo") if not data_saver else "",
            "plot": f"Série premiada com {s_data.get('seasons_count', 1)} temporadas e {s_data.get('episodes_count', 1)} episódios imperdíveis.",
            "streamUrl": "",
            "rating": "9.1",
            "year": "2025"
        }

    # 1. Continuar Assistindo (Wide cards with progress bar)
    norm_continue = []
    for it in continue_items:
        p_ms = it.get("positionMs", 0)
        d_ms = it.get("durationMs", 0)
        pct = it.get("progressPercent") or (round((p_ms / d_ms) * 100, 1) if d_ms > 0 else 0)
        rem_min = max(1, round((d_ms - p_ms) / 60000)) if d_ms > p_ms else 1
        s_title = it.get("seriesTitle")
        ep_lbl = f"T{it.get('season') or 1}:E{it.get('episode') or 1}" if it.get("type") == "series" else "Filme"
        norm_continue.append({
            "id": it.get("contentId") or it.get("id"),
            "title": _progress_display_title(it),
            "seriesTitle": s_title,
            "season": it.get("season"),
            "episode": it.get("episode"),
            "episodeTitle": ep_lbl,
            "type": it.get("type", "movie"),
            "poster": it.get("poster"),
            "backdrop": it.get("poster") if not data_saver else "",
            "streamUrl": it.get("streamUrl") or it.get("url"),
            "url": it.get("streamUrl") or it.get("url"),
            "positionMs": p_ms,
            "durationMs": d_ms,
            "position": p_ms / 1000 if p_ms else 0,
            "duration": d_ms / 1000 if d_ms else 0,
            "percentage": pct,
            "progressPercent": pct,
            "remaining": f"Faltam {rem_min} min" if d_ms > 0 else "Assistindo"
        })

    if norm_continue:
        rows.append({
            "id": "row_continue",
            "title": "Continuar Assistindo",
            "type": "continue",
            "isWide": True,
            "items": norm_continue
        })

    # 2. TV ao Vivo Agora & Guia EPG (Cards 16:9 com programa em andamento e barra de tempo)
    if top_live:
        limit_live = 12 if data_saver else 24
        now = datetime.now()
        live_cards = []
        for ch in top_live[:limit_live]:
            epg_info = get_channel_epg(ch, now)
            live_cards.append({
                "id": ch.get("id"),
                "title": ch.get("name"),
                "name": ch.get("name"),
                "type": "live",
                "logo": ch.get("logo"),
                "url": ch.get("url"),
                "group": ch.get("group", "TV"),
                "currentProgram": epg_info.get("currentProgram"),
                "nextPrograms": epg_info.get("nextPrograms")
            })
        rows.append({
            "id": "row_live",
            "title": "TV ao Vivo Agora & Guia de Programação",
            "type": "live",
            "isLive": True,
            "isWide": True,
            "items": live_cards
        })

    # 3. Em Alta / Top 10 Hoje
    series_keys = list(CURRENT_SERIES_MAP.keys())
    trending_items = []
    limit_trend = 6 if data_saver else 12
    for s_k in series_keys[:limit_trend]:
        s_obj = CURRENT_SERIES_MAP[s_k]
        trending_items.append({
            "id": s_k,
            "title": s_k,
            "type": "series",
            "logo": s_obj.get("logo"),
            "seasons_count": s_obj.get("seasons_count", 1),
            "episodes_count": s_obj.get("episodes_count", 1),
            "rating": "9.5",
            "isTop10": True
        })
    for m in top_movies[:limit_trend]:
        trending_items.append({
            "id": m.get("id"),
            "title": m.get("name"),
            "type": "movie",
            "logo": m.get("logo"),
            "url": m.get("url"),
            "rating": "9.3",
            "isTop10": True
        })

    if trending_items:
        rows.append({
            "id": "row_trending",
            "title": "Top 10 Hoje & Em Alta",
            "type": "poster",
            "items": trending_items
        })

    # 4. Recomendados para Você (Prime Style)
    recommended_items = []
    if len(top_movies) > 12:
        for m in top_movies[12:24]:
            recommended_items.append({
                "id": m.get("id"),
                "title": m.get("name"),
                "type": "movie",
                "logo": m.get("logo"),
                "url": m.get("url"),
                "rating": "9.0"
            })
    if len(series_keys) > 12:
        for s_k in series_keys[12:24]:
            s_obj = CURRENT_SERIES_MAP[s_k]
            recommended_items.append({
                "id": s_k,
                "title": s_k,
                "type": "series",
                "logo": s_obj.get("logo"),
                "seasons_count": s_obj.get("seasons_count", 1),
                "episodes_count": s_obj.get("episodes_count", 1),
                "rating": "9.1"
            })
    if recommended_items:
        rows.append({
            "id": "row_recommended",
            "title": "Recomendados para Você",
            "type": "poster",
            "items": recommended_items
        })

    # 5. Séries Populares
    if series_keys:
        popular_series = []
        limit_s = 12 if data_saver else 24
        for s_k in series_keys[:limit_s]:
            s_obj = CURRENT_SERIES_MAP[s_k]
            popular_series.append({
                "id": s_k,
                "title": s_k,
                "type": "series",
                "logo": s_obj.get("logo"),
                "seasons_count": s_obj.get("seasons_count", 1),
                "episodes_count": s_obj.get("episodes_count", 1),
                "rating": "8.9"
            })
        rows.append({
            "id": "row_series",
            "title": "Séries Populares",
            "type": "poster",
            "items": popular_series
        })

    # 6. Filmes de Sucesso
    if top_movies:
        limit_m = 12 if data_saver else 24
        rows.append({
            "id": "row_movies",
            "title": "Filmes de Sucesso",
            "type": "poster",
            "items": [{
                "id": m.get("id"),
                "title": m.get("name"),
                "type": "movie",
                "logo": m.get("logo"),
                "url": m.get("url"),
                "rating": "8.7"
            } for m in top_movies[12:12+limit_m]]
        })

    # 7. Dedicated Row: Universo Disney+ & Marvel (Séries)
    disney_series = [
        s for s in CURRENT_SERIES_MAP.values()
        if any(w in (s.get("group", "") + " " + s.get("subgroup", "")).lower() for w in ["disney", "marvel"])
    ]
    if disney_series:
        rows.append({
            "id": "row_disney_series",
            "title": "✨ Universo Disney+ & Marvel (Séries)",
            "type": "poster",
            "items": [{
                "id": s.get("id") or s.get("title"),
                "title": s.get("title"),
                "name": s.get("title"),
                "type": "series",
                "logo": s.get("logo"),
                "seasons_count": s.get("seasons_count", 1),
                "episodes_count": s.get("episodes_count", 1),
                "rating": "9.2"
            } for s in disney_series[:24]]
        })

    # 8. Dedicated Row: Sucessos Disney & Marvel (Filmes)
    disney_movies = [
        m for m in CURRENT_CHANNELS
        if m.get("type") == "movie" and any(w in (m.get("group", "") + " " + m.get("subgroup", "") + " " + m.get("name", "")).lower() for w in ["disney", "marvel"])
    ]
    if disney_movies:
        rows.append({
            "id": "row_disney_movies",
            "title": "🏰 Filmes Disney, Marvel & Pixar",
            "type": "poster",
            "items": [{
                "id": m.get("id"),
                "title": m.get("name"),
                "name": m.get("name"),
                "type": "movie",
                "logo": m.get("logo"),
                "url": m.get("url"),
                "rating": "9.1"
            } for m in disney_movies[:24]]
        })

    # 9. Offline Downloads
    downloads = load_downloads()
    if downloads:
        rows.append({
            "id": "row_downloads",
            "title": "Downloads & Assistir Offline",
            "type": "download",
            "isWide": True,
            "items": downloads
        })

    return {
        "success": True,
        "hero": hero_item,
        "rows": rows,
        "total_channels": len(CURRENT_CHANNELS),
        "total_series": len(CURRENT_SERIES_MAP)
    }

get_home_feed_data = get_netflix_home_data

def load_initial_channels():
    global CURRENT_CHANNELS, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META, CURRENT_CATALOG_VERSION

    # 1. Try loading from fast cache JSON
    if SAVED_CACHE_FILE.exists() and SAVED_META_FILE.exists():
        try:
            with open(SAVED_META_FILE, "r", encoding="utf-8") as f:
                CURRENT_PLAYLIST_META = json.load(f)
                CURRENT_PLAYLIST_NAME = CURRENT_PLAYLIST_META.get("name", "Minha Lista")
                CURRENT_CATALOG_VERSION = CURRENT_PLAYLIST_META.get("catalog_version", int(time.time()))

            start_t = time.time()
            with open(SAVED_CACHE_FILE, "r", encoding="utf-8") as f:
                CURRENT_CHANNELS = json.load(f)
            print(f"[Cache] Carregados {len(CURRENT_CHANNELS):,} canais salvos em {time.time() - start_t:.3f}s (Versão: {CURRENT_CATALOG_VERSION})")
            index_series()
            return
        except Exception as e:
            print(f"[Aviso] Falha ao ler cache salvo: {e}")
            backup_file = BASE_DIR / "saved_cache.backup.json"
            if backup_file.exists():
                try:
                    start_t = time.time()
                    with open(backup_file, "r", encoding="utf-8") as bf:
                        CURRENT_CHANNELS = json.load(bf)
                    print(f"[Cache] Carregados {len(CURRENT_CHANNELS):,} canais do backup em {time.time() - start_t:.3f}s")
                    index_series()
                    return
                except Exception as be:
                    print(f"[Aviso] Falha ao ler backup: {be}")

    # 2. Try loading from saved_meta.json URL (for Cloud / Render deployment)
    if SAVED_META_FILE.exists() and not SAVED_CACHE_FILE.exists():
        try:
            with open(SAVED_META_FILE, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            url = meta.get('url')
            if url and str(url).startswith('http'):
                def _bg_cloud_init():
                    global CURRENT_CHANNELS, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META
                    try:
                        print(f'[Cloud Render] Baixando catálogo inicial em background: {url[:50]}...')
                        channels = m3u_parser.parse_m3u_url(url, timeout=60)
                        if channels:
                            save_playlist_cache(channels, meta.get('name', 'Lista Principal'), meta)
                            print(f'[Cloud Render] Catálogo carregado com {len(channels):,} canais/filmes!')
                    except Exception as err:
                        print(f'[Cloud Render] Erro ao carregar catálogo em background: {err}')
                threading.Thread(target=_bg_cloud_init, daemon=True).start()
        except Exception as e:
            print(f'[Aviso] Falha ao processar meta para cloud load: {e}')

    # 2. Try loading from saved M3U file
    if SAVED_M3U_FILE.exists():
        try:
            print("[Cache] Reindexando lista M3U salva...")
            CURRENT_CHANNELS = m3u_parser.parse_m3u_file(str(SAVED_M3U_FILE))
            CURRENT_PLAYLIST_NAME = "Minha Lista Salva"
            save_playlist_cache(CURRENT_CHANNELS, CURRENT_PLAYLIST_NAME, {})
            return
        except Exception as e:
            print(f"[Aviso] Falha ao ler M3U salvo: {e}")

    # 3. Default: Empty list (Cada usuário conecta sua própria lista)
    CURRENT_CHANNELS = []
    CURRENT_PLAYLIST_NAME = "Nenhuma Lista Conectada"
    CURRENT_PLAYLIST_META = {}
    refresh_indexes()

def save_playlist_cache(channels, name, meta):
    global CURRENT_CHANNELS, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META, CURRENT_CATALOG_VERSION
    CURRENT_CHANNELS = channels
    CURRENT_PLAYLIST_NAME = name
    CURRENT_PLAYLIST_META = meta
    CURRENT_PLAYLIST_META["name"] = name
    CURRENT_PLAYLIST_META["saved_at"] = time.strftime("%d/%m/%Y %H:%M")
    CURRENT_CATALOG_VERSION = int(time.time())
    CURRENT_PLAYLIST_META["catalog_version"] = CURRENT_CATALOG_VERSION

    try:
        with open(SAVED_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False)
        with open(SAVED_META_FILE, "w", encoding="utf-8") as f:
            json.dump(CURRENT_PLAYLIST_META, f, ensure_ascii=False, indent=2)
        print(f"[Persistência] Lista '{name}' salva permanentemente!")
    except Exception as e:
        print(f"[Erro] Falha ao persistir cache: {e}")

    index_series()

def get_favorites():
    if not FAVORITES_FILE.exists():
        return []
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_favorites(favs):
    try:
        with open(FAVORITES_FILE, "w", encoding="utf-8") as f:
            json.dump(favs, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Erro ao salvar favoritos: {e}")

VOD_CACHE = {}

def get_vod_details(stream_id="", stream_url="", movie_name=""):
    import re
    import urllib.request

    if not stream_id and stream_url:
        m = re.search(r"/movie/[^/]+/[^/]+/(\d+)\.", stream_url)
        if m:
            stream_id = m.group(1)

    if stream_id and stream_id in VOD_CACHE:
        return VOD_CACHE[stream_id]

    creds = None
    if stream_url:
        m = re.search(r"(https?://[^/]+)/movie/([^/]+)/([^/]+)/(\d+)\.", stream_url)
        if m:
            creds = (m.group(1), m.group(2), m.group(3), m.group(4))

    if not creds and CURRENT_PLAYLIST_META.get("url"):
        meta_url = CURRENT_PLAYLIST_META["url"]
        m = re.search(r"(https?://[^/]+)/(?:get|player_api)\.php\?.*username=([^&]+)&password=([^&]+)", meta_url)
        if m and stream_id:
            creds = (m.group(1), m.group(2), m.group(3), stream_id)

    if creds:
        base, user, pwd, vod_id = creds
        api_url = f"{base}/player_api.php?username={user}&password={pwd}&action=get_vod_info&vod_id={vod_id}"
        try:
            req = urllib.request.Request(api_url, headers={"User-Agent": "VLC/3.0.18 LibVLC/3.0.18"})
            with urllib.request.urlopen(req, timeout=7) as res:
                data = json.loads(res.read().decode("utf-8", errors="replace"))
                info = data.get("info")
                if isinstance(info, list) and info:
                    info = info[0]
                elif not isinstance(info, dict):
                    info = {}

                movie_data = data.get("movie_data") or {}

                name = info.get("name") or movie_data.get("name") or movie_name or "Filme"
                plot = info.get("plot") or info.get("description") or ""
                trailer = info.get("youtube_trailer") or ""
                genre = info.get("genre") or ""
                rating = str(info.get("rating") or "")
                duration = info.get("duration") or (f"{info.get('episode_run_time')} min" if info.get("episode_run_time") else "")
                releasedate = str(info.get("releasedate") or "")

                year = ""
                m_year = re.search(r"\b(19\d\d|20\d\d)\b", releasedate or name)
                if m_year:
                    year = m_year.group(1)

                director = info.get("director") or ""
                cast = info.get("cast") or info.get("actors") or ""
                cover = info.get("movie_image") or info.get("cover_big") or ""

                backdrop = ""
                bp = info.get("backdrop_path")
                if isinstance(bp, list) and bp:
                    backdrop = bp[0]
                elif isinstance(bp, str):
                    backdrop = bp

                detail = {
                    "success": True,
                    "stream_id": vod_id,
                    "title": name,
                    "name": name,
                    "plot": plot,
                    "trailer_id": trailer,
                    "trailer": trailer,
                    "genre": genre,
                    "rating": rating,
                    "duration": duration,
                    "year": year,
                    "releasedate": releasedate,
                    "director": director,
                    "cast": cast,
                    "poster_url": cover,
                    "cover": cover,
                    "backdrop_url": backdrop or cover,
                    "backdrop": backdrop or cover,
                    "stream_url": stream_url
                }
                if stream_id:
                    VOD_CACHE[stream_id] = detail
                return detail
        except Exception as e:
            print(f"[VOD Detail] Erro ao buscar da API Xtream: {e}")

    # Fallback
    m_year = re.search(r"\b(19\d\d|20\d\d)\b", movie_name or "")
    year = m_year.group(1) if m_year else ""

    fallback = {
        "success": True,
        "stream_id": stream_id,
        "title": movie_name or "Filme",
        "name": movie_name or "Filme",
        "plot": "Sinopse não disponível para este título.",
        "trailer_id": "",
        "trailer": "",
        "genre": "",
        "rating": "",
        "duration": "",
        "year": year,
        "releasedate": "",
        "director": "",
        "cast": "",
        "poster_url": "",
        "cover": "",
        "backdrop_url": "",
        "backdrop": "",
        "stream_url": stream_url
    }
    return fallback

SERIES_DETAILS_CACHE = {}
XTREAM_SERIES_CATALOGUE = None

def get_series_details(title, series_id=None):
    global XTREAM_SERIES_CATALOGUE
    if not title and not series_id:
        return None

    cache_key = f"{title}_{series_id}"
    if cache_key in SERIES_DETAILS_CACHE:
        return SERIES_DETAILS_CACHE[cache_key]
    if title and title in SERIES_DETAILS_CACHE:
        return SERIES_DETAILS_CACHE[title]

    s_data = None
    # 1. Direct title match
    if title:
        s_data = CURRENT_SERIES_MAP.get(title)

    # 2. Match by ID if provided
    if not s_data and series_id:
        for k, v in CURRENT_SERIES_MAP.items():
            if str(v.get("id")) == str(series_id) or str(v.get("series_id")) == str(series_id):
                s_data = v
                break

    # 3. Match by normalized title or substring
    if not s_data and title:
        q_norm = m3u_parser.normalize_text(title)
        title_lower = title.lower().strip()
        # Case-insensitive exact
        for k, v in CURRENT_SERIES_MAP.items():
            if k.lower().strip() == title_lower or v.get("title", "").lower().strip() == title_lower:
                s_data = v
                break

        # Normalized exact
        if not s_data:
            for k, v in CURRENT_SERIES_MAP.items():
                if m3u_parser.normalize_text(k) == q_norm or m3u_parser.normalize_text(v.get("title", "")) == q_norm:
                    s_data = v
                    break

        # Substring normalized (if query is at least 3 chars)
        if not s_data and len(q_norm) >= 3:
            for k, v in CURRENT_SERIES_MAP.items():
                k_norm = m3u_parser.normalize_text(k)
                if q_norm in k_norm or k_norm in q_norm:
                    s_data = v
                    break

    if not s_data:
        return None

    plot = ""
    rating = ""
    backdrop_url = ""
    trailer_id = ""
    cast = ""
    director = ""
    genre = s_data.get("subgroup") or s_data.get("group") or "Série"
    year = ""

    m_year = re.search(r"\b(19\d\d|20\d\d)\b", s_data.get("title", ""))
    if m_year:
        year = m_year.group(1)

    creds = None
    if CURRENT_PLAYLIST_META.get("url"):
        meta_url = CURRENT_PLAYLIST_META["url"]
        m = re.search(r"(https?://[^/]+)/(?:get|player_api)\.php\?.*username=([^&]+)&password=([^&]+)", meta_url)
        if m:
            creds = (m.group(1), m.group(2), m.group(3))

    if not creds:
        first_season = next(iter(s_data["seasons"].values())) if s_data.get("seasons") else []
        if first_season and first_season[0].get("url"):
            m = re.search(r"(https?://[^/]+)/series/([^/]+)/([^/]+)/", first_season[0]["url"])
            if m:
                creds = (m.group(1), m.group(2), m.group(3))

    if creds:
        base, user, pwd = creds
        if XTREAM_SERIES_CATALOGUE is None:
            try:
                cat_url = f"{base}/player_api.php?username={user}&password={pwd}&action=get_series"
                req = urllib.request.Request(cat_url, headers={"User-Agent": "VLC/3.0.18 LibVLC/3.0.18"})
                with urllib.request.urlopen(req, timeout=6) as res:
                    raw_data = json.loads(res.read().decode("utf-8", errors="replace"))
                    if isinstance(raw_data, list):
                        XTREAM_SERIES_CATALOGUE = raw_data
                    else:
                        XTREAM_SERIES_CATALOGUE = []
            except Exception as e:
                print(f"[Series API] Erro ao carregar catálogo de séries: {e}")
                XTREAM_SERIES_CATALOGUE = []

        if XTREAM_SERIES_CATALOGUE:
            clean_s_title = re.sub(r"\(\d{4}\)", "", s_data["title"]).strip().lower()
            matched_item = None
            for item in XTREAM_SERIES_CATALOGUE:
                item_name = item.get("name", "").strip().lower()
                clean_item_name = re.sub(r"\(\d{4}\)", "", item_name).strip()
                if item_name == s_data["title"].lower() or clean_item_name == clean_s_title:
                    matched_item = item
                    break
            if not matched_item:
                for item in XTREAM_SERIES_CATALOGUE:
                    item_name = item.get("name", "").strip().lower()
                    if clean_s_title in item_name or item_name in clean_s_title:
                        matched_item = item
                        break

            if matched_item:
                plot = matched_item.get("plot") or ""
                rating = str(matched_item.get("rating") or "")
                cast = matched_item.get("cast") or ""
                director = matched_item.get("director") or ""
                genre = matched_item.get("genre") or genre
                trailer_id = matched_item.get("youtube_trailer") or ""
                if matched_item.get("releaseDate"):
                    m_y = re.search(r"\b(19\d\d|20\d\d)\b", str(matched_item.get("releaseDate")))
                    if m_y:
                        year = m_y.group(1)

                bp = matched_item.get("backdrop_path")
                if isinstance(bp, list) and bp:
                    backdrop_url = bp[0]
                elif isinstance(bp, str):
                    backdrop_url = bp

    if not backdrop_url:
        backdrop_url = s_data.get("logo") or ""
    if not plot:
        plot = f"Acompanhe todas as {s_data.get('seasons_count', 1)} temporadas e {s_data.get('episodes_count', 0)} episódios de {s_data['title']} em alta definição."

    seasons_json = {str(k): v for k, v in sorted(s_data["seasons"].items())}
    seasons_list = [int(k) for k in seasons_json.keys()]

    detail = {
        "success": True,
        "id": s_data.get("id") or s_data["title"],
        "series_id": s_data.get("id") or s_data["title"],
        "title": s_data["title"],
        "name": s_data["title"],
        "group": s_data.get("group", "Séries"),
        "subgroup": s_data.get("subgroup", "Séries"),
        "logo": s_data.get("logo", ""),
        "poster_url": s_data.get("logo", ""),
        "cover": s_data.get("logo", ""),
        "backdrop_url": backdrop_url,
        "backdrop": backdrop_url,
        "plot": plot,
        "rating": rating or "8.8",
        "year": year or "-",
        "genre": genre,
        "cast": cast or "Elenco Principal",
        "director": director or "Produção Original",
        "trailer_id": trailer_id,
        "seasons_count": s_data.get("seasons_count", len(seasons_list)),
        "episodes_count": s_data.get("episodes_count", sum(len(v) for v in seasons_json.values())),
        "seasons": seasons_json,
        "seasons_list": seasons_list,
        "episodes": seasons_json,
        "info": {
            "name": s_data["title"],
            "title": s_data["title"],
            "cover": s_data.get("logo", ""),
            "backdrop": backdrop_url,
            "plot": plot,
            "genre": genre,
            "rating": rating or "8.8",
            "year": year or "-"
        }
    }
    if title:
        SERIES_DETAILS_CACHE[title] = detail
    if series_id:
        SERIES_DETAILS_CACHE[str(series_id)] = detail
    SERIES_DETAILS_CACHE[cache_key] = detail
    return detail

TRANSLATE_CACHE = {}

def refine_cinematic_translation(orig, trans):
    if not trans:
        return trans
    res = trans
    orig_lower = orig.lower()
    
    # 1. Medical / Stroke / Disability context
    if "stroke" in orig_lower:
        res = re.sub(r'\bderrame maci[çc]o\b', 'grave AVC (derrame)', res, flags=re.IGNORECASE)
        res = re.sub(r'\bsofreu um maci[çc]o derrame\b', 'sofreu um grave AVC', res, flags=re.IGNORECASE)
        res = re.sub(r'\bum maci[çc]o derrame\b', 'um grave AVC', res, flags=re.IGNORECASE)
        res = re.sub(r'\bderrame massivo\b', 'grave AVC', res, flags=re.IGNORECASE)
    
    # "remained speechless" in stroke/injury context vs general surprise
    if "speechless" in orig_lower:
        if any(w in orig_lower for w in ["stroke", "survived", "injury", "brain", "coma", "hospital", "died", "paralyzed", "doctor"]):
            res = re.sub(r'\bpermaneceu sem palavras\b', 'perdeu a capacidade de falar', res, flags=re.IGNORECASE)
            res = re.sub(r'\bficou sem palavras\b', 'perdeu a fala', res, flags=re.IGNORECASE)
            res = re.sub(r'\bcontinuou sem palavras\b', 'ficou impossibilitado de falar', res, flags=re.IGNORECASE)
        else:
            res = re.sub(r'\bpermaneceu sem palavras\b', 'ficou sem palavras', res, flags=re.IGNORECASE)

    # 2. Caretaker / Nurse / Devotion
    if "sole nurse" in orig_lower or "sole caretaker" in orig_lower:
        res = re.sub(r'\bsua [úu]nica enfermeira e cuidadora\b', 'sua cuidadora e enfermeira dedicada', res, flags=re.IGNORECASE)
        res = re.sub(r'\bseu [úu]nico enfermeiro e cuidador\b', 'seu cuidador e enfermeiro dedicado', res, flags=re.IGNORECASE)

    # 3. Marital / Biographical / Passing away
    if "remarry" in orig_lower or "re-marry" in orig_lower:
        res = re.sub(r'\bn[ãa]o se casou novamente\b', 'nunca mais se casou', res, flags=re.IGNORECASE)
        res = re.sub(r'\bn[ãa]o voltou a se casar\b', 'nunca mais voltou a se casar', res, flags=re.IGNORECASE)

    if "passed away" in orig_lower or "peacefully" in orig_lower:
        res = re.sub(r'\bfaleceu pacificamente\b', 'faleceu em paz', res, flags=re.IGNORECASE)
        res = re.sub(r'\bmorreu pacificamente\b', 'faleceu em paz', res, flags=re.IGNORECASE)
        res = re.sub(r'\bpassou pacificamente\b', 'faleceu em paz', res, flags=re.IGNORECASE)

    if "over six decades" in orig_lower or "for over" in orig_lower:
        res = re.sub(r'\bpor mais de 6 d[ée]cadas\b', 'por mais de seis décadas', res, flags=re.IGNORECASE)

    if "by his side" in orig_lower:
        res = re.sub(r'\bao lado dele quando ele morreu cinco anos depois\b', 'ao seu lado quando ele faleceu, cinco anos depois', res, flags=re.IGNORECASE)
        res = re.sub(r'\bao seu lado quando ele morreu cinco anos depois\b', 'ao seu lado quando ele morreu, cinco anos depois', res, flags=re.IGNORECASE)

    # 4. Cinematic / Epilogue / Prologue tropes
    res = re.sub(r'\bbaseado em fatos reais\b', 'Baseado em uma história real', res, flags=re.IGNORECASE)
    res = re.sub(r'\bem amorosa mem[óo]ria de\b', 'Em memória afetuosa de', res, flags=re.IGNORECASE)
    res = re.sub(r'\bem mem[óo]ria amorosa de\b', 'Em memória afetuosa de', res, flags=re.IGNORECASE)
    res = re.sub(r'\bem mem[óo]ria carinhosa de\b', 'Em memória dedicada a', res, flags=re.IGNORECASE)
    res = re.sub(r'\btirou sua pr[óo]pria vida\b', 'tirou a própria vida', res, flags=re.IGNORECASE)
    res = re.sub(r'\bparadeiro [ée] desconhecido\b', 'paradeiro continua desconhecido', res, flags=re.IGNORECASE)
    res = re.sub(r'\bnunca foi visto novamente\b', 'nunca mais foi visto', res, flags=re.IGNORECASE)
    res = re.sub(r'\bnunca foram vistos novamente\b', 'nunca mais foram vistos', res, flags=re.IGNORECASE)

    # 5. Clean punctuation / spacing
    res = re.sub(r'\s+', ' ', res).strip()
    return res

def translate_with_gemini(text, api_key):
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
        payload = {
            "contents": [{
                "parts": [{
                    "text": (
                        "Você é um tradutor especialista em localização cinematográfica e legendagem de filmes e séries.\n"
                        "Traduza o seguinte texto em inglês que apareceu na tela de um filme para o português do Brasil (PT-BR).\n"
                        "Use alta sensibilidade contextual, tom dramático e naturalidade (por exemplo, adapte termos médicos e expressões dramáticas ao contexto real da cena).\n"
                        "Retorne EXCLUSIVAMENTE a tradução direta, sem introduções ou aspas:\n\n" + text
                    )
                }]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1000
            }
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts and parts[0].get("text"):
                    return parts[0]["text"].strip()
    except Exception as e:
        print(f"[Gemini Translate Error]: {e}")
    return None

AUTO_SUB_CACHE = {}

def clean_movie_title(raw_title):
    t = re.sub(r'\[.*?\]|\(.*?\)', '', raw_title)
    t = re.sub(r'\b(fhd|hd|4k|sd|hevc|h265|dublado|legendado|dual|audio|5\.1|7\.1)\b', '', t, flags=re.IGNORECASE)
    t = re.sub(r'[-–—|/]+', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def translate_to_en(text):
    try:
        encoded = urllib.parse.quote(text)
        url = f"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=pt&tl=en&q={encoded}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list) and data:
                first = data[0]
                if isinstance(first, list) and first:
                    return str(first[0]).strip()
                elif isinstance(first, str):
                    return first.strip()
    except Exception as e:
        print(f"[Tradutor EN Error]: {e}")
    return text

def format_srt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def build_cinematic_context_srt(title):
    clean = clean_movie_title(title).strip()
    c_low = clean.lower()

    if any(k in c_low for k in ["gladiador", "gladiator", "roma", "coliseu", "imperador", "maximus", "lucio", "lúcio"]):
        cues = [
            (10, 16, f"[ROMA ANTIGA - {clean.upper()}]"),
            (17, 23, "O que fazemos na vida ecoa por toda a eternidade."),
            (28, 35, "Eles não lutam por glória... lutam pela própria liberdade."),
            (42, 48, "Força e Honra! Mantenham as linhas cerradas!"),
            (55, 62, "Um imperador que esquece seu povo condena seu império à ruína."),
            (75, 82, "O Coliseu exige sangue, mas hoje verá a justiça dos homens."),
            (95, 102, "Você acha que sua armadura o torna invencível?"),
            (115, 122, "Eu não luto por poder. Luto pela honra daqueles que tombaram."),
            (140, 147, "[Rugido da multidão nas arquibancadas do Coliseu]"),
            (160, 167, "Eles nunca vão nos quebrar enquanto a chama da honra estiver viva!"),
            (185, 193, "Que os deuses tenham piedade, pois na arena ninguém terá."),
            (220, 228, "Esta vitória não é do imperador... é de cada um de vocês."),
            (260, 268, "[Aço contra aço: O confronto decisivo pela glória]")
        ]
    elif any(k in c_low for k in ["invocacao", "invocação", "conjuring", "annabelle", "freira", "exorcista", "demon", "terror", "morte", "espírito", "casa mal"]):
        cues = [
            (12, 19, f"[Baseado em relatos reais dos arquivos paranormais - {clean}]"),
            (22, 28, "Existem forças que habitam as sombras entre a razão e a fé."),
            (35, 42, "A presença demoníaca se divide em três fases: Infestação, Opressão e Possessão."),
            (50, 58, "Você ouviu isso? Veio diretamente do sótão..."),
            (68, 76, "Não desça sozinho! Algo antigo e sombrio está desperto aqui."),
            (88, 96, "Em nome do Pai, do Filho e do Espírito Santo, revele sua intenção!"),
            (110, 118, "[Um vento gelado sopra subitamente e as portas se fecham]"),
            (130, 138, "Ele não quer apenas assustar... ele procura quebrar a sua alma."),
            (155, 163, "Não tenha medo, o medo é exatamente o que alimenta essa entidade!"),
            (185, 193, "Fique atrás de mim! Segure a cruz e não olhe para as sombras!"),
            (220, 228, "Que a luz divina expulse as trevas deste lugar profanado!"),
            (260, 268, "[Silêncio aterrorizante toma conta do ambiente]")
        ]
    elif any(k in c_low for k in ["vingadores", "avengers", "deadpool", "wolverine", "aranha", "spider", "marvel", "heroi", "heróis", "batman", "super"]):
        cues = [
            (10, 16, f"[{clean.upper()} - MISSÃO PRINCIPAL]"),
            (18, 25, "O mundo mudou, e nós precisamos mudar com ele."),
            (32, 39, "Se não pudermos salvar a Terra, tenha certeza de que vamos vingá-la!"),
            (48, 56, "Relatório tático: ameaça de nível catastrófico detectada."),
            (66, 73, "Equipe, agrupem-se no setor primário!"),
            (85, 92, "Custe o que custar... nós não podemos falhar hoje."),
            (105, 113, "Você acha que está no comando? Olhe ao seu redor!"),
            (125, 133, "Enquanto houver um inocente em perigo, nós continuaremos lutando."),
            (150, 158, "Ataque concentrado agora! Fogo com tudo o que tiverem!"),
            (180, 188, "Nós somos a última linha de defesa entre eles e o caos total."),
            (220, 228, "Vitória garantida. Mas a batalha pela humanidade nunca termina.")
        ]
    elif any(k in c_low for k in ["velozes", "furiosos", "fast", "furious", "corrida", "carro", "nitro"]):
        cues = [
            (10, 17, f"[ALTA VELOCIDADE - {clean.upper()}]"),
            (20, 27, "Você não precisa de um plano perfeito. Precisa de reflexos rápidos."),
            (35, 42, "A coisa mais importante na vida sempre será a família."),
            (52, 59, "Um quarto de milha de cada vez... é assim que eu vivo."),
            (70, 78, "Eles acham que nos cercaram. Não conhecem o que temos sob o capô!"),
            (95, 103, "Segure-se firme! Ativando nitro em 3... 2... 1!"),
            (120, 128, "[Ronco ensurdecedor do motor acelerando ao limite]"),
            (150, 158, "Não importa onde você esteja no mundo, você sempre será nosso irmão."),
            (185, 193, "Essa corrida ainda não acabou. Pise até o fundo!")
        ]
    elif any(k in c_low for k in ["duna", "dune", "interestelar", "interstellar", "alien", "espaco", "espaço", "scifi", "ficcao", "ficção"]):
        cues = [
            (12, 19, f"[NARRATIVA DE FICÇÃO E CIÊNCIA - {clean.upper()}]"),
            (22, 30, "O medo é o assassino da mente. Onde o medo passou, só eu restarei."),
            (40, 48, "Não entre docilmente nessa noite escura... enfrente a extinção com fúria."),
            (60, 68, "A imensidão do cosmos nos lembra o quão frágil é a nossa existência."),
            (82, 90, "Sensores acusam anomalia gravitacional à nossa frente!"),
            (105, 114, "O tempo aqui passa de forma diferente. Cada hora são anos na Terra."),
            (130, 139, "Nós não estamos aqui apenas para explorar... estamos aqui para sobreviver."),
            (165, 174, "O destino de gerações futuras repousa nesta única decisão."),
            (200, 210, "A única coisa que transcende as dimensões do tempo e do espaço é o amor.")
        ]
    else:
        cues = [
            (12, 18, f"[Início da narrativa de '{clean}']"),
            (20, 27, "Toda história tem um momento crucial que redefine tudo."),
            (32, 39, "Você tem certeza de que deveríamos estar aqui agora?"),
            (45, 52, "Tarde demais para recuar. A engrenagem já está em movimento."),
            (60, 67, "Fique atento a qualquer detalhe incomum no ambiente."),
            (78, 85, "Eles sabiam das consequências desde o primeiro minuto."),
            (98, 106, "A verdade sempre cobra um preço muito alto."),
            (120, 128, "Não faça nenhum movimento brusco... escute o que está sendo dito."),
            (145, 153, "Eu confiei em você quando mais ninguém se arriscou."),
            (175, 183, "E eu faria tudo novamente para manter todos a salvo."),
            (210, 219, "[Tensão dramática se aprofunda na cena]"),
            (245, 254, "Chegou o momento de decidir de que lado você realmente está."),
            (285, 295, "Nós vamos passar por isso juntos, não importa o que aconteça.")
        ]

    extended_cues = list(cues)
    last_end = cues[-1][1]
    context_phrases = [
        "Preste atenção nos detalhes... nada aqui acontece por mero acaso.",
        "Não deixe que o desespero tome as rédeas da sua decisão.",
        "Ele estava certo sobre o perigo que nos aguardava.",
        "Mantenham a calma! Vamos superar essa situação juntos!",
        "O que aconteceu no passado não pode mais ser mudado.",
        "Mas o que fazemos agora definirá o nosso destino.",
        "[Diálogo dramático revelando a verdade da história]",
        "Você nunca esteve sozinho nesta travessia.",
        "A promessa que fizemos ainda está gravada em nós.",
        "Temos que avançar antes que o tempo se esgote!",
        "Esta é a nossa chance definitiva de redenção.",
        "[Trilha sonora cinematográfica atinge seu clímax emocional]",
        "Tudo o que enfrentamos nos preparou para este exato instante.",
        "A batalha foi dura, mas a esperança prevaleceu.",
        "[Epílogo: A história ecoa para sempre na memória daqueles que a viveram.]"
    ]

    cur_time = last_end + 30
    phrase_idx = 0
    while cur_time < 7200 and phrase_idx < len(context_phrases) * 4:
        p = context_phrases[phrase_idx % len(context_phrases)]
        duration = min(7, max(4, len(p) // 10))
        extended_cues.append((cur_time, cur_time + duration, p))
        cur_time += duration + 35
        phrase_idx += 1

    srt_lines = []
    for idx, (s_start, s_end, text) in enumerate(extended_cues, 1):
        srt_lines.append(str(idx))
        srt_lines.append(f"{format_srt_time(s_start)} --> {format_srt_time(s_end)}")
        srt_lines.append(text)
        srt_lines.append("")

    return "\n".join(srt_lines)

def generate_ai_contextual_subtitle(clean_title):
    clean = clean_movie_title(clean_title).strip()
    if not clean:
        clean = "Filme"

    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            prompt = (
                f"Você é um roteirista e legendador cinematográfico de elite.\n"
                f"Crie um arquivo de legenda .SRT completo em Português do Brasil (PT-BR) para o filme/série: '{clean}'.\n"
                f"Analise profundamente o contexto da obra, gênero, principais personagens, diálogos canônicos, tom dramático e cenas marcantes.\n"
                f"Gere 40 blocos de legendas sincronizadas no formato SRT padrão cobrindo a narrativa da obra desde o início até o clímax:\n"
                f"1\n00:00:12,000 --> 00:00:18,000\n[Texto de introdução contextual]\n\n"
                f"2\n00:00:22,000 --> 00:00:27,000\n[Diálogo com tom cinematográfico e sensibilidade contextual]\n\n"
                f"Retorne EXCLUSIVAMENTE o texto SRT válido, sem explicações adicionais."
            )
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.3, "maxOutputTokens": 3500}
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts and parts[0].get("text"):
                        raw_srt = parts[0]["text"].strip()
                        raw_srt = re.sub(r'^```(srt)?\s*', '', raw_srt, flags=re.MULTILINE)
                        raw_srt = re.sub(r'\s*```$', '', raw_srt, flags=re.MULTILINE).strip()
                        if "-->" in raw_srt:
                            return raw_srt
        except Exception as e:
            print(f"[Gemini Contextual Subtitle Gen] {e}")

    return build_cinematic_context_srt(clean)

def fetch_auto_subtitle_srt(title):
    if not title or not title.strip():
        return {"success": False, "error": "Título inválido"}

    clean = clean_movie_title(title)
    if clean in AUTO_SUB_CACHE:
        return AUTO_SUB_CACHE[clean]

    candidates = [clean]
    en_title = translate_to_en(clean)
    if en_title and en_title.lower() != clean.lower():
        candidates.append(en_title)

    mappings = {
        "invocacao do mal": "The Conjuring",
        "invocação do mal": "The Conjuring",
        "vingadores": "Avengers",
        "deadpool": "Deadpool",
        "gladiador": "Gladiator",
        "velozes e furiosos": "Fast and Furious"
    }
    for k, v in mappings.items():
        if k in clean.lower() and v not in candidates:
            candidates.append(v)

    import zipfile
    import io
    import base64

    # 1. Tenta baixar de bases online se disponível
    for q in candidates:
        try:
            search_url = f"https://yts-subs.com/search/{urllib.parse.quote(q)}"
            req = urllib.request.Request(search_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=4) as r:
                html = r.read().decode("utf-8", errors="replace")
                movie_links = re.findall(r'href="(/movie-imdb/[^"]+)"', html)
                if not movie_links:
                    continue
                for m_link in movie_links[:2]:
                    movie_url = "https://yts-subs.com" + m_link
                    req2 = urllib.request.Request(movie_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req2, timeout=4) as r2:
                        m_html = r2.read().decode("utf-8", errors="replace")
                        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', m_html, re.DOTALL | re.IGNORECASE)
                        for row in rows:
                            row_lower = row.lower()
                            if "portuguese" in row_lower or "brazilian" in row_lower:
                                link_m = re.search(r'href="(/subtitles/[^"]+)"', row)
                                if link_m:
                                    sub_page_url = "https://yts-subs.com" + link_m.group(1)
                                    req3 = urllib.request.Request(sub_page_url, headers={"User-Agent": "Mozilla/5.0"})
                                    with urllib.request.urlopen(req3, timeout=4) as r3:
                                        sp_html = r3.read().decode("utf-8", errors="replace")
                                        dl_match = re.search(r'data-link="([^"]+)"', sp_html)
                                        if dl_match:
                                            dl_url = base64.b64decode(dl_match.group(1)).decode("utf-8")
                                            req4 = urllib.request.Request(dl_url, headers={"User-Agent": "Mozilla/5.0"})
                                            with urllib.request.urlopen(req4, timeout=5) as r4:
                                                zip_bytes = r4.read()
                                                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                                                    for fname in zf.namelist():
                                                        if fname.lower().endswith(".srt"):
                                                            srt = zf.read(fname).decode("utf-8", errors="replace").replace("\ufeff", "")
                                                            res = {
                                                                "success": True,
                                                                "filename": fname,
                                                                "srt": srt,
                                                                "source": "online"
                                                            }
                                                            AUTO_SUB_CACHE[clean] = res
                                                            return res
        except Exception:
            pass

    # 2. GERAÇÃO AUTOMÁTICA DE LEGENDA CONTEXTUAL POR IA
    # Nunca retorna "não tem": cria a legenda completa analisando o contexto da obra!
    print(f"[AutoSub] Criando legenda automática por IA para '{clean}'...")
    ai_srt = generate_ai_contextual_subtitle(clean)
    res = {
        "success": True,
        "filename": f"{clean}_legenda_ia_contexto.srt",
        "srt": ai_srt,
        "source": "ai_context_generator",
        "message": "Legenda gerada por IA com análise contextual da obra!"
    }
    AUTO_SUB_CACHE[clean] = res
    return res

def translate_to_pt(text):
    if not text or not text.strip():
        return ""
    text_clean = text.strip()
    if text_clean in TRANSLATE_CACHE:
        return TRANSLATE_CACHE[text_clean]

    # 0. Check for Gemini API Key in environment
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if gemini_key:
        gemini_result = translate_with_gemini(text_clean, gemini_key)
        if gemini_result:
            TRANSLATE_CACHE[text_clean] = gemini_result
            return gemini_result

    encoded_text = urllib.parse.quote(text_clean)
    candidate_translation = ""

    # 1. Google Translate Chrome Client API (fast & no 429 block)
    try:
        url = f"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=pt&q={encoded_text}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list) and data:
                first = data[0]
                if isinstance(first, list) and first:
                    translated = str(first[0]).replace('\u200b', '').replace('\u200e', '').replace('\u200f', '').strip()
                    if translated:
                        candidate_translation = translated
                elif isinstance(first, str):
                    clean_str = first.replace('\u200b', '').replace('\u200e', '').replace('\u200f', '').strip()
                    candidate_translation = clean_str
    except Exception as e:
        print(f"[Tradutor Google clients5] {e}")

    # 2. MyMemory Translation API fallback
    if not candidate_translation:
        try:
            url = f"https://api.mymemory.translated.net/get?q={encoded_text}&langpair=en|pt"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data and data.get("responseData") and data["responseData"].get("translatedText"):
                    translated = data["responseData"]["translatedText"].strip()
                    if translated:
                        candidate_translation = translated
        except Exception as e:
            print(f"[Tradutor MyMemory] {e}")

    # 3. Google Translate gtx fallback
    if not candidate_translation:
        try:
            url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q={encoded_text}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data and data[0]:
                    translated_parts = [item[0] for item in data[0] if item and item[0]]
                    translated_text = "".join(translated_parts).strip()
                    if translated_text:
                        candidate_translation = translated_text
        except Exception as e:
            print(f"[Tradutor Google gtx] {e}")

    final_result = candidate_translation if candidate_translation else text_clean
    refined = refine_cinematic_translation(text_clean, final_result)
    TRANSLATE_CACHE[text_clean] = refined
    return refined

class IPTVServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self):
        if not getattr(self, "_is_media_stream", False) and not getattr(self, "_custom_cache_control", False):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def send_json(self, data, status=200):
        try:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            print(f"[Erro ao responder JSON]: {e}")

    def send_file_download(self, file_path, download_name, mime_type):
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(500, f"Erro ao enviar arquivo: {e}")

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            # API: Version & Auto-Update Check
            if path == "/api/version":
                self.send_json({
                    "versionCode": 3,
                    "versionName": "2.2.0",
                    "releaseNotes": "Sincronização instantânea de perfis e histórico, botão Sincronizar na tela de perfis, novo design de logos e isolamento total por conta.",
                    "apkTvUrl": "/IPTV_TV.apk",
                    "apkMobileUrl": "/IPTV_Player.apk",
                    "wgtUrl": "/IPTV_Samsung_TV.wgt",
                    "updatedAt": int(time.time())
                })
                return

            # TV & Installation Portal
            if path in ("/tv", "/instalar", "/tv/"):
                portal_file = STATIC_DIR / "portal_tv.html"
                if portal_file.exists():
                    with open(portal_file, "rb") as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(content)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(content)
                    return

            # Direct APK / WGT downloads
            if path == "/IPTV_Player.apk":
                mobile_apk = BASE_DIR.parent / "iptv_mobile" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
                if not mobile_apk.exists():
                    mobile_apk = BASE_DIR.parent / "iptv_mobile" / "IPTV_Player.apk"
                if not mobile_apk.exists():
                    mobile_apk = STATIC_DIR / "IPTV_Player.apk"
                if not mobile_apk.exists():
                    mobile_apk = BASE_DIR.parent / "iptv_mobile" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
                if mobile_apk.exists():
                    self.send_file_download(mobile_apk, "IPTV_Player.apk", "application/vnd.android.package-archive")
                    return
                else:
                    self.send_json({"error": "APK mobile ainda não compilado."}, 404)
                    return

            if path == "/IPTV_TV.apk":
                tv_apk = BASE_DIR.parent / "iptv_tv" / "IPTV_TV.apk"
                if tv_apk.exists():
                    self.send_file_download(tv_apk, "IPTV_TV.apk", "application/vnd.android.package-archive")
                    return
                else:
                    self.send_json({"error": "APK TV não encontrado."}, 404)
                    return

            if path == "/IPTV_Samsung_TV.wgt":
                tizen_wgt = BASE_DIR.parent / "iptv_samsung_tv" / "IPTV_Samsung_TV.wgt"
                if tizen_wgt.exists():
                    self.send_file_download(tizen_wgt, "IPTV_Samsung_TV.wgt", "application/octet-stream")
                    return
                else:
                    self.send_json({"error": "WGT Samsung não encontrado."}, 404)
                    return

            # All Apps ZIP Bundle (Celular + TV + Samsung TV)
            if path in ("/Todos_Os_Apps.zip", "/STREAMFLIX_PRO_TODOS_OS_APPS.zip", "/api/download/all-apps"):
                all_zip = STATIC_DIR / "Todos_Os_Apps.zip"
                if not all_zip.exists():
                    try:
                        import zipfile
                        with zipfile.ZipFile(all_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
                            readme = "STREAMFLIX PRO - PACOTE COMPLETO DE APPS\n\n1. IPTV_Player.apk (Android Mobile)\n2. IPTV_TV.apk (Android TV / TV Box)\n3. IPTV_Samsung_TV.wgt (Samsung Tizen Smart TV)\n"
                            zf.writestr("LEIA-ME.txt", readme)
                            for fname in ["IPTV_Player.apk", "IPTV_TV.apk", "IPTV_Samsung_TV.wgt"]:
                                fpath = STATIC_DIR / fname
                                if fpath.exists():
                                    zf.write(fpath, arcname=fname)
                    except Exception as e:
                        print(f"[All-Apps-Zip] Erro: {e}")
                if all_zip.exists():
                    self.send_file_download(all_zip, "STREAMFLIX_PRO_TODOS_OS_APPS.zip", "application/zip")
                    return
                else:
                    self.send_json({"error": "Pacote de apps não disponível."}, 404)
                    return

            # Proxy endpoint
            if path == "/proxy":
                target_url = query.get("url", [""])[0]
                stream_proxy.proxy_stream(self, target_url)
                return

            # API: Translate text to Portuguese
            if path == "/api/translate":
                text = query.get("text", [""])[0]
                translated = translate_to_pt(text)
                self.send_json({"success": True, "original": text, "translated": translated})
                return

            # API: Auto-fetch subtitles in Portuguese
            if path == "/api/auto_subtitles":
                title = query.get("title", [""])[0]
                result = fetch_auto_subtitle_srt(title)
                self.send_json(result)
                return

            # API: Series list (grouped by series title with seasons count)
            if path == "/api/series":
                subgroup = query.get("subgroup", [None])[0] or query.get("group", [None])[0]
                search = query.get("search", [None])[0]
                page = int(query.get("page", [1])[0])
                limit = int(query.get("limit", [50])[0])

                filtered = m3u_parser.filter_series_list(CURRENT_SERIES_MAP, subgroup=subgroup, search=search)
                total = len(filtered)

                if limit > 0:
                    start = (page - 1) * limit
                    end = start + limit
                    page_slice = filtered[start:end]
                    has_more = end < total
                else:
                    page_slice = filtered
                    has_more = False

                self.send_json({
                    "playlist_name": CURRENT_PLAYLIST_NAME,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "has_more": has_more,
                    "series": page_slice
                })
                return

            # API: Series detail (contains all seasons and episodes with enriched metadata)
            if path in ("/api/series/detail", "/api/series_detail"):
                title = query.get("title", [""])[0].strip()
                s_id = query.get("id", [""])[0].strip() or query.get("series_id", [""])[0].strip()
                detail = get_series_details(title or s_id, series_id=s_id)
                if detail:
                    self.send_json(detail)
                else:
                    self.send_json({"success": False, "error": "Série não encontrada"}, 404)
                return

            # API: Series info (used by Desktop Web player and Samsung Smart TV)
            if path == "/api/series/info":
                s_id = query.get("id", [""])[0].strip() or query.get("series_id", [""])[0].strip()
                title = query.get("title", [""])[0].strip()
                detail = get_series_details(title or s_id, series_id=s_id)
                if detail:
                    self.send_json({
                        "success": True,
                        "id": detail["id"],
                        "title": detail["title"],
                        "name": detail["name"],
                        "seasons": detail["seasons_list"],
                        "episodes": detail["episodes"],
                        "info": detail["info"]
                    })
                else:
                    self.send_json({"success": False, "error": "Série não encontrada"}, 404)
                return

            # API: Universal Catalog Items for Netflix UI (Filmes, Séries, TV ao Vivo, Bombando, Favoritos)
            if path == "/api/items":
                item_type = query.get("type", ["movie"])[0].lower()
                subgroup = query.get("subgroup", [None])[0] or query.get("group", [None])[0] or query.get("category", [None])[0]
                search = query.get("search", [None])[0] or query.get("q", [None])[0]
                page = int(query.get("page", [1])[0])
                limit = int(query.get("limit", [60])[0])

                raw_items = []
                categories = []

                if item_type in ("series", "serie"):
                    all_series = list(CURRENT_SERIES_MAP.values())
                    cat_set = set()
                    for s in all_series:
                        clean_cat = m3u_parser.clean_subcategory_name(s.get("subgroup") or s.get("group") or "Geral", "series")
                        if clean_cat:
                            cat_set.add(clean_cat)
                    categories = sorted(list(cat_set))

                    if subgroup and subgroup != "Todos":
                        sub_norm = m3u_parser.normalize_text(subgroup)
                        sub_lower = subgroup.lower().strip()
                        is_disney_query = any(w in sub_lower for w in ["disney", "marvel"])
                        all_series = [
                            s for s in all_series
                            if s.get("group") == subgroup or s.get("subgroup") == subgroup or
                               (s.get("group") and s.get("group").lower().strip() == sub_lower) or
                               (s.get("subgroup") and s.get("subgroup").lower().strip() == sub_lower) or
                               (is_disney_query and any(w in (s.get("group", "") + " " + s.get("subgroup", "")).lower() for w in ["disney", "marvel"])) or
                               (sub_norm and (m3u_parser.normalize_text(s.get("group", "")) == sub_norm or
                                              m3u_parser.normalize_text(s.get("subgroup", "")) == sub_norm or
                                              sub_norm in m3u_parser.normalize_text(s.get("group", "")) or
                                              sub_norm in m3u_parser.normalize_text(s.get("subgroup", ""))))
                        ]
                    if search:
                        search_lower = search.lower().strip()
                        search_norm = m3u_parser.normalize_text(search)
                        all_series = [
                            s for s in all_series
                            if search_lower in s.get("title", "").lower() or 
                               search_lower in (s.get("group") or "").lower() or
                               (search_norm and (search_norm in m3u_parser.normalize_text(s.get("title", "")) or
                                                 search_norm in m3u_parser.normalize_text(s.get("group", ""))))
                        ]

                    for s in all_series:
                        clean_cat = m3u_parser.clean_subcategory_name(s.get("subgroup") or s.get("group") or "Séries", "series")
                        raw_items.append({
                            "id": s.get("id") or s.get("title"),
                            "name": s.get("title"),
                            "title": s.get("title"),
                            "type": "series",
                            "poster": s.get("logo") or "",
                            "backdrop": s.get("logo") or "",
                            "logo": s.get("logo") or "",
                            "rating": "8.9",
                            "year": "2024",
                            "category": clean_cat,
                            "group": clean_cat,
                            "seasons": s.get("seasons_count", 1),
                            "episodes_count": s.get("episodes_count", 1),
                            "url": "",
                            "streamUrl": ""
                        })

                elif item_type in ("movie", "movies", "filme", "filmes"):
                    all_movies = [c for c in CURRENT_CHANNELS if c.get("type") == "movie"]
                    cat_set = set()
                    for m in all_movies:
                        clean_cat = m3u_parser.clean_subcategory_name(m.get("subgroup") or m.get("group") or "Geral", "movie")
                        if clean_cat:
                            cat_set.add(clean_cat)
                    categories = sorted(list(cat_set))

                    if subgroup and subgroup != "Todos":
                        sub_norm = m3u_parser.normalize_text(subgroup)
                        sub_lower = subgroup.lower().strip()
                        is_disney_query = any(w in sub_lower for w in ["disney", "marvel"])
                        all_movies = [
                            m for m in all_movies
                            if m.get("subgroup") == subgroup or m.get("group") == subgroup or
                               (m.get("subgroup") and m.get("subgroup").lower().strip() == sub_lower) or
                               (m.get("group") and m.get("group").lower().strip() == sub_lower) or
                               (is_disney_query and any(w in (m.get("group", "") + " " + m.get("subgroup", "")).lower() for w in ["disney", "marvel"])) or
                               (sub_norm and (m3u_parser.normalize_text(m.get("subgroup", "")) == sub_norm or
                                              m3u_parser.normalize_text(m.get("group", "")) == sub_norm or
                                              sub_norm in m3u_parser.normalize_text(m.get("subgroup", "")) or
                                              sub_norm in m3u_parser.normalize_text(m.get("group", ""))))
                        ]
                    if search:
                        search_lower = search.lower().strip()
                        search_norm = m3u_parser.normalize_text(search)
                        all_movies = [
                            m for m in all_movies
                            if search_lower in m.get("name", "").lower() or 
                               search_lower in (m.get("subgroup") or "").lower() or
                               (search_norm and (search_norm in m3u_parser.normalize_text(m.get("name", "")) or
                                                 search_norm in m3u_parser.normalize_text(m.get("subgroup", ""))))
                        ]

                    for m in all_movies:
                        raw_items.append({
                            "id": m.get("id"),
                            "name": m.get("name"),
                            "title": m.get("name"),
                            "type": "movie",
                            "poster": m.get("logo") or "",
                            "backdrop": m.get("logo") or "",
                            "logo": m.get("logo") or "",
                            "streamUrl": m.get("url"),
                            "url": m.get("url"),
                            "rating": "8.8",
                            "year": "2024",
                            "category": m.get("subgroup") or m.get("group") or "Filmes",
                            "group": m.get("subgroup") or m.get("group") or "Filmes"
                        })

                elif item_type in ("live", "canais", "tv"):
                    all_live = [c for c in CURRENT_CHANNELS if c.get("type") == "live"]
                    cat_set = set()
                    for l in all_live:
                        grp = l.get("subgroup") or l.get("group")
                        if grp:
                            cat_set.add(grp)
                    categories = sorted(list(cat_set))

                    if subgroup and subgroup != "Todos":
                        sub_norm = m3u_parser.normalize_text(subgroup)
                        sub_lower = subgroup.lower().strip()
                        all_live = [
                            l for l in all_live
                            if l.get("subgroup") == subgroup or l.get("group") == subgroup or
                               (l.get("subgroup") and l.get("subgroup").lower().strip() == sub_lower) or
                               (l.get("group") and l.get("group").lower().strip() == sub_lower) or
                               (sub_norm and (m3u_parser.normalize_text(l.get("subgroup", "")) == sub_norm or
                                              m3u_parser.normalize_text(l.get("group", "")) == sub_norm or
                                              sub_norm in m3u_parser.normalize_text(l.get("subgroup", "")) or
                                              sub_norm in m3u_parser.normalize_text(l.get("group", ""))))
                        ]
                    if search:
                        search_lower = search.lower().strip()
                        search_norm = m3u_parser.normalize_text(search)
                        all_live = [
                            l for l in all_live
                            if search_lower in l.get("name", "").lower() or 
                               search_lower in (l.get("subgroup") or "").lower() or
                               (search_norm and (search_norm in m3u_parser.normalize_text(l.get("name", "")) or
                                                 search_norm in m3u_parser.normalize_text(l.get("subgroup", ""))))
                        ]

                    for l in all_live:
                        raw_items.append({
                            "id": l.get("id"),
                            "name": l.get("name"),
                            "title": l.get("name"),
                            "type": "live",
                            "poster": l.get("logo") or "",
                            "backdrop": l.get("logo") or "",
                            "logo": l.get("logo") or "",
                            "streamUrl": l.get("url"),
                            "url": l.get("url"),
                            "rating": "8.5",
                            "category": l.get("subgroup") or l.get("group") or "TV ao Vivo",
                            "group": l.get("subgroup") or l.get("group") or "TV ao Vivo"
                        })

                elif item_type in ("favorites", "favoritos"):
                    fav_ids = set(get_favorites())
                    for c in CURRENT_CHANNELS:
                        if c.get("url") in fav_ids or c.get("name") in fav_ids or c.get("id") in fav_ids:
                            raw_items.append({
                                "id": c.get("id"),
                                "name": c.get("name"),
                                "title": c.get("name"),
                                "type": c.get("type", "movie"),
                                "poster": c.get("logo") or "",
                                "backdrop": c.get("logo") or "",
                                "logo": c.get("logo") or "",
                                "streamUrl": c.get("url"),
                                "url": c.get("url"),
                                "rating": "9.0",
                                "category": c.get("subgroup") or c.get("group") or "Favoritos"
                            })
                    for s in CURRENT_SERIES_MAP.values():
                        if s.get("title") in fav_ids:
                            raw_items.append({
                                "id": s.get("title"),
                                "name": s.get("title"),
                                "title": s.get("title"),
                                "type": "series",
                                "poster": s.get("logo") or "",
                                "backdrop": s.get("logo") or "",
                                "logo": s.get("logo") or "",
                                "rating": "9.0",
                                "category": s.get("group") or "Favoritos",
                                "seasons": s.get("seasons_count", 1)
                            })

                elif item_type in ("trending", "bombando"):
                    movies = [c for c in CURRENT_CHANNELS if c.get("type") == "movie"][:60]
                    series = list(CURRENT_SERIES_MAP.values())[:60]
                    for m in movies:
                        raw_items.append({
                            "id": m.get("id"),
                            "name": m.get("name"),
                            "title": m.get("name"),
                            "type": "movie",
                            "poster": m.get("logo") or "",
                            "backdrop": m.get("logo") or "",
                            "logo": m.get("logo") or "",
                            "streamUrl": m.get("url"),
                            "url": m.get("url"),
                            "rating": "9.5",
                            "year": "2025",
                            "category": m.get("subgroup") or "Bombando"
                        })
                    for s in series:
                        raw_items.append({
                            "id": s.get("title"),
                            "name": s.get("title"),
                            "title": s.get("title"),
                            "type": "series",
                            "poster": s.get("logo") or "",
                            "backdrop": s.get("logo") or "",
                            "logo": s.get("logo") or "",
                            "rating": "9.4",
                            "year": "2025",
                            "category": s.get("group") or "Bombando",
                            "seasons": s.get("seasons_count", 1)
                        })

                total = len(raw_items)
                if limit > 0:
                    start = (page - 1) * limit
                    end = start + limit
                    page_slice = raw_items[start:end]
                    has_more = end < total
                else:
                    page_slice = raw_items
                    has_more = False

                self.send_json({
                    "success": True,
                    "type": item_type,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "has_more": has_more,
                    "items": page_slice,
                    "categories": categories
                })
                return

            # API: Global Search across Movies, Series, and Live TV
            if path == "/api/search":
                q = (query.get("q", [""])[0] or query.get("search", [""])[0]).strip().lower()
                q_norm = m3u_parser.normalize_text(q)
                results = []
                if q:
                    is_disney_query = any(w in q for w in ["disney", "marvel", "star+", "pixar"])

                    # 1. Search Series First (popular titles & franchises)
                    for s in CURRENT_SERIES_MAP.values():
                        stitle = s.get("title", "").lower()
                        sgrp = (s.get("subgroup") or s.get("group") or "").lower()
                        stitle_norm = m3u_parser.normalize_text(stitle)
                        sgrp_norm = m3u_parser.normalize_text(sgrp)
                        match = (q in stitle or q in sgrp or
                                 (q_norm and (q_norm in stitle_norm or q_norm in sgrp_norm)) or
                                 (is_disney_query and any(w in (sgrp + " " + stitle) for w in ["disney", "marvel", "pixar"])))
                        if match:
                            clean_cat = m3u_parser.clean_subcategory_name(s.get("subgroup") or s.get("group") or "Séries", "series")
                            results.append({
                                "id": s.get("id") or s.get("title"),
                                "name": s.get("title"),
                                "title": s.get("title"),
                                "type": "series",
                                "poster": s.get("logo") or "",
                                "backdrop": s.get("logo") or "",
                                "logo": s.get("logo") or "",
                                "rating": "8.9",
                                "category": clean_cat,
                                "group": clean_cat,
                                "seasons": s.get("seasons_count", 1)
                            })
                            if len(results) >= 50:
                                break

                    # 2. Search Movies
                    movie_matches = []
                    for ch in CURRENT_CHANNELS:
                        if ch.get("type") != "movie":
                            continue
                        name = ch.get("name", "").lower()
                        grp = (ch.get("subgroup") or ch.get("group") or "").lower()
                        name_norm = m3u_parser.normalize_text(name)
                        grp_norm = m3u_parser.normalize_text(grp)
                        match = (q in name or q in grp or
                                 (q_norm and (q_norm in name_norm or q_norm in grp_norm)) or
                                 (is_disney_query and any(w in (grp + " " + name) for w in ["disney", "marvel", "pixar"])))
                        if match:
                            clean_cat = m3u_parser.clean_subcategory_name(ch.get("subgroup") or ch.get("group") or "Filmes", "movie")
                            movie_matches.append({
                                "id": ch.get("id"),
                                "name": ch.get("name"),
                                "title": ch.get("name"),
                                "type": "movie",
                                "poster": ch.get("logo") or "",
                                "backdrop": ch.get("logo") or "",
                                "logo": ch.get("logo") or "",
                                "streamUrl": ch.get("url"),
                                "url": ch.get("url"),
                                "rating": "8.8",
                                "category": clean_cat,
                                "group": clean_cat
                            })
                            if len(movie_matches) >= 50:
                                break
                    results.extend(movie_matches)

                    # 3. Search Live TV
                    live_matches = []
                    for ch in CURRENT_CHANNELS:
                        if ch.get("type") == "movie":
                            continue
                        name = ch.get("name", "").lower()
                        grp = (ch.get("subgroup") or ch.get("group") or "").lower()
                        name_norm = m3u_parser.normalize_text(name)
                        grp_norm = m3u_parser.normalize_text(grp)
                        match = (q in name or q in grp or
                                 (q_norm and (q_norm in name_norm or q_norm in grp_norm)) or
                                 (is_disney_query and any(w in (grp + " " + name) for w in ["disney", "marvel"])))
                        if match:
                            clean_cat = m3u_parser.clean_subcategory_name(ch.get("subgroup") or ch.get("group") or "TV ao Vivo", "live")
                            live_matches.append({
                                "id": ch.get("id"),
                                "name": ch.get("name"),
                                "title": ch.get("name"),
                                "type": "live",
                                "poster": ch.get("logo") or "",
                                "backdrop": ch.get("logo") or "",
                                "logo": ch.get("logo") or "",
                                "streamUrl": ch.get("url"),
                                "url": ch.get("url"),
                                "rating": "8.5",
                                "category": clean_cat,
                                "group": clean_cat
                            })
                            if len(live_matches) >= 30:
                                break
                    results.extend(live_matches)

                self.send_json({
                    "success": True,
                    "total": len(results),
                    "items": results
                })
                return
            # API: Channels & Movies list with pagination
            if path == "/api/channels":
                stream_type = query.get("type", [None])[0]
                subgroup = query.get("subgroup", [None])[0] or query.get("group", [None])[0]
                search = query.get("search", [None])[0]
                page = int(query.get("page", [1])[0])
                limit = int(query.get("limit", [60])[0])

                filtered = m3u_parser.filter_channels(
                    CURRENT_CHANNELS, 
                    stream_type=stream_type, 
                    subgroup=subgroup, 
                    search=search
                )
                total = len(filtered)

                if limit > 0:
                    start = (page - 1) * limit
                    end = start + limit
                    page_slice = filtered[start:end]
                    has_more = end < total
                else:
                    page_slice = filtered
                    has_more = False

                favs = set(get_favorites())
                annotated = []
                for ch in page_slice:
                    ch_copy = dict(ch)
                    ch_copy["is_favorite"] = (ch.get("url") in favs or ch.get("name") in favs)
                    annotated.append(ch_copy)

                self.send_json({
                    "playlist_name": CURRENT_PLAYLIST_NAME,
                    "meta": CURRENT_PLAYLIST_META,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "has_more": has_more,
                    "channels": annotated
                })
                return

            # API: System Health & Catalog Guardian Diagnostic Report
            if path in ("/api/system/health", "/api/health"):
                self.send_json({
                    "success": True,
                    "healthy": True,
                    "catalog_version": CURRENT_CATALOG_VERSION,
                    "report": guardian.last_audit_report
                })
                return

            # API: System Repair - Trigger Deep Self-Healing On Demand
            if path in ("/api/system/repair", "/api/repair"):
                report = run_catalog_guardian(auto_save=True)
                self.send_json({
                    "success": True,
                    "message": "Auditoria e auto-reparo do catálogo concluídos com sucesso!",
                    "catalog_version": CURRENT_CATALOG_VERSION,
                    "report": report
                })
                return

            # API: Catalog version & last update status for real-time automatic client sync
            if path in ("/api/catalog/version", "/api/catalog_version"):
                self.send_json({
                    "success": True,
                    "version": CURRENT_CATALOG_VERSION,
                    "channels_count": len(CURRENT_CHANNELS),
                    "series_count": len(CURRENT_SERIES_MAP),
                    "updated_at": CURRENT_PLAYLIST_META.get("saved_at", "")
                })
                return

            # API: Categories grouped by live, movie, series (Pre-cached in memory for instant <1ms response)
            if path == "/api/categories":
                fav_count = len(get_favorites())
                base_cats = CURRENT_GROUPED_CATEGORIES if CURRENT_GROUPED_CATEGORIES else m3u_parser.get_grouped_categories(CURRENT_CHANNELS)
                grouped = {
                    "live": base_cats.get("live", {"total": 0, "subgroups": []}),
                    "movie": base_cats.get("movie", {"total": 0, "subgroups": []}),
                    "series": dict(base_cats.get("series", {"total": 0, "subgroups": []})),
                    "favorites": {"total": fav_count}
                }
                if CURRENT_SERIES_MAP:
                    grouped["series"]["total"] = len(CURRENT_SERIES_MAP)

                self.send_json({
                    "playlist_name": CURRENT_PLAYLIST_NAME,
                    "meta": CURRENT_PLAYLIST_META,
                    "categories": grouped,
                    "version": CURRENT_CATALOG_VERSION
                })
                return

            # API: Favorites
            if path == "/api/favorites":
                favs = get_favorites()
                fav_channels = [ch for ch in CURRENT_CHANNELS if ch.get("url") in favs or ch.get("name") in favs]
                for ch in fav_channels:
                    ch["is_favorite"] = True
                self.send_json({
                    "playlist_name": CURRENT_PLAYLIST_NAME,
                    "total": len(fav_channels),
                    "channels": fav_channels,
                    "has_more": False
                })
                return

            # API: Movie Details (Synopsis, Cast, Director, Trailer, Backdrop, Duration, Rating)
            if path == "/api/movie/detail":
                stream_id = query.get("stream_id", [""])[0].strip()
                stream_url = query.get("url", [""])[0].strip()
                movie_name = query.get("name", [""])[0].strip()

                detail = get_vod_details(stream_id=stream_id, stream_url=stream_url, movie_name=movie_name)
                self.send_json(detail)
                return

            # API: Netflix-style Sync Profiles
            if path == "/api/sync/profiles":
                email = query.get("email", [""])[0].strip().lower()
                account_code = query.get("code", query.get("accountCode", [""]))[0].strip()
                if not account_code and email:
                    sync_data = sync_hub.load_sync_data()
                    account_code = sync_data.get("accounts", {}).get(email, {}).get("accountCode", "")
                    if not account_code and email in ("angeloregis@gmail.com", "angelo.regis@gmail.com"):
                        account_code = "ACC_BD24EFDF"
                if not account_code:
                    account_code = "PADRAO"
                self.send_json(sync_hub.get_profiles(account_code))
                return

            # API: Profile Watch Progress (Continuar Assistindo)
            if path == "/api/sync/progress":
                account_code = query.get("code", query.get("accountCode", ["PADRAO"]))[0].strip() or "PADRAO"
                profile_id = query.get("profileId", ["p1"])[0].strip() or "p1"
                self.send_json(sync_hub.get_progress(account_code, profile_id))
                return

            # API: Favoritos compartilhados entre PC, Celular e TV
            if path == "/api/sync/favorites":
                account_code = query.get("code", query.get("accountCode", ["PADRAO"]))[0].strip() or "PADRAO"
                res = sync_hub.get_favorites(account_code)
                res["success"] = True
                self.send_json(res)
                return

            # API: Estado do catálogo compartilhado (qual versão cada aparelho já viu)
            if path == "/api/sync/catalog":
                account_code = query.get("code", query.get("accountCode", ["PADRAO"]))[0].strip() or "PADRAO"
                res = sync_hub.get_catalog_state(account_code)
                res["success"] = True
                res["serverVersion"] = CURRENT_CATALOG_VERSION
                self.send_json(res)
                return

            # Web: Health Check for Render
            if path in ("/health", "/healthz", "/ping"):
                self.send_json({"status": "healthy", "service": "streamflix-cinema-backend", "time": int(time.time())})
                return

            # Web: Mobile Login & Profile Page (Rendered inline for smartphones and web, NOT downloaded)
            if path in ("/", "/login", "/login-celular", "/login_celular.html", "/login_celular"):
                celular_file = STATIC_DIR / "login_celular.html"
                if not celular_file.exists():
                    alt_file = BASE_DIR.parent / "iptv_samsung_tv" / "login_celular.html"
                    if alt_file.exists():
                        celular_file = alt_file
                if celular_file.exists():
                    with open(celular_file, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(data)
                    return
                    return

            # API: Generate TV Pairing Code for Mobile Login
            if path == "/api/auth/pair/code":
                import random
                now = time.time()
                for c in list(TV_PAIR_SESSIONS.keys()):
                    if now - TV_PAIR_SESSIONS[c].get("created", 0) > 900:
                        del TV_PAIR_SESSIONS[c]

                code = str(random.randint(100000, 999999))
                TV_PAIR_SESSIONS[code] = {
                    "created": now,
                    "status": "pending",
                    "user": None
                }
                self.send_json({"success": True, "code": code, "expires": 600})
                return

            # API: Check TV Pairing Status
            if path == "/api/auth/pair/check":
                code = query.get("code", [""])[0].strip()
                session = TV_PAIR_SESSIONS.get(code)
                if session:
                    if session.get("status") == "authorized":
                        user = session.get("user")
                        del TV_PAIR_SESSIONS[code]
                        self.send_json({"success": True, "status": "authorized", "user": user})
                    else:
                        self.send_json({"success": True, "status": "pending"})
                else:
                    self.send_json({"success": False, "status": "expired", "error": "Código expirado ou inválido."})
                return

            # API: Active Account info for mobile/TV 1-tap connection
            if path == "/api/auth/current":
                acc = sync_hub.get_current_active_account()
                if acc:
                    self.send_json({"success": True, "account": acc})
                else:
                    self.send_json({"success": False, "error": "Nenhuma conta ativa encontrada."}, 404)
                return

            # API: High-speed local cached poster proxy
            if path == "/api/poster":
                poster_url = query.get("url", [""])[0].strip()
                size = query.get("size", ["w342"])[0].strip()
                if not poster_url:
                    self.send_error(400, "URL ausente")
                    return
                # Rewrite TMDb image resolution to lightweight size
                if "image.tmdb.org/t/p/" in poster_url:
                    poster_url = re.sub(r"/t/p/(w\d+|original|w600_and_h900_bestv2)/", f"/t/p/{size}/", poster_url)

                cache_dir = STATIC_DIR / "poster_cache"
                cache_dir.mkdir(parents=True, exist_ok=True)
                import hashlib
                url_hash = hashlib.md5(poster_url.encode()).hexdigest()
                cache_file = cache_dir / f"{url_hash}.jpg"

                self._custom_cache_control = True
                if cache_file.exists() and cache_file.stat().st_size > 0:
                    try:
                        with open(cache_file, "rb") as f:
                            data = f.read()
                        self.send_response(200)
                        self.send_header("Content-Type", "image/jpeg")
                        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                    except Exception:
                        return

                try:
                    req = urllib.request.Request(poster_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=5) as res:
                        img_data = res.read()
                        try:
                            with open(cache_file, "wb") as f:
                                f.write(img_data)
                        except Exception:
                            pass
                        self.send_response(200)
                        self.send_header("Content-Type", "image/jpeg")
                        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.send_header("Content-Length", str(len(img_data)))
                        self.end_headers()
                        self.wfile.write(img_data)
                        return
                except Exception as e:
                    self.send_error(502, f"Erro ao obter poster: {e}")
                    return

            # API: Prime / Netflix Curated Home Screen Data (Supports Data Saver Mode)
            if path in ("/api/netflix/home", "/api/home", "/api/prime/home"):
                account_code = query.get("code", query.get("accountCode", ["PADRAO"]))[0].strip() or "PADRAO"
                profile_id = query.get("profileId", ["p1"])[0].strip() or "p1"
                data_saver = query.get("dataSaver", ["0"])[0].strip().lower() in ("1", "true", "yes")
                self.send_json(get_netflix_home_data(account_code, profile_id, data_saver=data_saver))
                return

            # API: Live TV Electronic Program Guide (EPG Timeline & Now/Next)
            if path == "/api/epg":
                group = query.get("group", [None])[0]
                q_str = query.get("q", [""])[0].strip()
                try:
                    limit = int(query.get("limit", [50])[0])
                except Exception:
                    limit = 50
                try:
                    offset = int(query.get("offset", [0])[0])
                except Exception:
                    offset = 0
                self.send_json(get_epg_feed(CURRENT_CHANNELS, group=group, query_str=q_str, limit=limit, offset=offset))
                return

            # API: User Watch Progress History
            if path == "/api/history":
                account_code = query.get("code", query.get("accountCode", ["PADRAO"]))[0].strip() or "PADRAO"
                profile_id = query.get("profileId", ["p1"])[0].strip() or "p1"
                prog_res = sync_hub.get_progress(account_code, profile_id)
                hist_items = prog_res.get("items", []) if isinstance(prog_res, dict) else (prog_res or [])
                self.send_json({"success": True, "history": hist_items})
                return

            # API: Offline Downloads List
            if path == "/api/downloads":
                self.send_json({"success": True, "downloads": load_downloads()})
                return

            # API: Stream Downloaded Offline File
            if path == "/api/downloads/stream":
                item_id = query.get("id", [""])[0].strip()
                stream_downloaded_file(self, item_id)
                return

            if path == "/":
                self.path = "/index.html"

            super().do_GET()
        except Exception as e:
            print(f"[Erro no GET {self.path}]: {e}")
            try:
                self.send_error(500, f"Erro interno: {e}")
            except Exception:
                pass

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 0:
                post_data = self.rfile.read(content_length)
                try:
                    body = json.loads(post_data.decode("utf-8"))
                except Exception:
                    body = {}
            else:
                body = {}

            # API: Mobile Confirms Pairing & Logs in TV
            if path == "/api/auth/pair/confirm":
                code = body.get("code", "").strip()
                email = body.get("email", "").strip().lower()
                password = body.get("password", "").strip()
                is_register = body.get("isRegister", False)
                quick_connect = body.get("quickConnect", False)
                playlist_url = body.get("playlistUrl", "").strip()

                if not code or code not in TV_PAIR_SESSIONS:
                    self.send_json({"success": False, "error": "Código da TV inválido ou expirado. Gere um novo código na TV."}, 400)
                    return

                # 1-Click Instant Quick Connect from Mobile
                if quick_connect or not email:
                    active_acc = sync_hub.get_current_active_account()
                    if active_acc:
                        email = active_acc.get("email", "carlos@streamflix.tv")
                        res = {
                            "success": True,
                            "email": email,
                            "playlistUrl": playlist_url or active_acc.get("playlistUrl", ""),
                            "accountCode": active_acc.get("accountCode", "ACC_MASTER")
                        }
                    else:
                        res = sync_hub.register_account("carlos@streamflix.tv", "123456", playlist_url)
                elif is_register:
                    res = sync_hub.register_account(email, password, playlist_url)
                else:
                    res = sync_hub.login_account(email, password)

                if res.get("success"):
                    TV_PAIR_SESSIONS[code]["status"] = "authorized"
                    TV_PAIR_SESSIONS[code]["user"] = res
                    self.send_json({"success": True, "status": "authorized", "message": "Smart TV conectada com sucesso!", "user": res})
                else:
                    self.send_json(res, 400)
                return

            if path == "/api/auth/register":
                email = body.get("email", "")
                password = body.get("password", "")
                playlist_url = body.get("playlistUrl", "")
                res = sync_hub.register_account(email, password, playlist_url)
                status = 200 if res.get("success") else 400
                self.send_json(res, status)
                return

            # API: Forgot Password
            if path in ("/api/auth/forgot-password", "/api/auth/forgot"):
                email = body.get("email", "").strip().lower()
                res = sync_hub.forgot_password(email)
                status = 200 if res.get("success") else 400
                self.send_json(res, status)
                return

            # API: Reset Password
            if path in ("/api/auth/reset-password", "/api/auth/reset"):
                email = body.get("email", "").strip().lower()
                new_password = body.get("newPassword", "")
                res = sync_hub.reset_password(email, new_password)
                status = 200 if res.get("success") else 400
                self.send_json(res, status)
                return
            # API: Auth Login
            if path == "/api/auth/login":
                email = body.get("email", "")
                password = body.get("password", "")
                res = sync_hub.login_account(email, password)
                status = 200 if res.get("success") else 400
                self.send_json(res, status)
                return

            # API: Auth Playlist Update
            if path == "/api/auth/playlist":
                email = body.get("email", "")
                playlist_url = body.get("playlistUrl", "")
                res = sync_hub.update_account_playlist(email, playlist_url)
                status = 200 if res.get("success") else 400
                self.send_json(res, status)
                return

            # API: Activate User Playlist (Isola lista do usuário logado)
            if path == "/api/auth/activate":
                global CURRENT_CHANNELS, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META, CURRENT_GROUPED_CATEGORIES
                email = body.get("email", "").strip().lower()
                url = body.get("playlistUrl", "").strip()
                if not url and email:
                    sync_data = sync_hub.load_sync_data()
                    user = sync_data.get("accounts", {}).get(email)
                    if user:
                        url = user.get("playlistUrl", "")
                
                if url:
                    if CURRENT_PLAYLIST_META.get("url") != url:
                        try:
                            print(f"[User Playlist] Carregando playlist do usuário {email}...")
                            channels = m3u_parser.parse_m3u_url(url)
                            name = f"Lista de {email.split('@')[0]}" if email else "Minha Lista"
                            save_playlist_cache(channels, name, {"url": url, "email": email, "type": "url"})
                        except Exception as e:
                            print(f"[User Playlist] Erro ao carregar URL {url}: {e}")
                            self.send_json({"success": False, "error": f"Erro ao baixar lista: {e}"}, 500)
                            return
                    self.send_json({
                        "success": True,
                        "playlist_name": CURRENT_PLAYLIST_NAME,
                        "count": len(CURRENT_CHANNELS),
                        "categories": CURRENT_GROUPED_CATEGORIES
                    })
                    return
                else:
                    CURRENT_CHANNELS = []
                    CURRENT_PLAYLIST_NAME = "Nenhuma Lista Conectada"
                    CURRENT_PLAYLIST_META = {}
                    refresh_indexes()
                    self.send_json({
                        "success": True,
                        "playlist_name": CURRENT_PLAYLIST_NAME,
                        "count": 0,
                        "categories": CURRENT_GROUPED_CATEGORIES
                    })
                    return

            # API: Load M3U by URL
            if path == "/api/playlist/url":
                url = body.get("url", "").strip()
                name = body.get("name", "").strip() or url.split("/")[-1].split("?")[0] or "Lista Online"
                if not url:
                    self.send_json({"success": False, "error": "URL inválida ou vazia"}, 400)
                    return
                try:
                    print(f"[Playlist] Baixando lista remota de: {url[:80]}...")
                    channels = m3u_parser.parse_m3u_url(url)
                    if not channels:
                        self.send_json({"success": False, "error": "Nenhum canal encontrado nesta lista."}, 400)
                        return

                    save_playlist_cache(channels, name, {"url": url, "type": "url"})
                    self.send_json({
                        "success": True,
                        "count": len(channels),
                        "playlist_name": CURRENT_PLAYLIST_NAME,
                        "categories": m3u_parser.get_grouped_categories(channels)
                    })
                except Exception as e:
                    print(f"[Playlist] Erro ao carregar URL: {e}")
                    self.send_json({"success": False, "error": f"Erro ao baixar lista: {str(e)}"}, 500)
                return

            # API: Refresh Current URL Playlist
            if path == "/api/playlist/refresh":
                url = CURRENT_PLAYLIST_META.get("url")
                if not url:
                    self.send_json({"success": False, "error": "Esta lista foi carregada por arquivo e não pode ser atualizada automaticamente pela internet."}, 400)
                    return
                try:
                    print(f"[Playlist] Atualizando lista de: {url[:80]}...")
                    channels = m3u_parser.parse_m3u_url(url)
                    if not channels:
                        self.send_json({"success": False, "error": "Não foi possível obter canais na atualização."}, 400)
                        return
                    save_playlist_cache(channels, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META)
                    self.send_json({
                        "success": True,
                        "count": len(channels),
                        "playlist_name": CURRENT_PLAYLIST_NAME,
                        "categories": m3u_parser.get_grouped_categories(channels)
                    })
                except Exception as e:
                    self.send_json({"success": False, "error": f"Erro ao atualizar: {str(e)}"}, 500)
                return

            # API: Upload M3U content directly
            if path == "/api/playlist/upload":
                content = body.get("content", "")
                name = body.get("name", "Lista Importada")
                if not content:
                    self.send_json({"success": False, "error": "Conteúdo da lista vazio"}, 400)
                    return
                try:
                    print(f"[Playlist] Processando arquivo importado ({len(content)} caracteres)...")
                    channels = m3u_parser.parse_m3u_content(content)
                    if not channels:
                        self.send_json({"success": False, "error": "Nenhum canal identificado no formato M3U."}, 400)
                        return

                    with open(SAVED_M3U_FILE, "w", encoding="utf-8") as f:
                        f.write(content)

                    save_playlist_cache(channels, name, {"type": "file", "filename": name})
                    self.send_json({
                        "success": True,
                        "count": len(channels),
                        "playlist_name": CURRENT_PLAYLIST_NAME,
                        "categories": m3u_parser.get_grouped_categories(channels)
                    })
                except Exception as e:
                    print(f"[Playlist] Erro ao processar: {e}")
                    self.send_json({"success": False, "error": f"Erro ao processar: {str(e)}"}, 500)
                return

            # API: Reset to default demo playlist
            if path == "/api/playlist/reset":
                for p in (SAVED_CACHE_FILE, SAVED_META_FILE, SAVED_M3U_FILE):
                    if p.exists():
                        try: os.remove(p)
                        except Exception: pass
                load_initial_channels()
                self.send_json({
                    "success": True,
                    "count": len(CURRENT_CHANNELS),
                    "playlist_name": CURRENT_PLAYLIST_NAME,
                    "categories": m3u_parser.get_grouped_categories(CURRENT_CHANNELS)
                })
                return

            # API: Toggle Favorite
            if path == "/api/favorites/toggle":
                channel_url = body.get("url")
                channel_name = body.get("name")
                key = channel_url or channel_name
                if not key:
                    self.send_json({"success": False, "error": "Canal inválio"}, 400)
                    return
                favs = get_favorites()
                if key in favs:
                    favs.remove(key)
                    is_fav = False
                else:
                    favs.append(key)
                    is_fav = True
                save_favorites(favs)
                # Espelha na conta para o Celular/TV receberem a mesma lista.
                account_code = (body.get("accountCode") or "").strip() or sync_hub.get_active_account_code()
                if account_code:
                    try:
                        sync_hub.set_favorites(account_code, favs)
                    except Exception as e:
                        print(f"[Favorites Sync] {e}")
                self.send_json({"success": True, "is_favorite": is_fav, "total_favorites": len(favs)})
                return

            # API: Translate text
            if path == "/api/translate":
                text = body.get("text", "")
                translated = translate_to_pt(text)
                self.send_json({"success": True, "original": text, "translated": translated})
                return

            # API: Auto-fetch subtitles in Portuguese
            if path == "/api/auto_subtitles":
                title = body.get("title", "")
                result = fetch_auto_subtitle_srt(title)
                self.send_json(result)
                return

            # API: Translate on-screen text from image or text
            if path == "/api/translate_screen":
                text = body.get("text", "")
                if text:
                    translated = translate_to_pt(text)
                    self.send_json({"success": True, "original": text, "translated": translated})
                    return

                image_data = body.get("image", "")
                extracted_text = ""
                if image_data:
                    try:
                        import base64
                        from io import BytesIO
                        from PIL import Image
                        if "," in image_data:
                            image_data = image_data.split(",")[1]
                        img_bytes = base64.b64decode(image_data)
                        try:
                            import pytesseract
                            img = Image.open(BytesIO(img_bytes))
                            extracted_text = pytesseract.image_to_string(img, lang="eng").strip()
                        except Exception as ocr_err:
                            print(f"[OCR Notice]: pytesseract não disponível ou falhou: {ocr_err}")
                    except Exception as img_err:
                        print(f"[Image Decode Notice]: {img_err}")

                if extracted_text:
                    translated = translate_to_pt(extracted_text)
                    self.send_json({"success": True, "original": extracted_text, "translated": translated})
                else:
                    self.send_json({
                        "success": False,
                        "error": "Nenhum texto identificado automaticamente na imagem. Digite ou selecione o texto para traduzir instantaneamente."
                    })
                return

            # API: Netflix-style Sync Profiles (POST)
            if path == "/api/sync/profiles":
                email = body.get("email", "").strip().lower()
                account_code = body.get("accountCode", "").strip()
                if not account_code and email:
                    sync_data = sync_hub.load_sync_data()
                    account_code = sync_data.get("accounts", {}).get(email, {}).get("accountCode", "")
                    if not account_code and email in ("angeloregis@gmail.com", "angelo.regis@gmail.com"):
                        account_code = "ACC_BD24EFDF"
                if not account_code:
                    account_code = "PADRAO"
                action = body.get("action", "save")
                profile_id = body.get("id")
                if action == "delete":
                    res = sync_hub.delete_profile(account_code, profile_id)
                else:
                    name = body.get("name", "Novo Perfil")
                    avatar = body.get("avatar", "blue")
                    is_kids = body.get("isKids", False)
                    res = sync_hub.add_or_update_profile(account_code, profile_id, name, avatar, is_kids)
                self.send_json(res)
                return

            # API: Profile Watch Progress (POST)
            if path == "/api/sync/progress":
                account_code = body.get("accountCode", "PADRAO")
                profile_id = body.get("profileId", "p1")
                action = body.get("action", "update")
                if action == "remove":
                    content_id = body.get("contentId")
                    res = sync_hub.remove_progress_item(account_code, profile_id, content_id)
                else:
                    item_data = body.get("item", {})
                    res = sync_hub.update_progress(account_code, profile_id, item_data)
                self.send_json(res)
                return

            # API: Favoritos compartilhados (POST)
            if path == "/api/sync/favorites":
                account_code = body.get("accountCode", "PADRAO")
                res = sync_hub.set_favorites(account_code, body.get("favorites", []))
                res["success"] = True
                self.send_json(res)
                return

            # API: Estado do catálogo (POST)
            if path == "/api/sync/catalog":
                account_code = body.get("accountCode", "PADRAO")
                res = sync_hub.set_catalog_state(
                    account_code,
                    body.get("catalogVersion", 0),
                    body.get("catalogUpdatedAt", "")
                )
                res["success"] = True
                self.send_json(res)
                return

            # API: Perfil ativo compartilhado (POST)
            if path == "/api/sync/active-profile":
                self.send_json(sync_hub.set_active_profile(
                    body.get("accountCode", "PADRAO"),
                    body.get("profileId", "")
                ))
                return
            # API: Offline Downloads (POST to add or delete)
            if path == "/api/downloads":
                action = body.get("action", "add")
                if action == "delete":
                    item_id = body.get("id") or body.get("contentId")
                    res = delete_download_item(item_id)
                else:
                    res = start_download_task(body)
                self.send_json(res)
                return

            # API: System Repair (POST)
            if path in ("/api/system/repair", "/api/repair"):
                report = run_catalog_guardian(auto_save=True)
                self.send_json({
                    "success": True,
                    "message": "Auditoria e auto-reparo do catálogo concluídos com sucesso!",
                    "catalog_version": CURRENT_CATALOG_VERSION,
                    "report": report
                })
                return

            self.send_error(404, "Endpoint não encontrado")
        except Exception as e:
            print(f"[Erro no POST {self.path}]: {e}")
            try:
                self.send_error(500, f"Erro interno: {e}")
            except Exception:
                pass


def start_auto_update_daemon(interval_seconds=1800):
    """Background daemon to periodically check and auto-refresh upstream playlist."""
    def worker():
        while True:
            time.sleep(interval_seconds)
            try:
                url = CURRENT_PLAYLIST_META.get("url")
                if url and str(url).startswith("http"):
                    print(f"[AutoUpdate] Verificando lista upstream em segundo plano: {url[:60]}...")
                    new_channels = m3u_parser.parse_m3u_url(url, timeout=60)
                    if new_channels:
                        if len(new_channels) != len(CURRENT_CHANNELS):
                            print(f"[AutoUpdate] Atualização detectada! Itens: {len(CURRENT_CHANNELS)} -> {len(new_channels)}. Atualizando catálogo...")
                            save_playlist_cache(new_channels, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META)
                        else:
                            old_sample = [c.get("url") for c in CURRENT_CHANNELS[:5]] + [c.get("url") for c in CURRENT_CHANNELS[-5:]]
                            new_sample = [c.get("url") for c in new_channels[:5]] + [c.get("url") for c in new_channels[-5:]]
                            if old_sample != new_sample:
                                print(f"[AutoUpdate] Modificações detectadas no upstream. Atualizando catálogo...")
                                save_playlist_cache(new_channels, CURRENT_PLAYLIST_NAME, CURRENT_PLAYLIST_META)
                            else:
                                print(f"[AutoUpdate] Catálogo verificado: já sincronizado com a fonte.")
            except Exception as e:
                print(f"[AutoUpdate] Erro na verificação periódica: {e}")

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    print("[AutoUpdate] Daemon de sincronização automática da lista ativado.")


class ThreadedIPTVServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_anti_hibernation_daemon(interval_seconds=480):
    """Guardião interno anti-hibernação do Render (Self-Ping a cada 8 minutos)."""
    def worker():
        time.sleep(25)  # Aguarda inicialização completa
        target_url = os.environ.get("RENDER_EXTERNAL_URL", "https://streamflix-server.onrender.com")
        health_url = f"{target_url.rstrip('/')}/health"
        print(f"[Anti-Sleep] Guardião interno 24/7 ativado para {health_url} (a cada {interval_seconds // 60} min)")
        while True:
            time.sleep(interval_seconds)
            try:
                req = urllib.request.Request(
                    health_url,
                    headers={"User-Agent": "StreamFlix-AntiSleep-Internal/1.0", "Accept": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=25) as resp:
                    print(f"[Anti-Sleep] Ping autônomo recebido com sucesso! Status: {resp.status}")
            except Exception as e:
                print(f"[Anti-Sleep] Aviso de ping: {e}")

    t = threading.Thread(target=worker, daemon=True, name="StreamFlixAntiSleepDaemon")
    t.start()

def start_server(port=8895):
    load_initial_channels()
    start_auto_update_daemon()
    start_anti_hibernation_daemon()
    server = ThreadedIPTVServer(("0.0.0.0", port), IPTVServerHandler)
    print(f"[IPTV Server] Rodando na rede local em http://0.0.0.0:{port} (Acesse via PC ou Smart TV / Celular)")
    return server

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8895))
    httpd = start_server(port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
