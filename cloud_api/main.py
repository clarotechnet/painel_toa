"""API online do DOMINIUM TOA: recebe retratos do n8n e consulta PostgreSQL."""
from __future__ import annotations

import hmac
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Variavel obrigatoria ausente: {name}")
    return value


def connect() -> psycopg.Connection[Any]:
    return psycopg.connect(
        host=required_env("DB_HOST"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=required_env("DB_NAME"),
        user=required_env("DB_USER"),
        password=required_env("DB_PASSWORD"),
        connect_timeout=10,
        row_factory=dict_row,
    )


def initialize_database() -> None:
    with connect() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS toa_snapshots (
                source_key TEXT PRIMARY KEY,
                schema_version TEXT NOT NULL,
                payload JSONB NOT NULL,
                collected_at TIMESTAMPTZ NOT NULL,
                received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_toa_snapshots_updated_at ON toa_snapshots(updated_at DESC)")


def parse_timestamp(value: Any) -> datetime:
    text = str(value or "").strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="publishedAt invalido") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def authorized(authorization: str) -> None:
    expected = required_env("DOMINIUM_INGEST_TOKEN")
    supplied = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Token de ingestao invalido")


def empty_feed() -> dict[str, Any]:
    return {
        "ok": True,
        "schema": "dominium.toa.monitor.v2",
        "source": "toa_cloud",
        "live": False,
        "liveAgeSeconds": None,
        "lastRunSource": "",
        "files": [],
        "orders": [],
        "timelineActivities": [],
        "errors": [],
        "loadedAt": None,
        "cloud": True,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="DOMINIUM TOA Cloud API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

allowed_origins = [
    item.strip().rstrip("/")
    for item in os.environ.get("CORS_ORIGINS", "").split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)


@app.get("/health")
@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT COUNT(*) AS snapshots, MAX(received_at) AS last_received_at FROM toa_snapshots").fetchone()
    return {
        "ok": True,
        "service": "dominium-toa-cloud-api",
        "database": {"ok": True, "snapshots": row["snapshots"]},
        "lastReceivedAt": row["last_received_at"],
        "serverTime": datetime.now(timezone.utc),
    }


@app.post("/internal/snapshots")
async def ingest_snapshot(
    request: Request,
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    authorized(authorization)
    raw = await request.body()
    if not raw or len(raw) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Retrato vazio ou acima de 24 MB")
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="JSON invalido") from exc
    if not isinstance(envelope, dict) or not isinstance(envelope.get("feed"), dict):
        raise HTTPException(status_code=400, detail="Envelope sem feed")
    feed = envelope["feed"]
    if feed.get("ok") is not True:
        raise HTTPException(status_code=400, detail="Feed nao confirmado")
    source_key = str(envelope.get("sourceKey") or "all").strip()[:80]
    if not source_key or not all(char.isalnum() or char in "-_" for char in source_key):
        raise HTTPException(status_code=400, detail="sourceKey invalido")
    collected_at = parse_timestamp(envelope.get("publishedAt"))
    schema_version = str(envelope.get("schema") or "dominium.toa.cloud-snapshot.v1")[:120]
    with connect() as db:
        row = db.execute("""
            INSERT INTO toa_snapshots(source_key, schema_version, payload, collected_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(source_key) DO UPDATE SET
                schema_version = EXCLUDED.schema_version,
                payload = EXCLUDED.payload,
                collected_at = EXCLUDED.collected_at,
                received_at = NOW(),
                updated_at = NOW()
            WHERE EXCLUDED.collected_at >= toa_snapshots.collected_at
            RETURNING source_key, received_at
        """, (source_key, schema_version, Jsonb(feed), collected_at)).fetchone()
    return {
        "ok": True,
        "stored": row is not None,
        "sourceKey": source_key,
        "receivedAt": row["received_at"] if row else None,
    }


def latest_feed(source_key: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute("""
            SELECT payload, collected_at, received_at
            FROM toa_snapshots WHERE source_key = %s
        """, (source_key,)).fetchone()
    if not row:
        return empty_feed()
    payload = dict(row["payload"])
    age = max(0, int((datetime.now(timezone.utc) - row["received_at"]).total_seconds()))
    payload.update({
        "ok": True,
        "source": "toa_cloud",
        "cloud": True,
        "cloudReceivedAt": row["received_at"],
        "liveAgeSeconds": age,
        "live": bool(payload.get("live")) and age <= 180,
    })
    return payload


@app.get("/api/toa-datalake/feed")
@app.get("/api/v1/monitor/feed")
@app.get("/api/v1/feed")
def feed(source_key: str = Query(default="all", pattern=r"^[A-Za-z0-9_-]{1,80}$")) -> dict[str, Any]:
    return latest_feed(source_key)

