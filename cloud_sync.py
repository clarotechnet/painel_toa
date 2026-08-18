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

    def __init__(self) -> None:
        self.url = os.environ.get("DOMINIUM_N8N_WEBHOOK_URL", "").strip()
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

