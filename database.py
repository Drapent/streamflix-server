"""
Database Persistence Module for STREAMFLIX Cinema
Uses SQLite for zero-loss, ACID persistent storage of:
- Users (Credentials, Passwords hashed with SHA-256, Deterministic Account Codes, Playlist URLs)
- Profiles (Netflix / Prime Video style user profiles per account)
- Watch Progress ('Continuar Assistindo' cross-device playback state)
"""

import sqlite3
import json
import time
import os
import hashlib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "streamflix.db"
SYNC_DATA_FILE = BASE_DIR / "sync_data.json"

FAKE_CONTENT_IDS = {
    "1415",
    "cont_tlou", "cont_fallout", "cont_the_boys", "cont_one_piece", "cont_duna_2",
    "tlou_demo", "fallout_demo", "theboys_demo", "dune2_demo",
    "mov_1", "mov_2", "mov_3", "mov_4", "mov_5", "mov_6",
    "ep_tb_1", "ep_tb_2", "ep_tb_3", "ep_tb_4",
    "tr_tlou", "tr_duna_2", "tr_top_gun", "tr_wandinha", "tr_house_dragon", "tr_shogun",
    "an_cur_1", "an_cur_2", "an_cur_3", "an_cur_4", "an_cur_5", "an_cur_6", "an_cur_7", "an_cur_8",
    "hero_top_gun", "hero_tlou"
}


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def make_account_code(email: str) -> str:
    clean = normalize_email(email)
    if not clean:
        return "ACC_DEFAULT"
    return "ACC_" + hashlib.sha256(clean.encode("utf-8")).hexdigest()[:8].upper()


def is_valid_progress_item(item: dict) -> bool:
    if not isinstance(item, dict):
        return False
    cid = str(item.get("contentId") or item.get("id") or "").strip()
    if not cid or cid in FAKE_CONTENT_IDS:
        return False
    stream_url = str(item.get("streamUrl") or item.get("url") or "").strip()
    if not stream_url or not (stream_url.startswith("http://") or stream_url.startswith("https://")):
        return False
    if "example.com" in stream_url:
        return False
    return True


def get_connection():
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass
    return conn


