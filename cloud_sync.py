"""Publicacao assincrona e tolerante a falhas do retrato local para o n8n."""
from __future__ import annotations

import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any
from urllib.parse import urlparse


def _positive_number(name: str, default: float, minimum: float) -> float:
    try:
        return max(minimum, float(os.environ.get(name, str(default))))
    except ValueError:
        return default


class CloudPublisher:
    """Fila latest-wins: nunca bloqueia a API local nem acumula retratos antigos."""

    def __init__(self, *, url_env: str = "DOMINIUM_N8N_WEBHOOK_URL", channel: str = "snapshot") -> None:
        self.url = os.environ.get(url_env, "").strip()
        self.channel = channel
        self.token = os.environ.get("DOMINIUM_INGEST_TOKEN", "").strip()
        self.min_interval = _positive_number("DOMINIUM_CLOUD_SYNC_MIN_INTERVAL_SECONDS", 10, 2)
        self.retry_seconds = _positive_number("DOMINIUM_CLOUD_SYNC_RETRY_SECONDS", 15, 5)
        self._condition = threading.Condition()
        self._pending: bytes | None = None
        self._last_sent_monotonic = 0.0
        self._status: dict[str, Any] = {
            "enabled": False,
            "state": "disabled",
            "target": "",
            "lastSuccessAt": "",
            "lastAttemptAt": "",
            "lastError": "",
            "pending": False,
        }
        self._validate_configuration()
        if self._status["enabled"]:
            threading.Thread(target=self._worker, name="dominium-cloud-publisher", daemon=True).start()

    def _validate_configuration(self) -> None:
        if not self.url:
            return
        parsed = urlparse(self.url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not local_http:
            self._status.update(state="configuration_error", lastError="Webhook remoto precisa usar HTTPS")
            return
        if not parsed.netloc or not self.token:
            self._status.update(state="configuration_error", lastError="URL ou token de ingestao ausente")
            return
        self._status.update(enabled=True, state="waiting", target=parsed.netloc)

    def publish(self, feed: dict[str, Any], *, trigger: str) -> bool:
        if not self._status["enabled"]:
            return False
        envelope = {
            "schema": "dominium.toa.cloud-snapshot.v1",
            "sourceKey": "all",
            "publishedAt": datetime.now().astimezone().isoformat(),
            "trigger": str(trigger)[:120],
            "feed": feed,
        }
        encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with self._condition:
            self._pending = encoded
            self._status.update(state="queued", pending=True)
            self._condition.notify()
        return True

    def publish_locations(self, payload: dict[str, Any], *, trigger: str) -> bool:
        """Fila incremental de GPS; lotes pendentes sao mesclados para nao perder pontos."""
        if not self._status["enabled"]:
            return False
        resources = payload.get("resources") if isinstance(payload.get("resources"), list) else []
        if not resources:
            resources = [{
                "technician": payload.get("technician") or {},
                "bucket": payload.get("bucket") or "",
                "profile": payload.get("profile") or "",
                "points": payload.get("points") or [],
                "visits": payload.get("visits") or [],
                "replace_visits": payload.get("replace_visits"),
                "visit_snapshot_date": payload.get("visit_snapshot_date") or "",
            }]
        envelope = {
            "schema": "dominium.toa.technician-locations.v1",
            "publishedAt": datetime.now().astimezone().isoformat(),
            "trigger": str(trigger)[:120],
            "source": str(payload.get("source") or "toa-location-bridge")[:120],
            "resources": resources,
        }
        with self._condition:
            if self._pending:
                try:
                    previous = json.loads(self._pending.decode("utf-8"))
                    if previous.get("schema") == envelope["schema"]:
                        envelope["resources"] = self._merge_location_resources(
                            previous.get("resources") or [], resources,
                        )
                except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                    pass
            self._pending = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self._status.update(state="queued", pending=True)
            self._condition.notify()
        return True

    @staticmethod
    def _merge_location_resources(previous: list[Any], current: list[Any]) -> list[dict[str, Any]]:
        grouped: dict[str, dict[str, Any]] = {}
        for raw in [*previous, *current]:
            if not isinstance(raw, dict):
                continue
            technician = raw.get("technician") if isinstance(raw.get("technician"), dict) else {}
            key = str(technician.get("login") or technician.get("id") or "").strip()
            if not key:
                continue
            batch = grouped.setdefault(key, {
                "technician": dict(technician),
                "bucket": raw.get("bucket") or "",
                "profile": raw.get("profile") or "",
                "points": [],
                "visits": [],
                "replace_visits": False,
                "visit_snapshot_date": "",
            })
            batch["technician"].update({name: value for name, value in technician.items() if value})
            batch["bucket"] = raw.get("bucket") or batch["bucket"]
            batch["profile"] = raw.get("profile") or batch["profile"]
            if raw.get("replace_visits"):
                batch["replace_visits"] = True
                batch["visit_snapshot_date"] = str(raw.get("visit_snapshot_date") or "")[:10]
                batch["visits"] = []
            known = {
                f"{point.get('observed_at')}|{point.get('latitude')}|{point.get('longitude')}"
                for point in batch["points"] if isinstance(point, dict)
            }
            for point in raw.get("points") or []:
                if not isinstance(point, dict):
                    continue
                fingerprint = f"{point.get('observed_at')}|{point.get('latitude')}|{point.get('longitude')}"
                if fingerprint in known:
                    continue
                known.add(fingerprint)
                batch["points"].append(point)
            # O SQLite local conserva tudo. O limite evita consumir RAM sem fim se o n8n ficar offline.
            batch["points"] = batch["points"][-5000:]
            known_visits = {
                f"{visit.get('activity_id')}|{visit.get('latitude')}|{visit.get('longitude')}"
                for visit in batch["visits"] if isinstance(visit, dict)
            }
            for visit in raw.get("visits") or []:
                if not isinstance(visit, dict):
                    continue
                fingerprint = f"{visit.get('activity_id')}|{visit.get('latitude')}|{visit.get('longitude')}"
                if fingerprint in known_visits:
                    continue
                known_visits.add(fingerprint)
                batch["visits"].append(visit)
            batch["visits"] = batch["visits"][-1000:]
        return list(grouped.values())

    def status(self) -> dict[str, Any]:
        with self._condition:
            return dict(self._status)

    def _worker(self) -> None:
        while True:
            with self._condition:
                while self._pending is None:
                    self._condition.wait()
                wait_for = self.min_interval - (time.monotonic() - self._last_sent_monotonic)
                if wait_for > 0:
                    self._condition.wait(timeout=wait_for)
                    continue
                payload = self._pending
                self._pending = None
                self._status.update(state="sending", pending=False, lastAttemptAt=datetime.now().astimezone().isoformat())
            try:
                request = urllib.request.Request(
                    self.url,
                    data=payload,
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {self.token}",
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "User-Agent": "DOMINIUM-TOA-Collector/1.0",
                    },
                )
                with urllib.request.urlopen(request, timeout=30, context=ssl.create_default_context()) as response:
                    response_payload = json.loads(response.read().decode("utf-8"))
                    if response.status >= 300 or response_payload.get("ok") is not True:
                        raise RuntimeError(f"Webhook respondeu {response.status} sem confirmacao")
                with self._condition:
                    self._last_sent_monotonic = time.monotonic()
                    self._status.update(
                        state="online", lastSuccessAt=datetime.now().astimezone().isoformat(),
                        lastError="", pending=self._pending is not None,
                    )
            except (OSError, ValueError, RuntimeError, urllib.error.HTTPError) as exc:
                with self._condition:
                    if self._pending is None:
                        self._pending = payload
                    self._status.update(
                        state="retrying", lastError=str(exc)[:500], pending=True,
                    )
                    self._condition.wait(timeout=self.retry_seconds)
