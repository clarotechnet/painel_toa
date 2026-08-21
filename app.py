"""Servidor local do DOMINIUM TOA com cache SQLite para a TV."""
from __future__ import annotations


import argparse
import hmac
import json
import mimetypes
import os
import re
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from cloud_sync import CloudPublisher
from toa_datalake_store import TOADatalakeStore

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


def load_local_environment(path: Path) -> None:
    """Carrega apenas chaves ausentes; variaveis do sistema sempre prevalecem."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            os.environ.setdefault(key, value)


load_local_environment(ROOT / ".env.local")
STORE = TOADatalakeStore(ROOT / "data" / "toa_datalake.sqlite3")
PUBLISHER = CloudPublisher()
LOCATION_PUBLISHER = CloudPublisher(
    url_env="DOMINIUM_N8N_LOCATION_WEBHOOK_URL",
    channel="technician-locations",
)


class Handler(BaseHTTPRequestHandler):
    server_version = "DominiumTOA/3.0"

    def _json(self, status: int, payload: dict) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def _body(self, limit: int = 24 * 1024 * 1024) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length invalido") from exc
        if length <= 0 or length > limit:
            raise ValueError("Corpo vazio ou acima do limite")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("JSON invalido") from exc
        if not isinstance(value, dict):
            raise ValueError("O corpo precisa ser um objeto JSON")
        return value

    def _ingest_authorized(self) -> bool:
        expected = os.environ.get("DOMINIUM_INGEST_TOKEN", "").strip()
        remote = self.client_address[0]
        local = remote in {"127.0.0.1", "::1"}
        # Os coletores oficiais deste projeto conversam apenas com a API local
        # e nunca precisam conhecer o segredo usado para publicar no n8n.
        if local:
            return True
        if not expected:
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Defina DOMINIUM_INGEST_TOKEN para ingestao pela rede"})
            return False
        supplied = self.headers.get("Authorization", "")
        token = supplied[7:].strip() if supplied.lower().startswith("bearer ") else ""
        if not hmac.compare_digest(token, expected):
            self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Token de ingestao invalido"})
            return False
        return True

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and self.client_address[0] not in {"127.0.0.1", "::1"}:
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Leitura da API disponivel apenas neste computador"})
            return
        if parsed.path == "/api/toa-datalake/status":
            payload = STORE.status()
            payload["cloud_sync"] = PUBLISHER.status()
            payload["location_cloud_sync"] = LOCATION_PUBLISHER.status()
            self._json(HTTPStatus.OK, payload)
            return
        query = parse_qs(parsed.query)
        profile = str(query.get("profile", [""])[0])
        date = str(query.get("date", [""])[0])
        if parsed.path == "/api/v1/health":
            payload = STORE.health()
            payload["cloud_sync"] = PUBLISHER.status()
            payload["location_cloud_sync"] = LOCATION_PUBLISHER.status()
            self._json(HTTPStatus.OK, payload)
            return
        if parsed.path == "/api/v1/monitor/summary":
            self._json(HTTPStatus.OK, STORE.monitor_summary(profile=profile, date=date))
            return
        if parsed.path in {"/api/v1/monitor/feed", "/api/v1/feed"}:
            self._json(HTTPStatus.OK, STORE.feed(profile=profile, date=date))
            return
        if parsed.path == "/api/v1/activities":
            try:
                limit = int(str(query.get("limit", ["500"])[0]))
                offset = int(str(query.get("offset", ["0"])[0]))
            except ValueError:
                self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "limit ou offset invalido"})
                return
            self._json(HTTPStatus.OK, STORE.activities_api(
                profile=profile, date=date, status=str(query.get("status", [""])[0]),
                bucket=str(query.get("bucket", [""])[0]), limit=limit, offset=offset,
            ))
            return
        if parsed.path == "/api/v1/buckets":
            self._json(HTTPStatus.OK, STORE.buckets(profile=profile, date=date))
            return
        if parsed.path == "/api/v1/technicians":
            self._json(HTTPStatus.OK, STORE.technicians(profile=profile, date=date))
            return
        if parsed.path == "/api/v1/technician-monitor/summary":
            self._json(HTTPStatus.OK, STORE.technician_location_summary(
                profile=profile, date=date,
            ))
            return
        location_track = re.fullmatch(r"/api/v1/technician-monitor/track/([^/]+)", parsed.path)
        if location_track:
            self._json(HTTPStatus.OK, STORE.technician_location_track(
                location_track.group(1), date=date,
            ))
            return
        if parsed.path == "/api/v1/tec1/alerts":
            try:
                horizon = int(str(query.get("minutes", ["30"])[0]))
            except ValueError:
                horizon = 30
            include_late = str(query.get("include_late", ["1"])[0]).casefold() not in {"0", "false", "no"}
            self._json(HTTPStatus.OK, STORE.tec1_alerts(
                profile=profile, date=date, horizon_minutes=min(1440, max(1, horizon)),
                include_late=include_late,
            ))
            return
        v1_record = re.fullmatch(r"/api/v1/(?:contracts|activities)/(\d{5,18})", parsed.path)
        if v1_record:
            self._json(HTTPStatus.OK, STORE.record(v1_record.group(1)))
            return
        if parsed.path == "/api/toa-datalake/feed":
            query = parse_qs(parsed.query)
            self._json(HTTPStatus.OK, STORE.feed(
                profile=str(query.get("profile", [""])[0]),
                date=str(query.get("date", [""])[0]),
            ))
            return
        if parsed.path == "/api/toa-datalake/detail-queue":
            query = parse_qs(parsed.query)
            try:
                limit = int(str(query.get("limit", ["100"])[0]))
            except ValueError:
                limit = 100
            self._json(HTTPStatus.OK, STORE.detail_queue(limit))
            return
        record_match = re.fullmatch(r"/api/toa-datalake/records/(\d{5,18})", parsed.path)
        if record_match:
            self._json(HTTPStatus.OK, STORE.record(record_match.group(1)))
            return

        relative = "index.html" if parsed.path == "/" else parsed.path.lstrip("/")
        target = (DIST / relative).resolve()
        if DIST.resolve() not in target.parents and target != DIST.resolve():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            target = DIST / "index.html"
        content = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"} else ""))
        self.send_header("Content-Length", str(len(content)))
        # O painel e atualizado localmente enquanto permanece aberto na TV.
        # JS/CSS nao podem ficar presos no cache apos um build corretivo.
        self.send_header("Cache-Control", "no-store" if target.suffix.lower() in {".html", ".js", ".css"} else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        aliases = {
            "/api/v1/ingest/snapshot": "/api/toa-datalake/ingest",
            "/api/v1/ingest/history": "/api/toa-datalake/ingest-history",
            "/api/v1/collector/heartbeat": "/api/v1/collector/heartbeat",
            "/api/v1/ingest/technician-locations": "/api/v1/ingest/technician-locations",
            "/api/v1/technician-monitor/close-day": "/api/v1/technician-monitor/close-day",
        }
        path = aliases.get(path, path)
        if path not in {"/api/toa-datalake/ingest", "/api/toa-datalake/ingest-history", "/api/toa-datalake/detail-queue", "/api/v1/collector/heartbeat", "/api/v1/ingest/technician-locations", "/api/v1/technician-monitor/close-day"}:
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Endpoint inexistente"})
            return
        if not self._ingest_authorized():
            return
        try:
            body = self._body()
            if path == "/api/toa-datalake/detail-queue":
                self._json(HTTPStatus.OK, STORE.detail_queue(int(body.get("limit") or 100)))
            elif path == "/api/toa-datalake/ingest-history":
                result = STORE.ingest_history(body)
                PUBLISHER.publish(STORE.feed(), trigger=path)
                self._json(HTTPStatus.OK, result)
            elif path == "/api/v1/collector/heartbeat":
                self._json(HTTPStatus.OK, STORE.collector_heartbeat(body))
            elif path == "/api/v1/ingest/technician-locations":
                result = STORE.ingest_locations(body)
                result["cloud_queued"] = LOCATION_PUBLISHER.publish_locations(body, trigger=path)
                self._json(HTTPStatus.OK, result)
            elif path == "/api/v1/technician-monitor/close-day":
                self._json(HTTPStatus.OK, STORE.close_technician_location_day(
                    date=str(body.get("date") or ""), source=str(body.get("source") or ""),
                ))
            else:
                result = STORE.ingest(body)
                PUBLISHER.publish(STORE.feed(), trigger=path)
                self._json(HTTPStatus.OK, result)
        except ValueError as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Erro interno: {exc}"})

    def log_message(self, format: str, *args) -> None:
        print("[TOA]", format % args)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not (DIST / "index.html").is_file():
        raise SystemExit("Pasta dist não encontrada. Execute: npm run build")
    if args.host not in {"127.0.0.1", "localhost", "::1"} and not os.environ.get("DOMINIUM_INGEST_TOKEN", "").strip():
        raise SystemExit("Para expor na rede, defina DOMINIUM_INGEST_TOKEN antes de iniciar.")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"DOMINIUM TOA disponível em {url}")
    cloud_status = PUBLISHER.status()
    if cloud_status["enabled"]:
        print(f"Sincronizacao online habilitada via {cloud_status['target']}")
        PUBLISHER.publish(STORE.feed(), trigger="startup")
    elif cloud_status["state"] == "configuration_error":
        print(f"Sincronizacao online desabilitada: {cloud_status['lastError']}")
    if not args.no_browser and args.host in {"127.0.0.1", "localhost"}:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