def init_db():
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS system_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    email TEXT PRIMARY KEY COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    account_code TEXT NOT NULL,
                    playlist_url TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS profiles (
                    id TEXT PRIMARY KEY,
                    account_code TEXT NOT NULL,
                    name TEXT NOT NULL,
                    avatar TEXT NOT NULL,
                    is_kids INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_profiles_account ON profiles(account_code)")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS watch_progress (
                    account_code TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    content_id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (account_code, profile_id, content_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_progress_account_profile ON watch_progress(account_code, profile_id)")

            # Verifica se o Reset Completo v3 já foi executado
            reset_row = conn.execute("SELECT value FROM system_meta WHERE key = 'clean_reset_v3'").fetchone()
            if not reset_row:
                conn.execute("DELETE FROM users")
                conn.execute("DELETE FROM profiles")
                conn.execute("DELETE FROM watch_progress")
                conn.execute("INSERT INTO system_meta (key, value) VALUES ('clean_reset_v3', '1')")
                if SYNC_DATA_FILE.exists():
                    try:
                        with open(SYNC_DATA_FILE, "w", encoding="utf-8") as f:
                            json.dump({"accounts": {}, "accounts_data": {}, "profiles": [], "progress": {}}, f)
                    except Exception:
                        pass

            # Limpa qualquer item falso existente no watch_progress
            rows = conn.execute("SELECT account_code, profile_id, content_id, data FROM watch_progress").fetchall()
            for r in rows:
                cid = str(r["content_id"])
                should_delete = cid in FAKE_CONTENT_IDS
                if not should_delete:
                    try:
                        parsed = json.loads(r["data"])
                        if not is_valid_progress_item(parsed):
                            should_delete = True
                    except Exception:
                        should_delete = True
                if should_delete:
                    conn.execute(
                        "DELETE FROM watch_progress WHERE account_code = ? AND profile_id = ? AND content_id = ?",
                        (r["account_code"], r["profile_id"], cid)
                    )
    finally:
        conn.close()


def reset_all_accounts():
    """Executa um reset completo apagando todas as contas, perfis e histórico."""
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM users")
            conn.execute("DELETE FROM profiles")
            conn.execute("DELETE FROM watch_progress")
        if SYNC_DATA_FILE.exists():
            with open(SYNC_DATA_FILE, "w", encoding="utf-8") as f:
                json.dump({"accounts": {}, "accounts_data": {}, "profiles": [], "progress": {}}, f)
        return True
    finally:
        conn.close()


def get_user_by_email(email):
    clean = normalize_email(email)
    if not clean:
        return None
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (clean,)).fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def get_user_by_account_code(account_code):
    if not account_code:
        return None
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE account_code = ?", (account_code,)).fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def save_user(email, password_hash, account_code, playlist_url):
    clean = normalize_email(email)
    acode = account_code or make_account_code(clean)
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO users (email, password_hash, account_code, playlist_url, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    account_code = excluded.account_code,
                    playlist_url = excluded.playlist_url
            """, (clean, password_hash, acode, playlist_url, int(time.time())))
        return True
    finally:
        conn.close()


def update_user_password(email, new_hash):
    clean = normalize_email(email)
    conn = get_connection()
    try:
        with conn:
            cur = conn.execute("UPDATE users SET password_hash = ? WHERE email = ?", (new_hash, clean))
            return cur.rowcount > 0
    finally:
        conn.close()


def update_user_playlist(email, playlist_url):
    clean = normalize_email(email)
    conn = get_connection()
    try:
        with conn:
            cur = conn.execute("UPDATE users SET playlist_url = ? WHERE email = ?", (playlist_url, clean))
            return cur.rowcount > 0
    finally:
        conn.close()


def delete_user(email):
    clean = normalize_email(email)
    conn = get_connection()
    try:
        with conn:
            user = conn.execute("SELECT account_code FROM users WHERE email = ?", (clean,)).fetchone()
            if not user:
                return False, "Usuário não encontrado."
            acode = user["account_code"]
            conn.execute("DELETE FROM users WHERE email = ?", (clean,))
            conn.execute("DELETE FROM profiles WHERE account_code = ?", (acode,))
            conn.execute("DELETE FROM watch_progress WHERE account_code = ?", (acode,))
        return True, "Usuário e dados excluídos com sucesso."
    finally:
        conn.close()


def get_all_users():
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT u.email, u.account_code, u.playlist_url, u.created_at,
                   COUNT(p.id) as profile_count
            FROM users u
            LEFT JOIN profiles p ON u.account_code = p.account_code
            GROUP BY u.email
            ORDER BY u.created_at ASC
        """).fetchall()
        users = []
        for r in rows:
            users.append({
                "email": r["email"],
                "accountCode": r["account_code"],
                "playlistUrl": r["playlist_url"],
                "fullPlaylistUrl": r["playlist_url"],
                "isMaster": False,
                "profileCount": r["profile_count"],
                "createdAt": r["created_at"],
                "createdFormatted": time.strftime("%d/%m/%Y %H:%M", time.localtime(r["created_at"])) if r["created_at"] else "-"
            })
        return users
    finally:
        conn.close()


def get_profiles_by_account(account_code):
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT id, name, avatar, is_kids, created_at 
            FROM profiles 
            WHERE account_code = ? 
            ORDER BY created_at ASC
        """, (account_code,)).fetchall()

        result = []
        for r in rows:
            result.append({
                "id": r["id"],
                "name": r["name"],
                "avatar": r["avatar"],
                "color": r["avatar"],
                "isKids": bool(r["is_kids"]),
                "createdAt": r["created_at"]
            })
        if not result:
            default_id = f"p_{account_code.lower()}_1" if account_code else "p1"
            result = [
                {"id": default_id, "name": "Principal", "avatar": "blue", "color": "blue", "isKids": False, "createdAt": int(time.time())}
            ]
        return result
    finally:
        conn.close()


def get_all_profiles():
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT p.id, p.account_code, p.name, p.avatar, p.is_kids, p.created_at, u.email
            FROM profiles p
            LEFT JOIN users u ON p.account_code = u.account_code
            ORDER BY p.created_at ASC
        """).fetchall()
        profs = []
        for r in rows:
            profs.append({
                "id": r["id"],
                "accountCode": r["account_code"],
                "email": r["email"] or "Desconhecido",
                "name": r["name"],
                "avatar": r["avatar"],
                "color": r["avatar"],
                "isKids": bool(r["is_kids"]),
                "createdAt": r["created_at"],
                "createdFormatted": time.strftime("%d/%m/%Y %H:%M", time.localtime(r["created_at"])) if r["created_at"] else "-"
            })
        return profs
    finally:
        conn.close()


