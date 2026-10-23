"""
StreamFlix Cinema - Guardião Anti-Sleep 24/7 (Keep-Alive)
Mantém o servidor do Render (https://streamflix-server.onrender.com) 100% acordado,
impedindo a hibernação gratuita de 15 minutos e garantindo carregamento instantâneo.
"""
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

TARGET_URL = "https://streamflix-server.onrender.com/health"
BACKUP_URL = "https://streamflix-server.onrender.com/api/version"
INTERVAL_SECONDS = 240  # 4 minutos (Render hiberna apenas após 15 min inativo)

def log(msg: str):
    timestamp = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
    line = f"{timestamp} {msg}"
    print(line, flush=True)
    try:
        with open("anti_sleep.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def ping(url: str) -> bool:
    start = time.time()
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "StreamFlix-AntiSleep-Watchdog/1.0",
                "Accept": "application/json"
            }
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            elapsed = time.time() - start
            if res.status == 200:
                log(f"[OK 200] StreamFlix Render acordado e ativo! ({elapsed:.2f}s) -> {url}")
                return True
            else:
                log(f"[AVISO {res.status}] Resposta de {url}")
                return False
    except urllib.error.HTTPError as e:
        log(f"[HTTP ERRO {e.code}] ao pingar {url}")
        return False
    except urllib.error.URLError as e:
        log(f"[CONEXAO ERRO] {e.reason} ao pingar {url}")
        return False
    except Exception as e:
        log(f"[ERRO] {e} ao pingar {url}")
        return False

def main():
    print("=" * 65)
    print("   STREAMFLIX CINEMA - SISTEMA GUARDIÃO ANTI-SLEEP 24/7 ATIVO   ")
    print("=" * 65)
    print(f"Alvo principal : {TARGET_URL}")
    print(f"Alvo backup    : {BACKUP_URL}")
    print(f"Frequência     : A cada {INTERVAL_SECONDS // 60} minutos")
    print("Pressione Ctrl+C para encerrar.")
    print("=" * 65)

    log("Iniciando primeira verificação Anti-Sleep...")
    if not ping(TARGET_URL):
        ping(BACKUP_URL)

    while True:
        try:
            time.sleep(INTERVAL_SECONDS)
            if not ping(TARGET_URL):
                log("Tentando URL backup...")
                ping(BACKUP_URL)
        except KeyboardInterrupt:
            log("Guardião Anti-Sleep encerrado.")
            break
        except Exception as e:
            log(f"Erro no ciclo: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
