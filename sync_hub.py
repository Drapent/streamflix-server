import database
"""
Sync Hub for IPTV (PC, Mobile and TV)
Manages Netflix-style User Profiles and Cross-Device Playback Synchronization ('Continuar Assistindo').
Supports both Local JSON persistence and Cloud Relay synchronization.
"""

import json
import time
import urllib.request
import urllib.parse
import hashlib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SYNC_DATA_FILE = BASE_DIR / "sync_data.json"

DEFAULT_AVATARS = [
    {"id": "blue", "name": "Azul Neon", "color": "#00d2ff", "icon": "📺"},
    {"id": "purple", "name": "Roxo Cyber", "color": "#9d4edd", "icon": "🎬"},
    {"id": "red", "name": "Vermelho Live", "color": "#ff3366", "icon": "⚡"},
    {"id": "green", "name": "Verde Matrix", "color": "#00f5d4", "icon": "⭐"},
    {"id": "gold", "name": "Dourado VIP", "color": "#ffd166", "icon": "👑"},
    {"id": "kids", "name": "Kids / Infantil", "color": "#ff9f1c", "icon": "🧸", "isKids": True}
]

# Chaves por conta que precisam sobreviver ao relay da nuvem.
# Antes, o push sobrescrevia `accounts_data[code]` inteiro com apenas
# {profiles, progress} e apagava tudo o mais que o celular/TV tivessem enviado.
SYNC_EXTRA_KEYS = ("favorites", "favoritesUpdatedAt", "catalogVersion", "catalogUpdatedAt", "activeProfileId")

def new_account_bucket():
    """Estrutura de uma conta nova, já com todas as chaves conhecidas."""
    return {
        "profiles": [
            {
                "id": "p1",
                "name": "Principal",
                "avatar": "blue",
                "isKids": False,
                "createdAt": int(time.time())
            }
        ],
        "progress": {"p1": []},
        "favorites": [],
        "favoritesUpdatedAt": 0,
        "catalogVersion": 0,
        "catalogUpdatedAt": ""
    }

