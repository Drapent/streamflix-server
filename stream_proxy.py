"""
Stream Proxy Gateway
Bypasses CORS limitations, handles gzip decompression, resolves relative HLS paths,
supports Range requests for VOD scrubbing, and provides reliable chunk streaming.
"""

import urllib.request
import urllib.parse
import urllib.error
import ssl
import re
import gzip
import zlib

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

DEFAULT_HEADERS = {
    "User-Agent": "IPTVSmartersPro",
    "Accept": "*/*",
    "Connection": "keep-alive"
}

def decompress_body(raw_data: bytes) -> bytes:
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

def rewrite_m3u8(content: str, base_url: str, proxy_endpoint: str) -> str:
    lines = content.splitlines()
    rewritten_lines = []
    uri_param_pattern = re.compile(r'URI="([^"]+)"')

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("#"):
            def replace_uri_param(match):
                original_uri = match.group(1)
                full_uri = urllib.parse.urljoin(base_url, original_uri)
                proxied_uri = f"{proxy_endpoint}?url={urllib.parse.quote(full_uri, safe='')}"
                return f'URI="{proxied_uri}"'

            new_line = uri_param_pattern.sub(replace_uri_param, line)
            rewritten_lines.append(new_line)
        else:
            full_segment_url = urllib.parse.urljoin(base_url, stripped)
            proxied_segment_url = f"{proxy_endpoint}?url={urllib.parse.quote(full_segment_url, safe='')}"
            rewritten_lines.append(proxied_segment_url)

    return "\n".join(rewritten_lines)

def proxy_stream(handler, target_url: str):
    if not target_url:
        handler.send_error(400, "Missing url parameter")
        return

    try:
        parsed_target = urllib.parse.urlparse(target_url)
        if not parsed_target.scheme.startswith("http"):
            handler.send_error(400, "Invalid URL scheme")
            return

        req = urllib.request.Request(target_url, headers=DEFAULT_HEADERS)
        range_header = handler.headers.get("Range")
        if range_header:
            req.add_header("Range", range_header)

        with urllib.request.urlopen(req, timeout=25, context=SSL_CONTEXT) as response:
            content_type = response.headers.get("Content-Type", "")
            status_code = response.status

            is_m3u8 = (
                "mpegurl" in content_type.lower() or 
                target_url.split("?")[0].lower().endswith(".m3u8")
            )

            if is_m3u8:
                raw_content = response.read()
                raw_content = decompress_body(raw_content)

                try:
                    text_content = raw_content.decode("utf-8")
                except UnicodeDecodeError:
                    text_content = raw_content.decode("latin-1", errors="ignore")

                rewritten = rewrite_m3u8(text_content, target_url, "/proxy")
                body = rewritten.encode("utf-8")

                handler.send_response(200)
                handler.send_header("Content-Type", "application/vnd.apple.mpegurl")
                handler.send_header("Content-Length", str(len(body)))
                handler.send_header("Access-Control-Allow-Origin", "*")
                handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                handler.send_header("Access-Control-Allow-Headers", "*")
                handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                handler.end_headers()
                handler.wfile.write(body)
                try:
                    handler.wfile.flush()
                except Exception:
                    pass
            else:
                handler._is_media_stream = True
                handler.close_connection = True
                handler.send_response(status_code)
                target_is_ts = target_url.endswith(".ts") or "output=ts" in target_url or "/live/" in target_url
                default_ct = "video/mp2t" if target_is_ts else "video/mp4"
                handler.send_header("Content-Type", content_type if content_type else default_ct)
                handler.send_header("Access-Control-Allow-Origin", "*")
                handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                handler.send_header("Access-Control-Allow-Headers", "*")
                handler.send_header("Accept-Ranges", "bytes")
                handler.send_header("Connection", "close")
                handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                handler.send_header("Pragma", "no-cache")
                handler.send_header("Expires", "0")
                handler.send_header("X-Accel-Buffering", "no")

                content_length = response.headers.get("Content-Length")
                if content_length:
                    handler.send_header("Content-Length", content_length)

                content_range = response.headers.get("Content-Range")
                if content_range:
                    handler.send_header("Content-Range", content_range)

                handler.end_headers()

                # Stream steady 128KB chunks for live TS stability and zero jitter
                while True:
                    chunk = response.read(128 * 1024)
                    if not chunk:
                        break
                    try:
                        handler.wfile.write(chunk)
                        handler.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, Exception):
                        break

    except urllib.error.HTTPError as e:
        try:
            handler.send_response(e.code)
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.end_headers()
            handler.wfile.write(f"Proxy HTTP Error: {e.code}".encode("utf-8"))
        except Exception:
            pass
    except Exception as e:
        try:
            handler.send_response(502)
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.end_headers()
            handler.wfile.write(f"Proxy Connection Failed: {e}".encode("utf-8"))
        except Exception:
            pass
