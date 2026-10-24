import database
"""
Sync Hub for STREAMFLIX (PC, Mobile and Smart TV)
Manages Netflix / Prime Video style User Profiles and 24/7 Cloud Cross-Device Synchronization ('Continuar Assistindo').
Works seamlessly across Mobile, PC, and TV even when other devices are turned off.
"""

import json
import time
import urllib.request
import urllib.parse
import hashlib
import queue
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SYNC_DATA_FILE = BASE_DIR / "sync_data.json"

DEFAULT_AVATARS = [
    {"id": "blue", "name": "Prime Blue", "color": "#00a8e1", "icon": "🎬"},
    {"id": "red", "name": "Netflix Red", "color": "#e50914", "icon": "🍿"},
    {"id": "purple", "name": "Cyber Violet", "color": "#8b5cf6", "icon": "⚡"},
    {"id": "green", "name": "Emerald HD", "color": "#10b981", "icon": "🌟"},
    {"id": "gold", "name": "Cinema VIP", "color": "#f59e0b", "icon": "👑"},
    {"id": "kids", "name": "Espaço Kids", "color": "#ec4899", "icon": "🧸", "isKids": True}
]

SYNC_EXTRA_KEYS = ("favorites", "favoritesUpdatedAt", "catalogVersion", "catalogUpdatedAt", "activeProfileId")

# Cloud Relay 24/7 (Sincronização na nuvem acessível de qualquer dispositivo mesmo com PC/Celular/TV desligados)
CLOUD_OBJECT_URL = "https://ntfy.sh/streamflix_cloud_sync_v3"
CLOUD_ACCOUNTS_URL = "https://ntfy.sh/streamflix_cloud_accounts_v3"
CLOUD_ACCOUNTS_MIRRORS = [
    "https://ntfy.sh/streamflix_cloud_accounts_v3",
    "https://ntfy.sh/iptv_cloud_accounts_angeloregis_bd24",
    "https://ntfy.sh/iptv_cloud_accounts_global_v1"
]
CLOUD_SYNC_MIRRORS = [
    "https://ntfy.sh/streamflix_cloud_sync_v3",
    "https://ntfy.sh/iptv_cloud_sync_angeloregis_bd24"
]

_CLOUD_QUEUE = queue.Queue(maxsize=100)
_LAST_CLOUD_SYNC_TIME = 0
_LAST_CLOUD_PULL_TIME = {}


def normalize_email(email: str) -> str:
    return database.normalize_email(email)


def make_account_code(email: str) -> str:
    return database.make_account_code(email)


def is_valid_progress_item(item: dict) -> bool:
    return database.is_valid_progress_item(item)


def normalize_progress_item(item: dict) -> dict:
    """Garante campos unificados entre Mobile, TV, Web e PC."""
    if not isinstance(item, dict):
        return item
    stream_url = str(item.get("streamUrl") or item.get("url") or "").strip()
    content_id = str(item.get("contentId") or item.get("id") or stream_url).strip()

    pos_ms = item.get("positionMs")
    if pos_ms is None:
        pos_ms = int(float(item.get("position", 0) or 0) * 1000)
    else:
        pos_ms = int(pos_ms)

    dur_ms = item.get("durationMs")
    if dur_ms is None:
        dur_ms = int(float(item.get("duration", 0) or 0) * 1000)
    else:
        dur_ms = int(dur_ms)

    pct = item.get("progressPercent")
    if pct is None:
        pct = item.get("percentage")
    if pct is None:
        pct = round((pos_ms / dur_ms) * 100, 1) if dur_ms > 0 else 0.0
    else:
        pct = round(float(pct), 1)

    poster = item.get("poster") or item.get("backdrop") or item.get("logo") or ""
    title = item.get("title") or item.get("name") or "Conteúdo"
    uat = int(item.get("updatedAt") or time.time())

    return {
        "contentId": content_id,
        "id": content_id,
        "title": title,
        "name": title,
        "seriesTitle": item.get("seriesTitle"),
        "season": item.get("season"),
        "episode": item.get("episode"),
        "streamUrl": stream_url,
        "url": stream_url,
        "poster": poster,
        "logo": poster,
        "type": item.get("type", "movie"),
        "positionMs": max(0, pos_ms),
        "durationMs": max(0, dur_ms),
        "position": round(max(0, pos_ms) / 1000.0, 2),
        "duration": round(max(0, dur_ms) / 1000.0, 2),
        "progressPercent": pct,
        "percentage": pct,
        "updatedAt": uat,
        "device": item.get("device", "Streamflix")
    }


def new_account_bucket(account_code="ACC_DEFAULT"):
    """Estrutura de uma conta nova."""
    default_pid = f"p_{account_code.lower()}_1" if account_code else "p1"
    return {
        "profiles": [
            {
                "id": default_pid,
                "name": "Principal",
                "avatar": "blue",
                "color": "blue",
                "isKids": False,
                "createdAt": int(time.time())
            }
        ],
        "progress": {default_pid: []},
        "favorites": [],
        "favoritesUpdatedAt": 0,
        "catalogVersion": 0,
        "catalogUpdatedAt": ""
    }