def load_sync_data():
    if SYNC_DATA_FILE.exists():
        try:
            with open(SYNC_DATA_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                d.setdefault("accounts", {})
                d.setdefault("accounts_data", {})
                return d
        except Exception as e:
            print(f"[SyncHub] Erro ao carregar sync_data.json: {e}")
    
    # Default structure
    data = {
        "accountCode": "PADRAO",
        "profiles": [
            {
                "id": "p1",
                "name": "Principal",
                "avatar": "blue",
                "isKids": False,
                "createdAt": int(time.time())
            }
        ],
        "progress": {
            "p1": []
        },
        "accounts": {},
        "accounts_data": {}
    }
    save_sync_data(data)
    return data

def save_sync_data(data):
    try:
        with open(SYNC_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[SyncHub] Erro ao salvar sync_data.json: {e}")

import queue
import threading

# Cloud Relay 24/7 (Sincronização na nuvem acessível de qualquer dispositivo mesmo com PC desligado)
CLOUD_OBJECT_URL = "https://ntfy.sh/iptv_cloud_sync_angeloregis_bd24"
CLOUD_ACCOUNTS_URL = "https://ntfy.sh/iptv_cloud_accounts_angeloregis_bd24"

_CLOUD_QUEUE = queue.Queue(maxsize=100)
_LAST_CLOUD_SYNC_TIME = 0

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
    """Lê todas as contas cadastradas na nuvem 24/7."""
    try:
        req = urllib.request.Request(
            f"{CLOUD_ACCOUNTS_URL}/json?poll=1",
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
                    try:
                        ev = json.loads(line)
                        if ev.get("event") == "message" and "message" in ev:
                            latest = json.loads(ev["message"])
                    except Exception:
                        pass
                if latest:
                    return latest.get("accounts", latest)
    except Exception as e:
        print(f"[SyncHub Cloud Accounts Fetch] {e}")
    return {}

def save_cloud_account(account_obj):
    """Salva ou atualiza uma conta diretamente na nuvem 24/7 para acesso em PC, Celular e TV."""
    if not account_obj or not account_obj.get("email"):
        return False
    try:
        email = account_obj["email"].strip().lower()
        accounts = fetch_cloud_accounts() or {}
        accounts[email] = {
            "email": email,
            "passwordHash": account_obj.get("passwordHash", ""),
            "playlistUrl": account_obj.get("playlistUrl", ""),
            "accountCode": account_obj.get("accountCode", "ACC_DEFAULT"),
            "createdAt": account_obj.get("createdAt", int(time.time()))
        }
        payload = json.dumps({"accounts": accounts}).encode("utf-8")
        req = urllib.request.Request(
            CLOUD_ACCOUNTS_URL,
            data=payload,
            headers={
                "Cache": "yes",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            return resp.status in (200, 201)
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
        acc_code = account_code or "PADRAO"
        cloud_data = fetch_cloud_data() or {}
        
        # Obtém perfis e progresso da conta específica sendo sincronizada
        storage = _get_account_storage(data_to_push, acc_code)
        acc_profiles = storage.get("profiles", [])
        acc_progress = storage.get("progress", {})
        # Favoritos e versão do catálogo também viajam para a nuvem, senão o
        # celular perde o que markou fora da rede de casa.
        acc_extra = {k: storage.get(k) for k in SYNC_EXTRA_KEYS if storage.get(k) not in (None, "", [], {})}

        # Atualiza accounts_data mantendo histórico recente compacto
        cloud_accounts_data = dict(cloud_data.get("accounts_data", {}))
        if len(cloud_accounts_data) > 4:
            keys = list(cloud_accounts_data.keys())[-3:]
            cloud_accounts_data = {k: cloud_accounts_data[k] for k in keys}

        # Mescla com o que já está na nuvem: um device pode ter favoritos
        # enquanto outro tem progresso mais recente. Nada é descartado.
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

        req = urllib.request.Request(
            CLOUD_OBJECT_URL,
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

        # Também sincroniza contas ativas para CLOUD_ACCOUNTS_URL se presentes
        if "accounts" in data_to_push and data_to_push["accounts"]:
            try:
                c_accounts = fetch_cloud_accounts() or {}
                for email, acc in data_to_push["accounts"].items():
                    c_accounts[email] = {
                        "email": email,
                        "passwordHash": acc.get("passwordHash", ""),
                        "playlistUrl": acc.get("playlistUrl", ""),
                        "accountCode": acc.get("accountCode", "ACC_DEFAULT"),
                        "createdAt": acc.get("createdAt", int(time.time()))
                    }
                acc_payload = json.dumps({"accounts": c_accounts}).encode("utf-8")
                acc_req = urllib.request.Request(
                    CLOUD_ACCOUNTS_URL,
                    data=acc_payload,
                    headers={
                        "Cache": "yes",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(acc_req, timeout=4.0) as a_resp:
                    pass
            except Exception as e:
                print(f"[SyncHub Cloud Accounts Sync] {e}")

        return True
    except Exception as e:
        print(f"[SyncHub Cloud Sync] {e}")
    return None

def trigger_cloud_sync(account_code, data_to_push, immediate=False):
    """
    Enfileira a sincronização na Nuvem 24/7 sem bloquear a resposta da API local.
    Garante salvamento com latência < 2ms no servidor e push ultra-rápido.
    """
    if not data_to_push:
        return
    try:
        accounts_data = {}
        for code, bucket in (data_to_push.get("accounts_data", {}) or {}).items():
            if not isinstance(bucket, dict):
                continue
            copy_bucket = {
                "profiles": list(bucket.get("profiles", [])),
                "progress": {k: list(v) for k, v in (bucket.get("progress", {}) or {}).items()},
            }
            for key in SYNC_EXTRA_KEYS:
                if key in bucket:
                    copy_bucket[key] = bucket[key]
            accounts_data[code] = copy_bucket

        snapshot = {
            "profiles": list(data_to_push.get("profiles", [])),
            "progress": {k: list(v) for k, v in data_to_push.get("progress", {}).items()},
            "accounts": dict(data_to_push.get("accounts", {})),
            "accounts_data": accounts_data
        }
        _CLOUD_QUEUE.put_nowait((account_code, snapshot, immediate))
    except queue.Full:
        pass

def sync_with_cloud(account_code, data_to_push=None):
    """Compatibilidade síncrona/direta"""
    trigger_cloud_sync(account_code, data_to_push, immediate=True)
    return True

# =========================================================================
# MULTI-ACCOUNT AUTH & REPRODUÇÃO PESSOAL (ESTILO NETFLIX)
# =========================================================================

def hash_password(password):
    return hashlib.sha256(password.strip().encode("utf-8")).hexdigest()

def register_account(email, password, playlist_url=""):
    clean_email = email.strip().lower()
    if not clean_email or "@" not in clean_email:
        return {"success": False, "error": "Informe um e-mail válido."}
    if len(password) < 4:
        return {"success": False, "error": "A senha deve ter no mínimo 4 caracteres."}

    pass_hash = hash_password(password)
    clean_url = (playlist_url or "").strip()

    # Validação no Banco de Dados SQLite e sync_data.json
    db_user = database.get_user_by_email(clean_email)
    data = load_sync_data()
    accounts = data.setdefault("accounts", {})

    if db_user or clean_email in accounts:
        return {"success": False, "error": "Este e-mail já possui uma conta cadastrada. Faça login."}

    # POLÍTICA DE DADOS & PRIVACIDADE ESTRITA:
    # A lista oficial do Master pertence unicamente a Angelo Regis.
    # Novos usuários DEVEM obrigatoriamente fornecer sua própria lista M3U.
    MASTER_EMAILS = ("angeloregis@gmail.com", "angelo.regis@gmail.com")
    MASTER_PLAYLIST = "http://5664.in/ts/919647767/c114f4545b"

    if clean_email in MASTER_EMAILS:
        account_code = "ACC_BD24EFDF"
        clean_url = MASTER_PLAYLIST
    else:
        if not clean_url or not clean_url.startswith("http"):
            return {"success": False, "error": "Para criar sua conta, é obrigatório informar o link da sua própria lista M3U ou Xtream."}
        if "5664.in" in clean_url or "919647767/c114f4545b" in clean_url:
            return {"success": False, "error": "Esta lista IPTV é restrita e privada. Você deve cadastrar o link da sua própria lista."}
        account_code = f"ACC_{pass_hash[:8].upper()}"

    # Salva no Banco de Dados SQLite Permanente
    database.save_user(clean_email, pass_hash, account_code, clean_url)

    # Configuração inicial de perfil
    if clean_email in MASTER_EMAILS:
        database.save_profile(account_code, "p_1790407508065", "Carlos", "gold", False)
        database.save_profile(account_code, "p_1790717094118", "Angelo", "blue", False)
    else:
        database.save_profile(account_code, "p1", "Principal", "blue", False)

    # Salva também em sync_data.json para compatibilidade local
    user_obj = {
        "email": clean_email,
        "passwordHash": pass_hash,
        "playlistUrl": clean_url,
        "accountCode": account_code,
        "createdAt": int(time.time())
    }
    accounts[clean_email] = user_obj
    bucket = data.setdefault("accounts_data", {}).setdefault(account_code, new_account_bucket())
    bucket["profiles"] = database.get_profiles_by_account(account_code)
    save_sync_data(data)

    # Salva na Nuvem 24/7 (CLOUD_ACCOUNTS_URL) para que Celular, PC e TV acessem com a mesma senha
    threading.Thread(target=save_cloud_account, args=(user_obj,), daemon=True).start()
    trigger_cloud_sync(account_code, data, immediate=True)

    return {
        "success": True,
        "email": clean_email,
        "playlistUrl": clean_url,
        "accountCode": account_code
    }

def login_account(email, password):
    clean_email = email.strip().lower()
    pass_hash = hash_password(password)

    # 1. Busca primeiro no Banco de Dados SQLite Permanente
    user = database.get_user_by_email(clean_email)

    data = load_sync_data()
    accounts = data.get("accounts", {})

    if not user:
        # Fallback para sync_data.json
        if clean_email in accounts:
            user = accounts[clean_email]
            database.save_user(clean_email, user.get("passwordHash", pass_hash), user.get("accountCode", "PADRAO"), user.get("playlistUrl", ""))

    if not user:
        # Busca conta na Nuvem 24/7 (cadastrada pelo celular ou outro aparelho)
        try:
            cloud_accounts = fetch_cloud_accounts()
            if clean_email in cloud_accounts:
                c_user = cloud_accounts[clean_email]
                user = {
                    "email": clean_email,
                    "password_hash": c_user.get("passwordHash", ""),
                    "passwordHash": c_user.get("passwordHash", ""),
                    "account_code": c_user.get("accountCode", f"ACC_{pass_hash[:8].upper()}"),
                    "accountCode": c_user.get("accountCode", f"ACC_{pass_hash[:8].upper()}"),
                    "playlist_url": c_user.get("playlistUrl", ""),
                    "playlistUrl": c_user.get("playlistUrl", "")
                }
                accounts[clean_email] = c_user
                database.save_user(clean_email, user["password_hash"], user["account_code"], user["playlist_url"])
                save_sync_data(data)
        except Exception as e:
            print(f"[SyncHub Login Cloud Check] {e}")

    # Se ainda assim não encontrar, retorna erro explícito orientando a criar conta
    if not user:
        return {
            "success": False,
            "error": "Usuário não cadastrado. Por favor, crie sua conta e adicione sua própria lista M3U."
        }

    user_hash = user.get("password_hash") or user.get("passwordHash") or ""
    MASTER_HASHES = (
        "bd24efdf0cfcc922a9bc5bbbaea9982479c240d0e8387a23b07779fc49cc70f2", # Carlos25Marina15
        "233f2170623276d41b26b4f8211ed6907cc38be008dfb50e1e25c6c767d1495c"  # carlos25marina15
    )
    if clean_email in ("angeloregis@gmail.com", "angelo.regis@gmail.com"):
        if pass_hash not in MASTER_HASHES:
            return {"success": False, "error": "Senha incorreta. Verifique suas credenciais."}
    elif user_hash != pass_hash:
        return {"success": False, "error": "Senha incorreta. Verifique suas credenciais."}

    acc_code = user.get("account_code") or user.get("accountCode") or f"ACC_{pass_hash[:8].upper()}"
    p_url = user.get("playlist_url") if "playlist_url" in user else user.get("playlistUrl", "")

    # Proteção de privacidade: lista Master nunca vaza para terceiros
    if clean_email not in ("angeloregis@gmail.com", "angelo.regis@gmail.com"):
        if p_url == "http://5664.in/ts/919647767/c114f4545b":
            p_url = ""
            database.update_user_playlist(clean_email, "")

    # Garante perfis no SQLite
    db_profiles = database.get_profiles_by_account(acc_code)
    storage = _get_account_storage(data, acc_code)
    storage["profiles"] = db_profiles
    save_sync_data(data)

    user_save_obj = {
        "email": clean_email,
        "passwordHash": pass_hash,
        "playlistUrl": p_url,
        "accountCode": acc_code
    }
    threading.Thread(target=save_cloud_account, args=(user_save_obj,), daemon=True).start()

    return {
        "success": True,
        "email": clean_email,
        "playlistUrl": p_url,
        "accountCode": acc_code,
        "profiles": db_profiles
    }


def forgot_password(email):
    clean_email = email.strip().lower()
    if not clean_email:
        return {"success": False, "error": "Informe o e-mail cadastrado."}
    if clean_email in ("angeloregis@gmail.com", "angelo.regis@gmail.com"):
        return {
            "success": True,
            "isMaster": True,
            "hint": "A senha oficial da sua conta é: Carlos25Marina15",
            "password": "Carlos25Marina15"
        }
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
    clean_email = email.strip().lower()
    if not clean_email or len(new_password) < 4:
        return {"success": False, "error": "A nova senha deve ter no mínimo 4 caracteres."}
    
    data = load_sync_data()
    accounts = data.setdefault("accounts", {})
    user = accounts.get(clean_email)
    if not user:
        try:
            cloud_accs = fetch_cloud_accounts()
            user = cloud_accs.get(clean_email)
            if user:
                accounts[clean_email] = user
        except Exception:
            pass
            
    if not user and clean_email not in ("angeloregis@gmail.com", "angelo.regis@gmail.com"):
        return {"success": False, "error": "Conta não encontrada para redefinição."}
        
    pass_hash = hash_password(new_password)
    if not user:
        user = {
            "email": clean_email,
            "passwordHash": pass_hash,
            "playlistUrl": "http://5664.in/ts/919647767/c114f4545b",
            "accountCode": "ACC_BD24EFDF"
        }
        accounts[clean_email] = user
    else:
        user["passwordHash"] = pass_hash
        
    save_sync_data(data)
    threading.Thread(target=save_cloud_account, args=(user,), daemon=True).start()
    return {"success": True, "message": "Senha redefinida com sucesso! Você já pode entrar com sua nova senha."}

def get_current_active_account():
    data = load_sync_data()
    accounts = data.get("accounts", {})
    if "angeloregis@gmail.com" in accounts:
        acc = accounts["angeloregis@gmail.com"]
        code = acc.get("accountCode", "ACC_BD24EFDF")
        acc_data = data.get("accounts_data", {}).get(code, {})
        profiles = acc_data.get("profiles", [{"id": "p_1790407508065", "name": "Carlos", "avatar": "gold"}])
        return {
            "email": "angeloregis@gmail.com",
            "accountCode": code,
            "playlistUrl": acc.get("playlistUrl", "http://5664.in/ts/919647767/c114f4545b"),
            "profiles": profiles
        }
    if accounts:
        first_email = list(accounts.keys())[-1]
        acc = accounts[first_email]
        code = acc.get("accountCode", "PADRAO")
        acc_data = data.get("accounts_data", {}).get(code, {})
        return {
            "email": first_email,
            "accountCode": code,
            "playlistUrl": acc.get("playlistUrl", ""),
            "profiles": acc_data.get("profiles", [])
        }
    return None

def update_account_playlist(email, playlist_url):
    clean_email = email.strip().lower()
    clean_url = (playlist_url or "").strip()

    data = load_sync_data()
    accounts = data.get("accounts", {})
    user = accounts.get(clean_email)

    if not user:
        return {"success": False, "error": "Conta não encontrada."}

    user["playlistUrl"] = clean_url
    save_sync_data(data)
    trigger_cloud_sync(user.get("accountCode", "PADRAO"), data, immediate=True)

    return {"success": True, "playlistUrl": clean_url}

# =========================================================================
# PUBLIC API FUNCTIONS
# =========================================================================

def _get_account_storage(data, account_code):
    if account_code and account_code != "PADRAO":
        accounts_data = data.setdefault("accounts_data", {})
        if account_code == "ACC_BD24EFDF":
            acc_entry = accounts_data.setdefault(account_code, new_account_bucket())
            cur_profs = acc_entry.get("profiles", [])
            prof_names = [p.get("name") for p in cur_profs]
            if "Carlos" not in prof_names or "Angelo" not in prof_names:
                acc_entry["profiles"] = [
                    {"id": "p_1790407508065", "name": "Carlos", "avatar": "gold", "isKids": False, "createdAt": 1790407508},
                    {"id": "p_1790717094118", "name": "Angelo", "avatar": "blue", "isKids": False, "createdAt": 1790717093}
                ]
                save_sync_data(data)
                trigger_cloud_sync(account_code, data, immediate=True)
            return acc_entry
        if account_code not in accounts_data:
            # Tenta buscar perfis da conta na nuvem primeiro
            try:
                c_data = fetch_cloud_data()
                if c_data and "accounts_data" in c_data and account_code in c_data["accounts_data"]:
                    accounts_data[account_code] = c_data["accounts_data"][account_code]
                    save_sync_data(data)
                    return accounts_data[account_code]
            except Exception:
                pass
            
            # Se for uma conta nova ainda sem perfis, inicia estritamente com "Principal"
            accounts_data[account_code] = new_account_bucket()
            save_sync_data(data)
            trigger_cloud_sync(account_code, data, immediate=True)

        return accounts_data[account_code]

    return data

# =========================================================================
# FAVORITOS E VERSÃO DO CATÁLOGO (sincronizados entre PC, Celular e TV)
# =========================================================================

def get_favorites(account_code="PADRAO"):
    """Favoritos compartilhados da conta (lista de URLs/nomes)."""
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
    """
    Substitui a lista de favoritos da conta e propaga para a nuvem.
    Aceita uma lista simples de strings (url/nome) ou objetos {url,name}.
    """
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
    """Qual versão do catálogo cada aparelho já viu (para forçar atualização)."""
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
    # Só avança: um aparelho atrasado não pode fazer a conta "voltar" no tempo.
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
    """Conta ativa do PC (para espelhar favoritos/progresso sem informar o código)."""
    try:
        data = load_sync_data()
        accounts = data.get("accounts", {})
        if "angeloregis@gmail.com" in accounts:
            return accounts["angeloregis@gmail.com"].get("accountCode", "PADRAO")
        if accounts:
            last_email = list(accounts.keys())[-1]
            return accounts[last_email].get("accountCode", "PADRAO")
    except Exception:
        pass
    return "PADRAO"

def get_profiles(account_code="PADRAO"):
    # Consulta o SQLite
    db_profs = database.get_profiles_by_account(account_code)
    
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    storage["profiles"] = db_profs
    save_sync_data(data)

    return {
        "accountCode": account_code,
        "profiles": db_profs,
        "availableAvatars": DEFAULT_AVATARS
    }

def add_or_update_profile(account_code, profile_id, name, avatar="blue", is_kids=False):
    new_id = profile_id or f"p_{int(time.time())}"
    database.save_profile(account_code, new_id, name.strip() or "Novo Perfil", avatar, is_kids)

    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
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
    storage = _get_account_storage(data, account_code)
    storage["profiles"] = database.get_profiles_by_account(account_code)
    if profile_id in storage.get("progress", {}):
        del storage["progress"][profile_id]

    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return get_profiles(account_code)


def get_progress(account_code, profile_id):
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    prog_map = storage.setdefault("progress", {})
    items = prog_map.get(profile_id, [])
    # Sort by updatedAt desc
    items = sorted(items, key=lambda x: x.get("updatedAt", 0), reverse=True)
    return {
        "accountCode": account_code,
        "profileId": profile_id,
        "items": items
    }

def update_progress(account_code, profile_id, item_data):
    """
    item_data:
      contentId, title, seriesTitle, season, episode,
      streamUrl, poster, positionMs, durationMs, device
    """
    if not profile_id or not item_data:
        return {"error": "Dados inválidos"}
    
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    prog_map = storage.setdefault("progress", {})
    profile_items = prog_map.setdefault(profile_id, [])
    
    content_id = item_data.get("contentId") or item_data.get("id") or item_data.get("streamUrl") or item_data.get("url")
    if not content_id:
        return {"error": "contentId ou streamUrl obrigatório"}
    
    stream_url = item_data.get("streamUrl") or item_data.get("url") or ""
    poster = item_data.get("poster") or item_data.get("backdrop") or item_data.get("logo") or ""
    
    pos_raw = item_data.get("positionMs")
    if pos_raw is None:
        pos_raw = float(item_data.get("position", 0)) * 1000
    position_ms = max(0, int(pos_raw))
    
    dur_raw = item_data.get("durationMs")
    if dur_raw is None:
        dur_raw = float(item_data.get("duration", 0)) * 1000
    duration_ms = max(0, int(dur_raw))
    
    progress_percent = 0.0
    if duration_ms > 0:
        progress_percent = round((position_ms / duration_ms) * 100, 1)
    elif item_data.get("percentage") is not None:
        progress_percent = float(item_data.get("percentage"))
    
    # If watched more than 95%, advance to next episode or remove
    if duration_ms > 0 and (progress_percent >= 92.0 or (duration_ms - position_ms) < 30000):
        item_type = item_data.get("type", "movie")
        series_title = item_data.get("seriesTitle")
        season = item_data.get("season")
        episode = item_data.get("episode")
        
        # Remove current completed episode
        profile_items = [x for x in profile_items if (x.get("contentId") != content_id and x.get("streamUrl") != item_data.get("streamUrl"))]
        
        # If it was a series episode, automatically prepare next episode in Continue Watching queue (Netflix behavior)
        if item_type == "series" and series_title and episode is not None:
            try:
                next_ep = int(episode) + 1
                s_num = int(season) if season is not None else 1
                next_entry = {
                    "contentId": f"series_{series_title}_s{s_num}_e{next_ep}",
                    "title": f"{series_title} • T{s_num}:E{next_ep}",
                    "seriesTitle": series_title,
                    "season": s_num,
                    "episode": next_ep,
                    "streamUrl": item_data.get("streamUrl", ""),
                    "poster": item_data.get("poster", ""),
                    "type": "series",
                    "positionMs": 0,
                    "durationMs": duration_ms,
                    "progressPercent": 0.0,
                    "updatedAt": int(time.time()),
                    "device": item_data.get("device", "Desktop")
                }
                profile_items.insert(0, next_entry)
            except Exception as e:
                print(f"[Next Episode Queue] {e}")
        
        prog_map[profile_id] = profile_items
        save_sync_data(data)
        trigger_cloud_sync(account_code, data, immediate=True)
        return {"status": "advanced_next_or_removed", "contentId": content_id}
    
    # If watched less than 10 seconds, don't clutter unless it already exists
    existing = next((x for x in profile_items if (x.get("contentId") == content_id or x.get("streamUrl") == item_data.get("streamUrl"))), None)
    if position_ms < 10000 and not existing:
        return {"status": "ignored_too_early"}
    
    updated_entry = {
        "contentId": content_id,
        "title": item_data.get("title", "Sem Título"),
        "seriesTitle": item_data.get("seriesTitle"),
        "season": item_data.get("season"),
        "episode": item_data.get("episode"),
        "streamUrl": item_data.get("streamUrl", ""),
        "poster": item_data.get("poster", ""),
        "type": item_data.get("type", "movie"),
        "positionMs": position_ms,
        "durationMs": duration_ms,
        "progressPercent": progress_percent,
        "updatedAt": int(time.time()),
        "device": item_data.get("device", "Desktop")
    }
    
    if existing:
        existing.update(updated_entry)
    else:
        profile_items.insert(0, updated_entry)
    
    # Keep max 40 items per profile
    prog_map[profile_id] = profile_items[:40]
    
    save_sync_data(data)
    is_immediate = (progress_percent >= 90.0 or duration_ms == 0 or position_ms > 0)
    trigger_cloud_sync(account_code, data, immediate=is_immediate)
    return {"status": "success", "item": updated_entry}

def remove_progress_item(account_code, profile_id, content_id):
    data = load_sync_data()
    storage = _get_account_storage(data, account_code)
    prog_map = storage.setdefault("progress", {})
    profile_items = prog_map.get(profile_id, [])
    
    prog_map[profile_id] = [x for x in profile_items if x.get("contentId") != content_id and x.get("streamUrl") != content_id]
    save_sync_data(data)
    trigger_cloud_sync(account_code, data, immediate=True)
    return {"status": "removed", "contentId": content_id}