def save_profile(account_code, profile_id, name, avatar, is_kids=False):
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO profiles (id, account_code, name, avatar, is_kids, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    account_code = excluded.account_code,
                    name = excluded.name,
                    avatar = excluded.avatar,
                    is_kids = excluded.is_kids
            """, (profile_id, account_code, name, avatar, 1 if is_kids else 0, int(time.time())))
        return True
    finally:
        conn.close()


def delete_profile(account_code, profile_id):
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM profiles WHERE account_code = ? AND id = ?", (account_code, profile_id))
            conn.execute("DELETE FROM watch_progress WHERE account_code = ? AND profile_id = ?", (account_code, profile_id))
        return True
    finally:
        conn.close()


def get_progress(account_code, profile_id):
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT data FROM watch_progress
            WHERE account_code = ? AND profile_id = ?
            ORDER BY updated_at DESC
        """, (account_code, profile_id)).fetchall()
        items = []
        for r in rows:
            try:
                parsed = json.loads(r["data"])
                if is_valid_progress_item(parsed):
                    items.append(parsed)
            except Exception:
                pass
        return items
    finally:
        conn.close()


def get_all_progress_count():
    conn = get_connection()
    try:
        row = conn.execute("SELECT COUNT(*) as cnt FROM watch_progress").fetchone()
        return row["cnt"] if row else 0
    finally:
        conn.close()


def save_progress_item(account_code, profile_id, item_data):
    if not is_valid_progress_item(item_data):
        return False
    cid = str(item_data.get("contentId") or item_data.get("id") or "")
    if not cid:
        return False
    uat = int(item_data.get("updatedAt", time.time()))
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO watch_progress (account_code, profile_id, content_id, data, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(account_code, profile_id, content_id) DO UPDATE SET
                    data = excluded.data,
                    updated_at = excluded.updated_at
            """, (account_code, profile_id, cid, json.dumps(item_data, ensure_ascii=False), uat))
        return True
    finally:
        conn.close()


def delete_progress_item(account_code, profile_id, content_id):
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                DELETE FROM watch_progress 
                WHERE account_code = ? AND profile_id = ? AND content_id = ?
            """, (account_code, profile_id, str(content_id)))
        return True
    finally:
        conn.close()


def get_db_stats():
    conn = get_connection()
    try:
        u_count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        p_count = conn.execute("SELECT COUNT(*) as c FROM profiles").fetchone()["c"]
        w_count = conn.execute("SELECT COUNT(*) as c FROM watch_progress").fetchone()["c"]
        db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
        return {
            "status": "healthy",
            "engine": "SQLite 3",
            "sqliteVersion": sqlite3.sqlite_version,
            "dbPath": str(DB_PATH),
            "dbSizeBytes": db_size,
            "dbSizeKb": round(db_size / 1024, 2),
            "totalUsers": u_count,
            "totalProfiles": p_count,
            "totalWatchProgress": w_count
        }
    finally:
        conn.close()


def export_backup_json():
    conn = get_connection()
    try:
        users = [dict(r) for r in conn.execute("SELECT * FROM users").fetchall()]
        profiles = [dict(r) for r in conn.execute("SELECT * FROM profiles").fetchall()]
        progress = [dict(r) for r in conn.execute("SELECT * FROM watch_progress").fetchall()]
        return {
            "version": "3.0",
            "exportedAt": int(time.time()),
            "stats": get_db_stats(),
            "users": users,
            "profiles": profiles,
            "watchProgress": progress
        }
    finally:
        conn.close()


def check_integrity():
    conn = get_connection()
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        journal_mode = conn.execute("PRAGMA journal_mode").fetchone()
        foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()
        return {
            "integrity": row[0] if row else "unknown",
            "journal_mode": journal_mode[0] if journal_mode else "unknown",
            "foreign_keys": bool(foreign_keys[0]) if foreign_keys else False,
            "timestamp": int(time.time())
        }
    finally:
        conn.close()


def get_recent_progress(limit=50):
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT account_code, profile_id, content_id, data, updated_at
            FROM watch_progress
            ORDER BY updated_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
        result = []
        for r in rows:
            item_data = {}
            try:
                item_data = json.loads(r["data"])
            except Exception:
                pass
            if not is_valid_progress_item(item_data):
                continue
            result.append({
                "accountCode": r["account_code"],
                "profileId": r["profile_id"],
                "contentId": r["content_id"],
                "updatedAt": r["updated_at"],
                "title": item_data.get("title") or item_data.get("name") or r["content_id"],
                "position": item_data.get("position", 0),
                "duration": item_data.get("duration", 0),
                "percentage": item_data.get("percentage", 0),
                "type": item_data.get("type", "movie")
            })
        return result
    finally:
        conn.close()


# Inicializa banco automaticamente ao importar
init_db()