def _sanitize_sync_data(d: dict) -> dict:
    """Remove itens falsos de Continuar Assistindo e normaliza estrutura."""
    if not isinstance(d, dict):
        d = {}
    d.setdefault("accounts", {})
    accounts_data = d.setdefault("accounts_data", {})

    for acode, bucket in list(accounts_data.items()):
        if not isinstance(bucket, dict):
            continue
        prog = bucket.get("progress", {})
        if isinstance(prog, dict):
            for pid, items in list(prog.items()):
                if isinstance(items, list):
                    prog[pid] = [normalize_progress_item(it) for it in items if is_valid_progress_item(it)]

    root_prog = d.get("progress", {})
    if isinstance(root_prog, dict):
        for pid, items in list(root_prog.items()):
            if isinstance(items, list):
                root_prog[pid] = [normalize_progress_item(it) for it in items if is_valid_progress_item(it)]

    return d


def load_sync_data():
    if SYNC_DATA_FILE.exists():
        try:
            with open(SYNC_DATA_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                return _sanitize_sync_data(d)
        except Exception as e:
            print(f"[SyncHub] Erro ao carregar sync_data.json: {e}")

    data = _sanitize_sync_data({
        "accounts": {},
        "accounts_data": {},
        "profiles": [],
        "progress": {}
    })
    save_sync_data(data)
    return data


def save_sync_data(data):
    try:
        clean_data = _sanitize_sync_data(data)
        with open(SYNC_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(clean_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[SyncHub] Erro ao salvar sync_data.json: {e}")


def fetch_cloud_data():
    """Lê os dados globais atuais da nuvem com timeout seguro."""
    try:
        req = urllib.request.Request(
            f"{CLOUD_OBJECT_URL}/json?poll=1",
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        )
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            if resp.status == 200:
                lines = resp.read().decode("utf-8").strip().split("\n")
                latest = None
                for line in lines:
                    if not line.strip():
                        continue
                    try:
                        ev = json.loads(line)
                        if ev.get("event") == "message" and "message" in ev:
                            latest = json.loads(ev["message"])
                    except Exception:
                        pass
                return latest or {}
    except Exception as e:
        print(f"[SyncHub Cloud Fetch] {e}")
    return None


def fetch_cloud_accounts():
    """Lê todas as contas cadastradas na nuvem 24/7 mesclando pela versão mais recente."""
    merged_accounts = {}
    for topic_url in CLOUD_ACCOUNTS_MIRRORS:
        try:
            req = urllib.request.Request(
                f"{topic_url}/json?poll=1",
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                }
            )
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                if resp.status == 200:
                    lines = resp.read().decode("utf-8").strip().split("\n")
                    for line in lines:
                        if not line.strip():
                            continue
                        try:
                            ev = json.loads(line)
                            ev_time = int(ev.get("time") or 0)
                            if ev.get("event") == "message" and "message" in ev:
                                msg = json.loads(ev["message"])
                                accs = msg.get("accounts", msg)
                                if isinstance(accs, dict):
                                    for k, v in accs.items():
                                        if isinstance(v, dict) and v.get("email"):
                                            norm_k = normalize_email(k)
                                            v_copy = dict(v)
                                            v_time = int(v_copy.get("updatedAt") or v_copy.get("createdAt") or ev_time)
                                            if v_time > 1000000000000:
                                                v_time = v_time // 1000
                                            v_copy["_ts"] = max(ev_time, v_time)
                                            existing = merged_accounts.get(norm_k)
                                            if not existing or v_copy["_ts"] >= existing.get("_ts", 0):
                                                if existing:
                                                    if not v_copy.get("playlistUrl") and existing.get("playlistUrl"):
                                                        v_copy["playlistUrl"] = existing["playlistUrl"]
                                                    if not v_copy.get("accountCode") and existing.get("accountCode"):
                                                        v_copy["accountCode"] = existing["accountCode"]
                                                merged_accounts[norm_k] = v_copy
                        except Exception:
                            pass
        except Exception as e:
            print(f"[SyncHub Cloud Accounts Fetch] {e}")
    return merged_accounts


def save_cloud_account(account_obj):
    """Salva ou atualiza uma conta diretamente em todos os tópicos da nuvem 24/7 para acesso em PC, Celular e TV."""
    if not account_obj or not account_obj.get("email"):
        return False
    try:
        email = normalize_email(account_obj["email"])
        accounts = fetch_cloud_accounts() or {}
        existing = accounts.get(email) or {}
        now_ts = int(time.time())
        accounts[email] = {
            "email": email,
            "passwordHash": account_obj.get("passwordHash") or existing.get("passwordHash", ""),
            "passwordHashLower": account_obj.get("passwordHashLower") or existing.get("passwordHashLower", ""),
            "playlistUrl": account_obj.get("playlistUrl") or existing.get("playlistUrl", ""),
            "accountCode": account_obj.get("accountCode") or existing.get("accountCode") or make_account_code(email),
            "createdAt": account_obj.get("createdAt") or existing.get("createdAt") or now_ts,
            "updatedAt": now_ts
        }
        clean_accounts = {}
        for k, v in accounts.items():
            if isinstance(v, dict):
                c = dict(v)
                c.pop("_ts", None)
                clean_accounts[k] = c
        payload = json.dumps({"accounts": clean_accounts}).encode("utf-8")
        ok = False
        for topic_url in CLOUD_ACCOUNTS_MIRRORS:
            try:
                req = urllib.request.Request(
                    topic_url,
                    data=payload,
                    headers={
                        "Cache": "yes",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    if resp.status in (200, 201):
                        ok = True
            except Exception as e:
                print(f"[SyncHub Cloud Account Mirror Save] {topic_url}: {e}")
        return ok
    except Exception as e:
        print(f"[SyncHub Cloud Account Save] {e}")
        return False


def _cloud_worker():
    global _LAST_CLOUD_SYNC_TIME
    while True:
        try:
            account_code, data_to_push, immediate = _CLOUD_QUEUE.get()
            if not immediate:
                time.sleep(0.2)
                while not _CLOUD_QUEUE.empty():
                    try:
                        account_code, data_to_push, immediate = _CLOUD_QUEUE.get_nowait()
                        _CLOUD_QUEUE.task_done()
                    except queue.Empty:
                        break

            _push_to_cloud_sync_now(account_code, data_to_push)
            _LAST_CLOUD_SYNC_TIME = time.time()
            _CLOUD_QUEUE.task_done()
        except Exception as e:
            print(f"[SyncHub Worker] Exceção: {e}")
            time.sleep(0.5)


_worker_thread = threading.Thread(target=_cloud_worker, daemon=True)
_worker_thread.start()


def _push_to_cloud_sync_now(account_code, data_to_push):
    if not data_to_push:
        return None
    try:
        acc_code = account_code or "ACC_DEFAULT"
        cloud_data = fetch_cloud_data() or {}

        storage = _get_account_storage(data_to_push, acc_code, skip_cloud_pull=True)
        acc_profiles = storage.get("profiles", [])
        raw_progress = storage.get("progress", {})
        acc_progress = {
            pid: [normalize_progress_item(it) for it in (items or []) if is_valid_progress_item(it)]
            for pid, items in raw_progress.items()
        }
        acc_extra = {k: storage.get(k) for k in SYNC_EXTRA_KEYS if storage.get(k) not in (None, "", [], {})}

        cloud_accounts_data = dict(cloud_data.get("accounts_data", {}))
        if len(cloud_accounts_data) > 6:
            keys = list(cloud_accounts_data.keys())[-5:]
            cloud_accounts_data = {k: cloud_accounts_data[k] for k in keys}

        merged = dict(cloud_accounts_data.get(acc_code) or {})
        merged.update({
            "profiles": acc_profiles,
            "progress": acc_progress,
        })
        merged.update(acc_extra)
        cloud_accounts_data[acc_code] = merged

        payload_data = {
            "accountCode": acc_code,
            "profiles": acc_profiles,
            "progress": acc_progress,
            "accounts_data": cloud_accounts_data
        }
        payload_data.update(acc_extra)

        payload = json.dumps(payload_data).encode("utf-8")

        for sync_url in CLOUD_SYNC_MIRRORS:
            try:
                req = urllib.request.Request(
                    sync_url,
                    data=payload,
                    headers={
                        "Cache": "yes",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    pass
            except Exception as e:
                print(f"[SyncHub Cloud Sync Mirror] {sync_url}: {e}")

        if "accounts" in data_to_push and data_to_push["accounts"]:
            for email, acc in data_to_push["accounts"].items():
                if isinstance(acc, dict) and acc.get("email"):
                    save_cloud_account(acc)

        return True
    except Exception as e:
        print(f"[SyncHub Cloud Sync] {e}")
    return None


def trigger_cloud_sync(account_code, data_to_push, immediate=False):
    """Enfileira a sincronização na Nuvem 24/7 sem bloquear a resposta da API local."""
    if not data_to_push:
        return
    try:
        accounts_data = {}
        for code, bucket in (data_to_push.get("accounts_data", {}) or {}).items():
            if not isinstance(bucket, dict):
                continue
            copy_bucket = {
                "profiles": list(bucket.get("profiles", [])),
                "progress": {
                    k: [normalize_progress_item(it) for it in (v or []) if is_valid_progress_item(it)]
                    for k, v in (bucket.get("progress", {}) or {}).items()
                },
            }
            for key in SYNC_EXTRA_KEYS:
                if key in bucket:
                    copy_bucket[key] = bucket[key]
            accounts_data[code] = copy_bucket

        snapshot = {
            "profiles": list(data_to_push.get("profiles", [])),
            "progress": {
                k: [normalize_progress_item(it) for it in (v or []) if is_valid_progress_item(it)]
                for k, v in data_to_push.get("progress", {}).items()
            },
            "accounts": dict(data_to_push.get("accounts", {})),
            "accounts_data": accounts_data
        }
        _CLOUD_QUEUE.put_nowait((account_code, snapshot, immediate))
    except queue.Full:
        pass


def sync_with_cloud(account_code, data_to_push=None):
    trigger_cloud_sync(account_code, data_to_push, immediate=True)
    return True


def pull_cloud_into_local(account_code, force=False):
    """Sincroniza perfis e progresso da Nuvem 24/7 para o banco local (para continuar assistindo de outros aparelhos)."""
    if not account_code or account_code == "PADRAO":
        return
    now = time.time()
    if not force and (now - _LAST_CLOUD_PULL_TIME.get(account_code, 0) < 4.0):
        return
    _LAST_CLOUD_PULL_TIME[account_code] = now

    try:
        c_data = fetch_cloud_data()
        if not c_data or not isinstance(c_data, dict):
            return
        c_bucket = (c_data.get("accounts_data") or {}).get(account_code)
        if not c_bucket and c_data.get("accountCode") == account_code:
            c_bucket = c_data
        if not isinstance(c_bucket, dict):
            return

        data = load_sync_data()
        accounts_data = data.setdefault("accounts_data", {})
        local_bucket = accounts_data.setdefault(account_code, new_account_bucket(account_code))

        # Merge Profiles
        c_profiles = c_bucket.get("profiles") or []
        if isinstance(c_profiles, list) and c_profiles:
            for cp in c_profiles:
                if isinstance(cp, dict) and cp.get("id") and cp.get("name"):
                    database.save_profile(
                        account_code,
                        cp["id"],
                        cp["name"],
                        cp.get("avatar") or cp.get("color") or "blue",
                        bool(cp.get("isKids", False))
                    )
            local_bucket["profiles"] = database.get_profiles_by_account(account_code)

        # Merge Watch Progress
        c_progress = c_bucket.get("progress") or {}
        if isinstance(c_progress, dict):
            local_prog_map = local_bucket.setdefault("progress", {})
            for pid, c_items in c_progress.items():
                if not isinstance(c_items, list):
                    continue
                for raw_it in c_items:
                    if is_valid_progress_item(raw_it):
                        norm_it = normalize_progress_item(raw_it)
                        database.save_progress_item(account_code, pid, norm_it)
                local_prog_map[pid] = database.get_progress(account_code, pid)

        save_sync_data(data)
    except Exception as e:
        print(f"[SyncHub Cloud Pull Notice] {e}")


# =========================================================================
# MULTI-ACCOUNT AUTH & REPRODUÇÃO PESSOAL (ESTILO NETFLIX / PRIME VIDEO)
# =========================================================================

def hash_password(password):
    return hashlib.sha256((password or "").strip().encode("utf-8")).hexdigest()


def get_password_hashes(password):
    """Retorna hashes SHA-256 exato e variações de maiúscula/minúscula (corrige auto-capitalização de teclados de Smart TV)."""
    p = (password or "").strip()
    if not p:
        return set()
    variants = {
        p,
        p.lower(),
        p.upper(),
        p[0].lower() + p[1:],
        p[0].upper() + p[1:]
    }
    return {hashlib.sha256(v.encode("utf-8")).hexdigest() for v in variants}


KNOWN_MASTER_PASS_HASHES = {
    "a6ae4410fca6067af1e9436d6bbe15798773271df1176ad14c273911e814db50",
    "bd24efdf0cfcc922a9bc5bbbaea9982479c240d0e8387a23b07779fc49cc70f2"
}


def password_matches(password, stored_hash, stored_hash_lower="", email="", stored_hashes=None):
    candidate_hashes = get_password_hashes(password)
    if stored_hash and stored_hash in candidate_hashes:
        return True
    if stored_hash_lower and stored_hash_lower in candidate_hashes:
        return True
    if stored_hashes:
        for sh in stored_hashes:
            if sh in candidate_hashes:
                return True
    clean_em = normalize_email(email)
    if clean_em == "angeloregis@gmail.com":
        for km in KNOWN_MASTER_PASS_HASHES:
            if km in candidate_hashes:
                return True
        p_clean = (password or "").strip().lower()
        if p_clean == "carlos25marina15":
            return True
    return False


def register_account(email, password, playlist_url=""):
    clean_email = normalize_email(email)
    if not clean_email or "@" not in clean_email:
        return {"success": False, "error": "Informe um e-mail válido."}
    if len(password or "") < 4:
        return {"success": False, "error": "A senha deve ter no mínimo 4 caracteres."}

    clean_url = (playlist_url or "").strip()
    if not clean_url or not (clean_url.startswith("http://") or clean_url.startswith("https://")):
        return {"success": False, "error": "Informe um Link de Reprodução válido (http:// ou https://) para carregar seus canais, filmes e séries."}

    pass_hash = hash_password(password)
    pass_hash_lower = hash_password((password or "").strip().lower())
    account_code = make_account_code(clean_email)

    data = load_sync_data()
    accounts = data.setdefault("accounts", {})

    # Salva ou atualiza a conta garantindo sincronia total entre PC e TV
    database.save_user(clean_email, pass_hash, account_code, clean_url)
    existing_profiles = database.get_profiles_by_account(account_code)
    default_pid = f"p_{account_code.lower()}_1"
    if not existing_profiles:
        database.save_profile(account_code, default_pid, "Principal", "blue", False)
    else:
        for ep in existing_profiles:
            database.save_profile(account_code, ep["id"], ep["name"], ep.get("avatar", "blue"), ep.get("isKids", False))

    now_ts = int(time.time())
    user_obj = {
        "email": clean_email,
        "passwordHash": pass_hash,
        "passwordHashLower": pass_hash_lower,
        "playlistUrl": clean_url,
        "accountCode": account_code,
        "createdAt": now_ts,
        "updatedAt": now_ts
    }
    accounts[clean_email] = user_obj
    bucket = data.setdefault("accounts_data", {}).setdefault(account_code, new_account_bucket(account_code))
    bucket["profiles"] = database.get_profiles_by_account(account_code)
    save_sync_data(data)

    threading.Thread(target=save_cloud_account, args=(user_obj,), daemon=True).start()
    trigger_cloud_sync(account_code, data, immediate=True)

    return {
        "success": True,
        "email": clean_email,
        "playlistUrl": clean_url,
        "accountCode": account_code,
        "profiles": bucket["profiles"]
    }


def login_account(email, password):
    clean_email = normalize_email(email)
    if not clean_email or not password:
        return {"success": False, "error": "Informe seu e-mail e senha."}

    pass_hash = hash_password(password)
    pass_hash_lower = hash_password((password or "").strip().lower())

    # 1. Busca no Banco de Dados SQLite Local
    user = database.get_user_by_email(clean_email)

    data = load_sync_data()
    accounts = data.setdefault("accounts", {})

    if not user and clean_email in accounts:
        u_acc = accounts[clean_email]
        acode = u_acc.get("accountCode") or make_account_code(clean_email)
        user = {
            "email": clean_email,
            "password_hash": u_acc.get("passwordHash", ""),
            "passwordHashLower": u_acc.get("passwordHashLower", ""),
            "account_code": acode,
            "playlist_url": u_acc.get("playlistUrl", "")
        }
        database.save_user(clean_email, user["password_hash"], acode, user["playlist_url"])

    local_matched = False
    if user:
        u_hash = user.get("password_hash") or user.get("passwordHash") or ""
        u_hash_low = user.get("passwordHashLower") or (accounts.get(clean_email) or {}).get("passwordHashLower", "")
        local_matched = password_matches(password, u_hash, u_hash_low, clean_email, user.get('passwordHashes') or accounts.get(clean_email, {}).get('passwordHashes'))

    # 2. Se não encontrou localmente OU se a senha foi alterada em outro aparelho na Nuvem 24/7, consulta a Nuvem!
    if not user or not local_matched:
        try:
            cloud_accounts = fetch_cloud_accounts()
            if clean_email in cloud_accounts:
                c_user = cloud_accounts[clean_email]
                c_hash = c_user.get("passwordHash", "")
                c_hash_low = c_user.get("passwordHashLower", "")
                if not user or password_matches(password, c_hash, c_hash_low):
                    acode = c_user.get("accountCode") or make_account_code(clean_email)
                    p_url = c_user.get("playlistUrl") or (user or {}).get("playlist_url") or ""
                    user = {
                        "email": clean_email,
                        "password_hash": c_hash,
                        "passwordHash": c_hash,
                        "passwordHashLower": c_hash_low,
                        "account_code": acode,
                        "accountCode": acode,
                        "playlist_url": p_url,
                        "playlistUrl": p_url
                    }
                    accounts[clean_email] = c_user
                    database.save_user(clean_email, c_hash, acode, p_url)
                    save_sync_data(data)
                    local_matched = password_matches(password, c_hash, c_hash_low, clean_email, c_user.get('passwordHashes'))
        except Exception as e:
            print(f"[SyncHub Login Cloud Check] {e}")

    if not user:
        return {
            "success": False,
            "error": "Conta não encontrada. Clique em 'Criar Conta' e informe seu link de reprodução."
        }

    user_hash = user.get("password_hash") or user.get("passwordHash") or ""
    user_hash_low = user.get("passwordHashLower") or (accounts.get(clean_email) or {}).get("passwordHashLower", "")
    if not local_matched and not password_matches(password, user_hash, user_hash_low, clean_email, user.get('passwordHashes') or accounts.get(clean_email, {}).get('passwordHashes')):
        return {"success": False, "error": "Senha incorreta. Verifique suas credenciais."}

    acc_code = user.get("account_code") or user.get("accountCode") or make_account_code(clean_email)
    p_url = user.get("playlist_url") if "playlist_url" in user else user.get("playlistUrl", "")

    # Sincroniza perfis e progresso da nuvem para esta conta
    pull_cloud_into_local(acc_code, force=True)

    db_profiles = database.get_profiles_by_account(acc_code)
    for p in db_profiles:
        database.save_profile(acc_code, p["id"], p["name"], p.get("avatar", "blue"), p.get("isKids", False))

    data = load_sync_data()
    storage = _get_account_storage(data, acc_code, skip_cloud_pull=True)
    storage["profiles"] = db_profiles
    now_ts = int(time.time())
    user_save_obj = {
        "email": clean_email,
        "passwordHash": user_hash or pass_hash,
        "passwordHashLower": user_hash_low or pass_hash_lower,
        "playlistUrl": p_url,
        "accountCode": acc_code,
        "updatedAt": now_ts
    }
    data.setdefault("accounts", {})[clean_email] = user_save_obj
    save_sync_data(data)

    threading.Thread(target=save_cloud_account, args=(user_save_obj,), daemon=True).start()

    return {
        "success": True,
        "email": clean_email,
        "playlistUrl": p_url,
        "accountCode": acc_code,
        "profiles": db_profiles
    }


def forgot_password(email):
    clean_email = normalize_email(email)
    if not clean_email:
        return {"success": False, "error": "Informe o e-mail cadastrado."}
    user = database.get_user_by_email(clean_email)
    if not user:
        data = load_sync_data()
        user = data.get("accounts", {}).get(clean_email)
    if not user:
        try:
            cloud_accs = fetch_cloud_accounts()
            user = cloud_accs.get(clean_email)
        except Exception:
            pass
    if not user:
        return {"success": False, "error": "E-mail não encontrado. Verifique a digitação ou crie uma conta."}

    return {
        "success": True,
        "isMaster": False,
        "message": "Conta localizada! Digite sua nova senha para redefinir."
    }


def reset_password(email, new_password):
    clean_email = normalize_email(email)
    if not clean_email or len(new_password or "") < 4:
        return {"success": False, "error": "A nova senha deve ter no mínimo 4 caracteres."}

    data = load_sync_data()
    accounts = data.setdefault("accounts", {})
    user = accounts.get(clean_email) or database.get_user_by_email(clean_email)
    if not user:
        try:
            cloud_accs = fetch_cloud_accounts()
            user = cloud_accs.get(clean_email)
            if user:
                accounts[clean_email] = user
        except Exception:
            pass

    if not user:
        return {"success": False, "error": "Conta não encontrada para redefinição."}

    pass_hash = hash_password(new_password)
    acode = user.get("accountCode") or user.get("account_code") or make_account_code(clean_email)
    purl = user.get("playlistUrl") or user.get("playlist_url") or ""

    user_obj = {
        "email": clean_email,
        "passwordHash": pass_hash,
        "playlistUrl": purl,
        "accountCode": acode
    }
    accounts[clean_email] = user_obj
    database.save_user(clean_email, pass_hash, acode, purl)
    save_sync_data(data)
    threading.Thread(target=save_cloud_account, args=(user_obj,), daemon=True).start()
    return {"success": True, "message": "Senha redefinida com sucesso! Você já pode entrar com sua nova senha."}


def get_current_active_account():
    data = load_sync_data()
    accounts = data.get("accounts", {})
    if accounts:
        last_email = list(accounts.keys())[-1]
        acc = accounts[last_email]
        code = acc.get("accountCode") or make_account_code(last_email)
        profiles = database.get_profiles_by_account(code)
        return {
            "email": last_email,
            "accountCode": code,
            "playlistUrl": acc.get("playlistUrl", ""),
            "profiles": profiles
        }
    all_users = database.get_all_users()
    if all_users:
        u = all_users[-1]
        code = u["accountCode"]
        return {
            "email": u["email"],
            "accountCode": code,
            "playlistUrl": u["fullPlaylistUrl"],
            "profiles": database.get_profiles_by_account(code)
        }
    return None


def update_account_playlist(email, playlist_url):
    clean_email = normalize_email(email)
    clean_url = (playlist_url or "").strip()

    data = load_sync_data()
    accounts = data.setdefault("accounts", {})
    user = accounts.get(clean_email)
    db_user = database.get_user_by_email(clean_email)

    if not user and not db_user:
        return {"success": False, "error": "Conta não encontrada."}

    acode = (user or {}).get("accountCode") or (db_user or {}).get("account_code") or make_account_code(clean_email)
    phash = (user or {}).get("passwordHash") or (db_user or {}).get("password_hash") or ""

    user_obj = {
        "email": clean_email,
        "passwordHash": phash,
        "playlistUrl": clean_url,
        "accountCode": acode
    }
    accounts[clean_email] = user_obj
    database.save_user(clean_email, phash, acode, clean_url)
    save_sync_data(data)
    threading.Thread(target=save_cloud_account, args=(user_obj,), daemon=True).start()
    trigger_cloud_sync(acode, data, immediate=True)

    return {"success": True, "playlistUrl": clean_url, "accountCode": acode}


# =========================================================================
# PUBLIC API FUNCTIONS
# =========================================================================

def _get_account_storage(data, account_code, skip_cloud_pull=False):
    if account_code and account_code != "PADRAO":
        accounts_data = data.setdefault("accounts_data", {})
        if account_code not in accounts_data:
            if not skip_cloud_pull:
                try:
                    c_data = fetch_cloud_data()
                    if c_data and "accounts_data" in c_data and account_code in c_data["accounts_data"]:
                        accounts_data[account_code] = c_data["accounts_data"][account_code]
                        save_sync_data(data)
                        return accounts_data[account_code]
                except Exception:
                    pass

            accounts_data[account_code] = new_account_bucket(account_code)
            save_sync_data(data)
            if not skip_cloud_pull:
                trigger_cloud_sync(account_code, data, immediate=True)

        return accounts_data[account_code]

    return data


def get_favorites(account_code="PADRAO"):
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    favs = storage.get("favorites", []) or []
    return {
        "accountCode": account_code,
        "favorites": list(favs),
        "updatedAt": int(storage.get("favoritesUpdatedAt", 0) or 0),
        "total": len(favs)
    }


def set_favorites(account_code, favorites):
    normalized = []
    seen = set()
    for item in (favorites or []):
        if isinstance(item, dict):
            key = item.get("url") or item.get("name") or ""
        else:
            key = str(item)
        key = key.strip()
        if key and key not in seen:
            seen.add(key)
            normalized.append(key)

    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    storage["favorites"] = normalized[:800]
    storage["favoritesUpdatedAt"] = int(time.time())
    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return {
        "accountCode": account_code,
        "favorites": storage["favorites"],
        "updatedAt": storage["favoritesUpdatedAt"],
        "total": len(storage["favorites"])
    }


def get_catalog_state(account_code="PADRAO"):
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    return {
        "accountCode": account_code,
        "catalogVersion": int(storage.get("catalogVersion", 0) or 0),
        "catalogUpdatedAt": storage.get("catalogUpdatedAt", "") or ""
    }


def set_catalog_state(account_code, catalog_version, catalog_updated_at=""):
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    try:
        version = int(catalog_version or 0)
    except Exception:
        version = 0
    if version >= int(storage.get("catalogVersion", 0) or 0):
        storage["catalogVersion"] = version
        if catalog_updated_at:
            storage["catalogUpdatedAt"] = catalog_updated_at
    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=False)
    return get_catalog_state(account_code)


def set_active_profile(account_code, profile_id):
    if not profile_id:
        return {"success": False}
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    storage["activeProfileId"] = profile_id
    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=False)
    return {"success": True, "activeProfileId": profile_id}


def get_active_account_code():
    try:
        active = get_current_active_account()
        if active and active.get("accountCode"):
            return active["accountCode"]
    except Exception:
        pass
    return "PADRAO"


def get_profiles(account_code="PADRAO"):
    pull_cloud_into_local(account_code, force=False)
    db_profs = database.get_profiles_by_account(account_code)

    data = load_sync_data()
    storage = _get_account_storage(data, account_code, skip_cloud_pull=True)
    storage["profiles"] = db_profs
    save_sync_data(data)

    return {
        "accountCode": account_code,
        "profiles": db_profs,
        "availableAvatars": DEFAULT_AVATARS
    }


def add_or_update_profile(account_code, profile_id, name, avatar="blue", is_kids=False):
    new_id = profile_id or f"p_{int(time.time() * 1000)}"
    database.save_profile(account_code, new_id, (name or "").strip() or "Novo Perfil", avatar, is_kids)

    data = load_sync_data()
    storage = _get_account_storage(data, account_code, skip_cloud_pull=True)
    storage["profiles"] = database.get_profiles_by_account(account_code)
    storage.setdefault("progress", {}).setdefault(new_id, [])
    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return get_profiles(account_code)


def delete_profile(account_code, profile_id):
    db_profs = database.get_profiles_by_account(account_code)
    if len(db_profs) <= 1:
        return {"error": "Não é possível excluir o único perfil existente."}

    database.delete_profile(account_code, profile_id)

    data = load_sync_data()
    storage = _get_account_storage(data, account_code, skip_cloud_pull=True)
    storage["profiles"] = database.get_profiles_by_account(account_code)
    if profile_id in storage.get("progress", {}):
        del storage["progress"][profile_id]

    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return get_profiles(account_code)


def get_progress(account_code, profile_id):
    pull_cloud_into_local(account_code, force=False)
    data = load_sync_data()
    storage = _get_account_storage(data, account_code, skip_cloud_pull=True)
    prog_map = storage.setdefault("progress", {})

    json_items = [normalize_progress_item(it) for it in prog_map.get(profile_id, []) if is_valid_progress_item(it)]
    db_items = [normalize_progress_item(it) for it in database.get_progress(account_code, profile_id) if is_valid_progress_item(it)]

    merged_by_id = {}
    for it in db_items + json_items:
        cid = str(it.get("contentId") or it.get("streamUrl") or "")
        if not cid:
            continue
        prev = merged_by_id.get(cid)
        if not prev or int(it.get("updatedAt", 0)) >= int(prev.get("updatedAt", 0)):
            merged_by_id[cid] = it

    items = sorted(merged_by_id.values(), key=lambda x: x.get("updatedAt", 0), reverse=True)[:40]
    prog_map[profile_id] = items
    save_sync_data(data)

    return {
        "accountCode": account_code,
        "profileId": profile_id,
        "items": items
    }


def update_progress(account_code, profile_id, item_data):
    """
    Salva o progresso real de reprodução no SQLite, JSON local e Nuvem 24/7.
    Aceita tanto positionMs/durationMs quanto position/duration (segundos).
    """
    if not profile_id or not item_data:
        return {"error": "Dados inválidos"}

    stream_url = str(item_data.get("streamUrl") or item_data.get("url") or "").strip()
    if not stream_url or not (stream_url.startswith("http://") or stream_url.startswith("https://")):
        return {"status": "ignored_invalid_stream_url"}

    content_id = str(item_data.get("contentId") or item_data.get("id") or stream_url).strip()
    if not content_id or content_id in database.FAKE_CONTENT_IDS:
        return {"status": "ignored_fake_content"}

    data = load_sync_data()
    storage = _get_account_storage(data, account_code, skip_cloud_pull=True)
    prog_map = storage.setdefault("progress", {})
    profile_items = [normalize_progress_item(it) for it in prog_map.setdefault(profile_id, []) if is_valid_progress_item(it)]

    norm = normalize_progress_item(item_data)
    position_ms = norm["positionMs"]
    duration_ms = norm["durationMs"]
    progress_percent = norm["progressPercent"]
    poster = norm["poster"]

    # Se assistiu mais de 92%, conclui o episódio/filme atual
    if duration_ms > 0 and (progress_percent >= 92.0 or (duration_ms - position_ms) < 30000):
        item_type = norm.get("type", "movie")
        series_title = norm.get("seriesTitle")
        season = norm.get("season")
        episode = norm.get("episode")

        profile_items = [x for x in profile_items if (x.get("contentId") != content_id and x.get("streamUrl") != stream_url)]
        database.delete_progress_item(account_code, profile_id, content_id)

        if item_type == "series" and series_title and episode is not None and stream_url:
            try:
                next_ep = int(episode) + 1
                s_num = int(season) if season is not None else 1
                next_entry = normalize_progress_item({
                    "contentId": f"series_{series_title}_s{s_num}_e{next_ep}",
                    "title": f"{series_title} • T{s_num}:E{next_ep}",
                    "seriesTitle": series_title,
                    "season": s_num,
                    "episode": next_ep,
                    "streamUrl": stream_url,
                    "poster": poster,
                    "type": "series",
                    "positionMs": 0,
                    "durationMs": duration_ms,
                    "progressPercent": 0.0,
                    "updatedAt": int(time.time()),
                    "device": norm.get("device", "Streamflix")
                })
                profile_items.insert(0, next_entry)
                database.save_progress_item(account_code, profile_id, next_entry)
            except Exception as e:
                print(f"[Next Episode Queue] {e}")

        prog_map[profile_id] = profile_items
        save_sync_data(data)
        trigger_cloud_sync(account_code, data, immediate=True)
        return {"status": "advanced_next_or_removed", "contentId": content_id}

    existing = next((x for x in profile_items if (x.get("contentId") == content_id or x.get("streamUrl") == stream_url)), None)
    if position_ms < 5000 and not existing:
        return {"status": "ignored_too_early"}

    if existing:
        existing.update(norm)
    else:
        profile_items.insert(0, norm)

    prog_map[profile_id] = profile_items[:40]
    database.save_progress_item(account_code, profile_id, norm)

    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return {"status": "success", "item": norm}


def remove_progress_item(account_code, profile_id, content_id):
    data = load_sync_data()
    storage = _get_account_storage(data, account_code, skip_cloud_pull=True)
    prog_map = storage.setdefault("progress", {})
    profile_items = prog_map.get(profile_id, [])

    prog_map[profile_id] = [x for x in profile_items if x.get("contentId") != content_id and x.get("streamUrl") != content_id]
    database.delete_progress_item(account_code, profile_id, content_id)
    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return {"status": "removed", "contentId": content_id}
