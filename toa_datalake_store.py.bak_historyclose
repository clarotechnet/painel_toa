from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
import sqlite3
import threading
import unicodedata
from pathlib import Path
from typing import Any


def _now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def _text(value: Any, limit: int = 4000) -> str:
    return str(value if value is not None else "").strip()[:limit]


def _digits(value: Any) -> str:
    return "".join(re.findall(r"\d", _text(value)))


def _first(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if row.get(name) not in (None, ""):
            return row[name]
    return ""


def _items(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _ascii(value: Any) -> str:
    return "".join(char for char in unicodedata.normalize("NFKD", _text(value))
                   if not unicodedata.combining(char)).casefold()


def _profile(bucket: str, explicit: str = "") -> str:
    if explicit:
        return explicit.casefold()
    return {"NTL": "natal", "PWM": "natal", "FTZ": "fortaleza", "MRO": "mossoro",
            "JCR": "recife", "REC": "recife"}.get(bucket.upper().split("-", 1)[0], "other")


def _clock_from_minutes(value: Any) -> str:
    try:
        minutes = int(float(str(value)))
    except (TypeError, ValueError):
        return ""
    if minutes < 0:
        return ""
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def _clock_after_minutes(start: Any, duration: Any) -> str:
    try:
        return _clock_from_minutes(float(str(start)) + float(str(duration or 0)))
    except (TypeError, ValueError):
        return ""


def _status_group(value: Any) -> str:
    status = _ascii(value).replace("_", " ")
    if any(term in status for term in ("complete", "concluid", "cancel", "suspend", "nao conclu")):
        return "completed"
    if any(term in status for term in ("started", "iniciad", "enroute", "em rota", "em campo")):
        return "field"
    return "pending"


def _terminal_status(value: Any) -> bool:
    """Estados finais confirmados pelo detalhe oficial da atividade."""
    status = _ascii(value).replace("_", " ")
    return any(term in status for term in (
        "complete", "concluid", "finaliz", "encerrad", "notdone",
        "nao conclu", "cancel", "suspend", "nao agendad", "unscheduled", "non-scheduled",
    ))


def _suspended_status(value: Any) -> bool:
    return "suspend" in _ascii(value)


def _oracle_unscheduled(*values: Any) -> bool:
    """O OFS representa atividade nao agendada com timestamps no ano 3000 ou textos 'nao agendado'."""
    for value in values:
        t = _text(value, 120).lower()
        if re.match(r"^3000-01-01(?:[T\s]|$)", t):
            return True
        if any(term in _ascii(t) for term in ("nao agendad", "unscheduled", "non-scheduled", "sem agenda")):
            return True
    return False


def _window_end(scheduled_date: Any, service_window: Any) -> dt.datetime | None:
    date_value = _text(scheduled_date, 10)
    window = _text(service_window, 120)
    times = re.findall(r"(?<!\d)(\d{1,2})(?::(\d{2}))?(?!\d)", window)
    if not date_value or len(times) < 2:
        return None
    try:
        hour, minute = int(times[-1][0]), int(times[-1][1] or 0)
        return dt.datetime.combine(
            dt.date.fromisoformat(date_value), dt.time(hour=hour, minute=minute),
            tzinfo=dt.datetime.now().astimezone().tzinfo,
        )
    except (TypeError, ValueError):
        return None


class TOADatalakeStore:
    SCHEMA = "dominium.toa.monitor.v2"

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS activities(
              activity_id TEXT PRIMARY KEY, profile TEXT, contract TEXT, description TEXT,
              activity_type TEXT, bucket TEXT, technician_id TEXT, technician_login TEXT,
              technician_name TEXT, status TEXT, scheduled_date TEXT, start_min TEXT,
              duration_min TEXT, travel_min TEXT, route_position TEXT,
              service_window TEXT, start_time TEXT, end_time TEXT, city TEXT, observation TEXT,
              detail_state TEXT, detail_checked_at TEXT DEFAULT '', updated_at TEXT);
            CREATE TABLE IF NOT EXISTS orders(
              os_number TEXT PRIMARY KEY, activity_id TEXT, contract TEXT, task_index TEXT,
              service TEXT, status TEXT, close_code TEXT, updated_at TEXT);
            CREATE TABLE IF NOT EXISTS inventory(
              activity_id TEXT, category TEXT, item_key TEXT, contract TEXT, inventory_id TEXT,
              code TEXT, description TEXT, serial TEXT, quantity REAL, unit TEXT, pool TEXT,
              updated_at TEXT, PRIMARY KEY(activity_id,category,item_key));
            CREATE TABLE IF NOT EXISTS runs(
              id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, observed_at TEXT,
              received_at TEXT, activities INTEGER, orders INTEGER, details INTEGER);
            CREATE TABLE IF NOT EXISTS live_visible(
              activity_id TEXT PRIMARY KEY, observed_at TEXT);
            CREATE TABLE IF NOT EXISTS activity_history(
              activity_id TEXT, event_key TEXT, contract TEXT, action_time TEXT,
              action_timestamp TEXT, user_name TEXT, action TEXT, changes_json TEXT,
              updated_at TEXT, PRIMARY KEY(activity_id,event_key));
            CREATE TABLE IF NOT EXISTS activity_events(
              id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT, contract TEXT,
              event_type TEXT, previous_value TEXT, current_value TEXT,
              observed_at TEXT, source TEXT);
            CREATE INDEX IF NOT EXISTS idx_activity_events_activity
              ON activity_events(activity_id, observed_at);
            CREATE TABLE IF NOT EXISTS collector_state(
              collector TEXT PRIMARY KEY, state TEXT, source TEXT, bucket TEXT,
              last_success_at TEXT, last_attempt_at TEXT, last_error TEXT,
              records INTEGER DEFAULT 0, details_json TEXT DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS technician_location_points(
              point_key TEXT PRIMARY KEY, technician_id TEXT, technician_login TEXT,
              technician_name TEXT, bucket TEXT, profile TEXT, observed_date TEXT,
              observed_at TEXT, latitude REAL, longitude REAL, accuracy_m REAL,
              speed_kmh REAL, heading REAL, altitude_m REAL, source TEXT,
              received_at TEXT, activity_id TEXT DEFAULT '');
            CREATE INDEX IF NOT EXISTS idx_location_points_date_technician
              ON technician_location_points(observed_date, technician_login, technician_id, observed_at);
            CREATE INDEX IF NOT EXISTS idx_location_points_profile_date
              ON technician_location_points(profile, observed_date, observed_at);
            CREATE TABLE IF NOT EXISTS technician_location_visits(
              visit_key TEXT PRIMARY KEY, technician_id TEXT, technician_login TEXT,
              technician_name TEXT, bucket TEXT, profile TEXT, observed_date TEXT,
              scheduled_at TEXT, latitude REAL, longitude REAL, marker_label TEXT,
              activity_id TEXT, os_number TEXT, contract TEXT, service TEXT,
              status TEXT, source TEXT, received_at TEXT);
            CREATE INDEX IF NOT EXISTS idx_location_visits_date_technician
              ON technician_location_visits(observed_date, technician_login, technician_id, scheduled_at);
            CREATE TABLE IF NOT EXISTS technician_daily_closures(
              closure_date TEXT PRIMARY KEY, closed_at TEXT, source TEXT,
              technician_count INTEGER DEFAULT 0, point_count INTEGER DEFAULT 0,
              details_json TEXT DEFAULT '{}');
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(activities)")}
            for name in ("duration_min", "travel_min", "route_position", "detail_checked_at"):
                if name not in columns:
                    db.execute(f"ALTER TABLE activities ADD COLUMN {name} TEXT DEFAULT ''")
            point_columns = {row[1] for row in db.execute("PRAGMA table_info(technician_location_points)")}
            if "activity_id" not in point_columns:
                db.execute("ALTER TABLE technician_location_points ADD COLUMN activity_id TEXT DEFAULT ''")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=20000")
        return db

    @staticmethod
    def _finite_number(value: Any) -> float | None:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if math.isfinite(parsed) else None

    @staticmethod
    def _location_timestamp(value: Any, fallback_date: str = "") -> dt.datetime | None:
        text = _text(value, 80)
        if not text:
            return None
        if re.fullmatch(r"\d{10,13}", text):
            raw = int(text)
            if len(text) == 13:
                raw /= 1000
            try:
                return dt.datetime.fromtimestamp(raw, tz=dt.timezone.utc).astimezone()
            except (OverflowError, OSError, ValueError):
                return None
        normalized = text.replace("Z", "+00:00")
        try:
            parsed = dt.datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
            return parsed.astimezone()
        except ValueError:
            pass
        for pattern in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%H:%M:%S", "%H:%M"):
            try:
                parsed = dt.datetime.strptime(text, pattern)
                if pattern.startswith("%H"):
                    date_value = dt.date.fromisoformat(fallback_date) if fallback_date else dt.date.today()
                    parsed = dt.datetime.combine(date_value, parsed.time())
                return parsed.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
            except ValueError:
                continue
        return None

    @staticmethod
    def _distance_meters(left: sqlite3.Row | dict[str, Any], right: sqlite3.Row | dict[str, Any]) -> float:
        lat1, lon1 = math.radians(float(left["latitude"])), math.radians(float(left["longitude"]))
        lat2, lon2 = math.radians(float(right["latitude"])), math.radians(float(right["longitude"]))
        delta_lat = lat2 - lat1
        delta_lon = lon2 - lon1
        value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
        return 6371008.8 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))

    @staticmethod
    def _location_identity_maps(db: sqlite3.Connection) -> tuple[dict[str, dict[str, str]], dict[str, sqlite3.Row]]:
        """Relaciona PID numerico, login externo e atividade ao mesmo tecnico real."""
        aliases: dict[str, dict[str, str]] = {}
        activities: dict[str, sqlite3.Row] = {}
        rows = db.execute("""
          SELECT activity_id,technician_id,technician_login,technician_name,bucket,
                 scheduled_date,route_position,start_min,contract,description,status,updated_at
          FROM activities
          ORDER BY updated_at
        """).fetchall()
        for row in rows:
            technician_id = _text(row["technician_id"], 160)
            technician_login = _text(row["technician_login"], 160).upper()
            technician_name = _text(row["technician_name"], 240)
            bucket = _text(row["bucket"], 120).upper()
            if not technician_id and not technician_login:
                continue
            # Nos de rota aparecem no payload Provider, mas nao sao pessoas.
            if technician_name and bucket and technician_name.upper() == bucket:
                continue
            identity = {
                "id": technician_id,
                "login": technician_login,
                "name": technician_name,
                "bucket": bucket,
            }
            for alias in (technician_id, technician_login):
                if alias:
                    aliases[alias.casefold()] = identity
            activity_id = _text(row["activity_id"], 160)
            if activity_id:
                activities[activity_id] = row
        return aliases, activities

    @staticmethod
    def _canonical_location_identity(
        row: sqlite3.Row | dict[str, Any], aliases: dict[str, dict[str, str]],
    ) -> dict[str, str]:
        technician_id = _text(row["technician_id"], 160)
        technician_login = _text(row["technician_login"], 160).upper()
        mapped = aliases.get(technician_login.casefold()) or aliases.get(technician_id.casefold())
        if mapped:
            return mapped
        return {
            "id": technician_id,
            "login": technician_login,
            "name": _text(row["technician_name"], 240),
            "bucket": _text(row["bucket"], 120).upper(),
        }

    @staticmethod
    def _location_identity_key(identity: dict[str, str]) -> str:
        return (identity.get("login") or identity.get("id") or "").casefold()

    @classmethod
    def _canonical_location_points(cls, rows: list[sqlite3.Row]) -> list[sqlite3.Row]:
        """Ordena e deduplica amostras reais depois da união PID/login."""
        ordered = sorted(rows, key=lambda row: (
            cls._location_timestamp(row["observed_at"]) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),
            _text(row["point_key"], 80),
        ))
        unique: dict[str, sqlite3.Row] = {}
        for row in ordered:
            fingerprint = "|".join((
                _text(row["observed_at"], 80),
                f"{float(row['latitude']):.7f}",
                f"{float(row['longitude']):.7f}",
            ))
            previous = unique.get(fingerprint)
            if previous is None or (not _text(previous["activity_id"], 160) and _text(row["activity_id"], 160)):
                unique[fingerprint] = row
        return list(unique.values())

    @classmethod
    def _valid_location_visits(
        cls, rows: list[sqlite3.Row], aliases: dict[str, dict[str, str]],
        activities: dict[str, sqlite3.Row], selected_date: str,
    ) -> list[tuple[sqlite3.Row, sqlite3.Row | None]]:
        """Aceita somente marcadores cuja atividade pertence ao mesmo tecnico e dia."""
        valid: dict[str, tuple[sqlite3.Row, sqlite3.Row | None]] = {}
        for row in rows:
            activity = activities.get(_text(row["activity_id"], 160))
            visit_identity = cls._canonical_location_identity(row, aliases)
            if not cls._location_identity_key(visit_identity):
                continue
            # Quando o datalake já possui o retrato de atividades, uma parada só
            # pode aparecer no mapa se o AID comprovar o mesmo PID/login e dia.
            # Isso impede que respostas atrasadas do Map.get contaminem outro
            # recurso. Em uma instalação vazia, o lote independente ainda pode
            # ser consultado até o primeiro retrato operacional chegar.
            special_map_marker = _text(row["activity_id"], 160).startswith("map-special:")
            if activities and not activity and not special_map_marker:
                continue
            if activity:
                if _text(activity["scheduled_date"], 10) != selected_date:
                    continue
                activity_identity = cls._canonical_location_identity(activity, aliases)
                if cls._location_identity_key(visit_identity) != cls._location_identity_key(activity_identity):
                    continue
            fingerprint = "|".join((
                cls._location_identity_key(visit_identity), _text(row["activity_id"], 160),
                f"{float(row['latitude']):.7f}", f"{float(row['longitude']):.7f}",
            ))
            previous = valid.get(fingerprint)
            current_score = sum(bool(_text(row[name])) for name in (
                "scheduled_at", "marker_label", "os_number", "contract", "service", "status",
            ))
            previous_score = sum(bool(_text(previous[0][name])) for name in (
                "scheduled_at", "marker_label", "os_number", "contract", "service", "status",
            )) if previous else -1
            if current_score > previous_score:
                valid[fingerprint] = (row, activity)
        return list(valid.values())

    def ingest_locations(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Grava somente telemetria operacional do recurso; nunca dados do cliente."""
        source = _text(payload.get("source") or "toa-location-bridge", 120)
        fallback_date = _text(payload.get("date"), 10)
        batches = _items(payload.get("resources"))
        if not batches:
            batches = [{
                "technician": payload.get("technician") or {},
                "bucket": payload.get("bucket"), "profile": payload.get("profile"),
                "gps_real": payload.get("gps_real") or payload.get("points") or [],
                "planned_route": payload.get("planned_route") or [],
                "service_stops": payload.get("service_stops") or payload.get("visits") or [],
                "replace_planned_route": payload.get("replace_planned_route"),
                "replace_service_stops": payload.get("replace_service_stops") or payload.get("replace_visits"),
                "visit_snapshot_date": payload.get("visit_snapshot_date"),
            }]
        received_at = _now()
        inserted = 0
        visits_inserted = 0
        visits_deleted = 0
        ignored = 0
        technicians: set[str] = set()
        with self.lock, self._connect() as db:
            aliases, _ = self._location_identity_maps(db)
            for batch in batches:
                gps_real = _items(batch.get("gps_real") if isinstance(batch.get("gps_real"), list) else batch.get("points"))
                service_stops = _items(
                    batch.get("service_stops") if isinstance(batch.get("service_stops"), list) else batch.get("visits")
                )
                planned_route = _items(batch.get("planned_route"))
                # A tabela local guarda as paradas autoritativas. Se um produtor v2
                # enviar apenas a rota planejada, preservamos os marcadores mínimos.
                visit_records = service_stops or planned_route
                technician = batch.get("technician") if isinstance(batch.get("technician"), dict) else {}
                technician_id = _text(_first(batch, "technician_id", "resource_id", "provider_id") or technician.get("id"), 160)
                technician_login = _text(_first(batch, "technician_login", "login", "external_id") or technician.get("login"), 160)
                technician_name = _text(_first(batch, "technician_name", "name") or technician.get("name"), 240)
                bucket = _text(batch.get("bucket"), 120)
                profile = _profile(bucket, _text(batch.get("profile"), 40))
                technician_key = technician_login or technician_id
                if not technician_key:
                    ignored += len(gps_real) + len(visit_records) or 1
                    continue
                technicians.add(technician_key)
                replace_visits = bool(
                    batch.get("replace_service_stops")
                    or batch.get("replace_planned_route")
                    or batch.get("replace_visits")
                )
                snapshot_date = _text(batch.get("visit_snapshot_date") or fallback_date, 10)
                if replace_visits:
                    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", snapshot_date):
                        identity = self._canonical_location_identity({
                            "technician_id": technician_id,
                            "technician_login": technician_login,
                            "technician_name": technician_name,
                            "bucket": bucket,
                        }, aliases)
                        delete_aliases = {
                            value.casefold() for value in (
                                technician_id, technician_login, identity.get("id", ""), identity.get("login", ""),
                            ) if value
                        }
                        placeholders = ",".join("?" for _ in delete_aliases)
                        if placeholders:
                            cursor = db.execute(
                                f"DELETE FROM technician_location_visits WHERE observed_date=? AND "
                                f"(lower(technician_id) IN ({placeholders}) OR lower(technician_login) IN ({placeholders}))",
                                [snapshot_date, *delete_aliases, *delete_aliases],
                            )
                            visits_deleted += max(0, cursor.rowcount)
                    else:
                        ignored += 1
                for raw in gps_real:
                    latitude = self._finite_number(_first(raw, "latitude", "lat"))
                    longitude = self._finite_number(_first(raw, "longitude", "lng", "lon"))
                    timestamp = self._location_timestamp(
                        _first(raw, "observed_at", "timestamp", "time", "captured_at"),
                        fallback_date,
                    )
                    if latitude is None or longitude is None or timestamp is None:
                        ignored += 1
                        continue
                    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                        ignored += 1
                        continue
                    observed_at = timestamp.isoformat(timespec="seconds")
                    observed_date = timestamp.date().isoformat()
                    accuracy = self._finite_number(_first(raw, "accuracy_m", "accuracy"))
                    speed = self._finite_number(_first(raw, "speed_kmh", "speed"))
                    heading = self._finite_number(raw.get("heading"))
                    altitude = self._finite_number(_first(raw, "altitude_m", "altitude"))
                    activity_id = _text(_first(raw, "activity_id", "activityId", "aid", "ta"), 160)
                    key_source = f"{technician_key}|{observed_at}|{latitude:.7f}|{longitude:.7f}"
                    point_key = hashlib.sha256(key_source.encode("utf-8")).hexdigest()
                    cursor = db.execute("""
                      INSERT OR IGNORE INTO technician_location_points(
                        point_key,technician_id,technician_login,technician_name,bucket,profile,
                        observed_date,observed_at,latitude,longitude,accuracy_m,speed_kmh,
                        heading,altitude_m,source,received_at,activity_id)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (point_key, technician_id, technician_login, technician_name, bucket, profile,
                          observed_date, observed_at, latitude, longitude, accuracy, speed,
                          heading, altitude, source, received_at, activity_id))
                    inserted += max(0, cursor.rowcount)
                for raw in visit_records:
                    latitude = self._finite_number(_first(raw, "latitude", "lat"))
                    longitude = self._finite_number(_first(raw, "longitude", "lng", "lon"))
                    if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                        ignored += 1
                        continue
                    scheduled = self._location_timestamp(
                        _first(raw, "scheduled_at", "start_at", "timestamp", "time"), fallback_date,
                    )
                    visit_date = _text(raw.get("date"), 10)
                    if scheduled:
                        scheduled_at = scheduled.isoformat(timespec="seconds")
                        observed_date = scheduled.date().isoformat()
                    else:
                        scheduled_at = ""
                        observed_date = visit_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", visit_date) else (fallback_date or dt.date.today().isoformat())
                    activity_id = _text(_first(raw, "activity_id", "aid"), 160)
                    marker_label = _text(_first(raw, "marker_label", "label"), 8).upper()
                    key_source = f"{technician_key}|{observed_date}|{activity_id}|{latitude:.7f}|{longitude:.7f}"
                    visit_key = hashlib.sha256(key_source.encode("utf-8")).hexdigest()
                    cursor = db.execute("""
                      INSERT INTO technician_location_visits(
                        visit_key,technician_id,technician_login,technician_name,bucket,profile,
                        observed_date,scheduled_at,latitude,longitude,marker_label,activity_id,
                        os_number,contract,service,status,source,received_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                      ON CONFLICT(visit_key) DO UPDATE SET
                        technician_name=excluded.technician_name,bucket=excluded.bucket,
                        profile=excluded.profile,scheduled_at=excluded.scheduled_at,
                        marker_label=excluded.marker_label,os_number=excluded.os_number,
                        contract=excluded.contract,service=excluded.service,status=excluded.status,
                        received_at=excluded.received_at
                    """, (visit_key, technician_id, technician_login, technician_name, bucket, profile,
                          observed_date, scheduled_at, latitude, longitude, marker_label, activity_id,
                          _text(_first(raw, "os_number", "os"), 160), _text(raw.get("contract"), 160),
                          _text(raw.get("service"), 400), _text(raw.get("status"), 120), source, received_at))
                    visits_inserted += max(0, cursor.rowcount)
        return {"ok": True, "schema": self.SCHEMA, "inserted": inserted,
                "visits_inserted": visits_inserted, "visits_deleted": visits_deleted, "ignored": ignored,
                "technicians": len(technicians), "received_at": received_at}

    @staticmethod
    def _track_metrics(rows: list[sqlite3.Row]) -> dict[str, Any]:
        distance_m = 0.0
        accepted_segments = 0
        rejected_segments = 0
        for previous, current in zip(rows, rows[1:]):
            segment = TOADatalakeStore._distance_meters(previous, current)
            try:
                left_time = dt.datetime.fromisoformat(previous["observed_at"])
                right_time = dt.datetime.fromisoformat(current["observed_at"])
                elapsed = max(0.0, (right_time - left_time).total_seconds())
            except (TypeError, ValueError):
                elapsed = 0.0
            derived_speed = (segment / elapsed) * 3.6 if elapsed else float("inf")
            accuracy = max(float(previous["accuracy_m"] or 0), float(current["accuracy_m"] or 0))
            # Uma coleta interrompida inicia outro trecho; saltos grandes,
            # velocidade impossivel e baixa precisao sao drift, nao quilometragem.
            if elapsed <= 0 or elapsed > 1800 or segment > 15000 or derived_speed > 140 or accuracy > 250:
                rejected_segments += 1
                continue
            # Oscilacoes menores que a margem combinada de GPS nao contam como deslocamento.
            if segment <= max(8.0, accuracy * 0.35):
                accepted_segments += 1
                continue
            distance_m += segment
            accepted_segments += 1
        return {
            "distance_km": round(distance_m / 1000, 3),
            "accepted_segments": accepted_segments,
            "rejected_segments": rejected_segments,
        }

    def technician_location_summary(self, *, date: str = "", profile: str = "") -> dict[str, Any]:
        selected_date = date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or "") else dt.date.today().isoformat()
        clauses = ["observed_date=?"]
        values: list[Any] = [selected_date]
        if profile:
            clauses.append("profile=?")
            values.append(profile.casefold())
        with self._connect() as db:
            aliases, activities = self._location_identity_maps(db)
            rows = db.execute(
                f"SELECT * FROM technician_location_points WHERE {' AND '.join(clauses)} "
                "ORDER BY technician_login,technician_id,observed_at", values,
            ).fetchall()
            visit_rows = db.execute(
                f"SELECT * FROM technician_location_visits WHERE {' AND '.join(clauses)} "
                "ORDER BY technician_login,technician_id,scheduled_at,marker_label", values,
            ).fetchall()
        valid_visits = self._valid_location_visits(visit_rows, aliases, activities, selected_date)
        visits_grouped: dict[str, list[tuple[sqlite3.Row, sqlite3.Row | None]]] = {}
        for row, activity in valid_visits:
            identity = self._canonical_location_identity(row, aliases)
            visits_grouped.setdefault(self._location_identity_key(identity), []).append((row, activity))
        grouped: dict[str, list[sqlite3.Row]] = {}
        for row in rows:
            identity = self._canonical_location_identity(row, aliases)
            if identity["name"] and identity["bucket"] and identity["name"].upper() == identity["bucket"]:
                continue
            grouped.setdefault(self._location_identity_key(identity), []).append(row)
        items = []
        for key, track in grouped.items():
            track = self._canonical_location_points(track)
            metrics = self._track_metrics(track)
            identity = self._canonical_location_identity(track[-1], aliases)
            items.append({
                "technician_id": identity["id"],
                "technician_login": identity["login"],
                "technician_name": identity["name"] or track[-1]["technician_name"] or key,
                "bucket": identity["bucket"] or track[-1]["bucket"], "profile": track[-1]["profile"],
                "point_count": len(track), "first_at": track[0]["observed_at"],
                "last_at": track[-1]["observed_at"], "visit_count": len(visits_grouped.get(key, [])), **metrics,
            })
        for key, visits in visits_grouped.items():
            if key in grouped:
                continue
            first, _ = visits[0]
            identity = self._canonical_location_identity(first, aliases)
            items.append({
                "technician_id": identity["id"],
                "technician_login": identity["login"],
                "technician_name": identity["name"] or first["technician_name"] or key,
                "bucket": identity["bucket"] or first["bucket"], "profile": first["profile"],
                "point_count": 0, "visit_count": len(visits),
                "first_at": "", "last_at": "", "distance_km": 0.0,
                "accepted_segments": 0, "rejected_segments": 0,
            })
        items.sort(key=lambda row: (-row["distance_km"], row["technician_name"].casefold()))
        return {"ok": True, "schema": self.SCHEMA, "date": selected_date,
                "technician_count": len(items),
                "point_count": sum(item["point_count"] for item in items), "items": items}

    def technician_location_track(self, identifier: str, *, date: str = "") -> dict[str, Any]:
        selected_date = date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or "") else dt.date.today().isoformat()
        key = _text(identifier, 160)
        with self._connect() as db:
            aliases, activities = self._location_identity_maps(db)
            requested = aliases.get(key.casefold()) or {"id": key, "login": key, "name": key, "bucket": ""}
            requested_key = self._location_identity_key(requested)
            all_rows = db.execute("""
              SELECT * FROM technician_location_points WHERE observed_date=? ORDER BY observed_at
            """, (selected_date,)).fetchall()
            all_visit_rows = db.execute("""
              SELECT * FROM technician_location_visits
              WHERE observed_date=? ORDER BY scheduled_at,marker_label,activity_id
            """, (selected_date,)).fetchall()
        rows = [row for row in all_rows if self._location_identity_key(
            self._canonical_location_identity(row, aliases)) == requested_key]
        rows = self._canonical_location_points(rows)
        valid_visits = self._valid_location_visits(
            all_visit_rows, aliases, activities, selected_date,
        )
        visit_rows = [(row, activity) for row, activity in valid_visits if self._location_identity_key(
            self._canonical_location_identity(row, aliases)) == requested_key]
        points = [{
            "observed_at": row["observed_at"], "latitude": row["latitude"],
            "longitude": row["longitude"], "accuracy_m": row["accuracy_m"],
            "speed_kmh": row["speed_kmh"], "heading": row["heading"],
            "altitude_m": row["altitude_m"], "activity_id": row["activity_id"],
        } for row in rows]
        metrics = self._track_metrics(rows)
        visits = [{
            "scheduled_at": row["scheduled_at"], "latitude": row["latitude"],
            "longitude": row["longitude"],
            "marker_label": row["marker_label"] or (_text(activity["route_position"], 8) if activity else ""),
            "activity_id": row["activity_id"], "os_number": row["os_number"],
            "contract": row["contract"] or (activity["contract"] if activity else ""),
            "service": row["service"] or (activity["description"] if activity else ""),
            "status": row["status"] or (activity["status"] if activity else ""),
        } for row, activity in visit_rows]
        # Paradas de OS sao pontos de atendimento, nao a geometria da rota.
        # A rota planejada permanece vazia ate o TOA fornecer uma polyline real.
        planned_route = []
        identity = self._canonical_location_identity(rows[-1], aliases) if rows else requested
        return {"ok": True, "schema": self.SCHEMA, "date": selected_date,
                "technician": identity,
                "point_count": len(points), "visit_count": len(visits), **metrics,
                "points": points, "visits": visits, "planned_route": planned_route}

    def close_technician_location_day(self, *, date: str = "", source: str = "") -> dict[str, Any]:
        selected_date = date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or "") else dt.date.today().isoformat()
        summary = self.technician_location_summary(date=selected_date)
        closed_at = _now()
        details = {
            "distance_km": round(sum(float(item.get("distance_km") or 0) for item in summary["items"]), 3),
            "technicians": summary["items"],
        }
        with self.lock, self._connect() as db:
            db.execute("""
              INSERT INTO technician_daily_closures(
                closure_date,closed_at,source,technician_count,point_count,details_json)
              VALUES(?,?,?,?,?,?)
              ON CONFLICT(closure_date) DO UPDATE SET
                closed_at=excluded.closed_at,source=excluded.source,
                technician_count=excluded.technician_count,point_count=excluded.point_count,
                details_json=excluded.details_json
            """, (selected_date, closed_at, _text(source or "toa-location-bridge", 120),
                  summary["technician_count"], summary["point_count"],
                  json.dumps(details, ensure_ascii=False, separators=(",", ":"))))
        return {"ok": True, "schema": self.SCHEMA, "date": selected_date,
                "closed_at": closed_at, "technician_count": summary["technician_count"],
                "point_count": summary["point_count"], **details}

    @staticmethod
    def _set_collector_state(
        db: sqlite3.Connection, *, collector: str, state: str, source: str = "",
        bucket: str = "", success_at: str = "", attempt_at: str = "",
        error: str = "", records: int = 0, details: dict[str, Any] | None = None,
    ) -> None:
        safe_details = {
            _text(key, 80): value for key, value in (details or {}).items()
            if _text(key, 80).casefold() not in {"cookie", "cookies", "token", "password", "senha", "csrf"}
        }
        details_json = json.dumps(safe_details, ensure_ascii=False, separators=(",", ":"))
        db.execute("""INSERT INTO collector_state(
          collector,state,source,bucket,last_success_at,last_attempt_at,last_error,records,details_json)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(collector) DO UPDATE SET
          state=excluded.state,
          source=CASE WHEN excluded.source<>'' THEN excluded.source ELSE source END,
          bucket=CASE WHEN excluded.bucket<>'' THEN excluded.bucket ELSE bucket END,
          last_success_at=CASE WHEN excluded.last_success_at<>'' THEN excluded.last_success_at ELSE last_success_at END,
          last_attempt_at=CASE WHEN excluded.last_attempt_at<>'' THEN excluded.last_attempt_at ELSE last_attempt_at END,
          last_error=excluded.last_error,records=excluded.records,details_json=excluded.details_json""",
          (collector, state, source, bucket, success_at, attempt_at or _now(),
           _text(error, 600), max(0, int(records or 0)), details_json))

    def collector_heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        collector = _text(payload.get("collector"), 120)
        if not collector:
            raise ValueError("collector e obrigatorio")
        state = _text(payload.get("state") or "online", 40).casefold()
        if state not in {"online", "starting", "authenticating", "degraded", "offline", "error"}:
            raise ValueError("state de coletor invalido")
        observed_at = _text(payload.get("observed_at"), 80) or _now()
        details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
        with self.lock, self._connect() as db:
            self._set_collector_state(
                db, collector=collector, state=state, source=_text(payload.get("source"), 120),
                bucket=_text(payload.get("bucket"), 120),
                success_at=observed_at if state == "online" else "", attempt_at=observed_at,
                error=_text(payload.get("error"), 600), records=int(payload.get("records") or 0),
                details=details,
            )
        return {"ok": True, "collector": collector, "state": state, "observed_at": observed_at}

    @staticmethod
    def _activity(raw: dict[str, Any], profile: str = "") -> dict[str, str]:
        tech = raw.get("technician") if isinstance(raw.get("technician"), dict) else {}
        bucket = _text(_first(raw, "bucket", "resource_bucket"), 120)
        return {
            "activity_id": _digits(_first(raw, "activity_id", "atividade_id", "id", "pid")),
            "profile": _profile(bucket, _text(_first(raw, "profile", "profile_key") or profile, 40)),
            "contract": _digits(_first(raw, "contract", "contrato", "customer_number")),
            "description": _text(_first(raw, "description", "descricao", "atividade_descricao", "work_type")),
            "activity_type": _text(_first(raw, "activity_type", "atividade_tipo", "type_id", "t"), 120),
            "bucket": bucket,
            "technician_id": _text(_first(raw, "technician_id", "tecnico_id", "resource_id") or tech.get("id"), 160),
            "technician_login": _text(_first(raw, "technician_login", "login", "user_id", "usuario_id") or tech.get("login"), 160),
            "technician_name": _text(_first(raw, "technician_name", "tecnico_nome", "resource_name") or tech.get("name")),
            "status": _text(_first(raw, "status", "status_toa", "activity_status", "s"), 120),
            "scheduled_date": _text(_first(raw, "scheduled_date", "atividade_data", "date", "data_atividade"), 40)[:10],
            "start_min": _text(_first(raw, "start_min", "inicio_min", "S"), 20),
            "duration_min": _text(_first(raw, "duration_min", "duration_minutes", "d"), 20),
            "travel_min": _text(_first(raw, "travel_min", "travel_minutes", "G"), 20),
            "route_position": _text(_first(raw, "route_position", "position", "i"), 20),
            "service_window": _text(_first(raw, "service_window", "time_window", "janela"), 120),
            "start_time": _text(_first(raw, "start_time", "started_at", "inicio"), 60),
            "end_time": _text(_first(raw, "end_time", "ended_at", "fim"), 60),
            "city": _text(_first(raw, "city", "cidade"), 160),
            "observation": _text(_first(raw, "observation", "technician_observation", "observacao")),
        }

    @staticmethod
    def _order(raw: dict[str, Any], aid: str = "", contract: str = "") -> dict[str, str]:
        return {
            "os_number": _digits(_first(raw, "os_number", "os_id", "num_os", "id")),
            "activity_id": _digits(_first(raw, "activity_id", "atividade_id") or aid),
            "contract": _digits(_first(raw, "contract", "contrato") or contract),
            "task_index": _text(_first(raw, "task_index", "indice", "index"), 20),
            "service": _text(_first(raw, "service", "tipo_os", "description")),
            "status": _text(_first(raw, "status", "status_toa", "os_status"), 120),
            "close_code": _digits(_first(raw, "close_code", "codigo_baixa", "codigo_baixa_id")),
        }

    def _save_order(self, db: sqlite3.Connection, row: dict[str, str], stamp: str) -> None:
        if not row["os_number"]:
            return
        db.execute("""INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(os_number) DO UPDATE SET
          activity_id=CASE WHEN excluded.activity_id<>'' THEN excluded.activity_id ELSE activity_id END,
          contract=CASE WHEN excluded.contract<>'' THEN excluded.contract ELSE contract END,
          task_index=excluded.task_index,service=CASE WHEN excluded.service<>'' THEN excluded.service ELSE service END,
          status=CASE WHEN excluded.status<>'' THEN excluded.status ELSE status END,
          close_code=CASE WHEN excluded.close_code<>'' THEN excluded.close_code ELSE close_code END,
          updated_at=excluded.updated_at""", (*row.values(), stamp))

    def ingest(self, payload: dict[str, Any]) -> dict[str, Any]:
        activities = _items(payload.get("activities") or payload.get("atividades"))
        orders = _items(payload.get("orders") or payload.get("activities_os") or payload.get("atividades_os"))
        details = _items(payload.get("details") or payload.get("detalhes"))
        active_ids = list(dict.fromkeys(
            _digits(item) for item in (payload.get("active_activity_ids") or [])
            if _digits(item)
        ))
        if not activities and not orders and not details:
            raise ValueError("O lote nao contem activities, orders ou details")
        if len(activities) + len(orders) + len(details) > 20000:
            raise ValueError("Lote excede 20000 registros")
        stamp = _text(payload.get("observed_at") or payload.get("collected_at"), 80) or _now()
        profile = _text(payload.get("profile"), 40)
        with self.lock, self._connect() as db:
            for raw in activities:
                row = self._activity(raw, profile)
                if not row["activity_id"]:
                    continue
                previous = db.execute(
                    "SELECT status,technician_id,bucket,contract FROM activities WHERE activity_id=?",
                    (row["activity_id"],),
                ).fetchone()
                db.execute("""INSERT INTO activities(
                    activity_id,profile,contract,description,activity_type,bucket,technician_id,
                    technician_login,technician_name,status,scheduled_date,start_min,duration_min,
                    travel_min,route_position,service_window,start_time,end_time,city,observation,
                    detail_state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(activity_id) DO UPDATE SET
                  profile=CASE WHEN excluded.profile<>'other' THEN excluded.profile ELSE profile END,
                  contract=CASE WHEN excluded.contract<>'' THEN excluded.contract ELSE contract END,
                  description=CASE WHEN excluded.description<>'' THEN excluded.description ELSE description END,
                  activity_type=CASE WHEN excluded.activity_type<>'' THEN excluded.activity_type ELSE activity_type END,
                  bucket=CASE WHEN excluded.bucket<>'' THEN excluded.bucket ELSE bucket END,
                  technician_id=CASE WHEN excluded.technician_id<>'' THEN excluded.technician_id ELSE technician_id END,
                  technician_login=CASE WHEN excluded.technician_login<>'' THEN excluded.technician_login ELSE technician_login END,
                  technician_name=CASE WHEN excluded.technician_name<>'' THEN excluded.technician_name ELSE technician_name END,
                  status=CASE
                    WHEN excluded.status='' THEN activities.status
                    -- O Time/get e uma fotografia resumida e pode chegar atrasado.
                    -- Um estado final ja confirmado pelo detalhe oficial nao pode
                    -- ser reaberto por pending/started/enroute da leitura resumida.
                    WHEN activities.detail_state='complete'
                      AND (LOWER(activities.status) LIKE '%complete%'
                        OR LOWER(activities.status) LIKE '%conclu%'
                        OR LOWER(activities.status) LIKE '%notdone%'
                        OR LOWER(activities.status) LIKE '%cancel%'
                        OR LOWER(activities.status) LIKE '%suspend%')
                      AND NOT (LOWER(excluded.status) LIKE '%complete%'
                        OR LOWER(excluded.status) LIKE '%conclu%'
                        OR LOWER(excluded.status) LIKE '%notdone%'
                        OR LOWER(excluded.status) LIKE '%cancel%'
                        OR LOWER(excluded.status) LIKE '%suspend%')
                      THEN activities.status
                    ELSE excluded.status END,
                  scheduled_date=CASE WHEN excluded.scheduled_date<>'' THEN excluded.scheduled_date ELSE scheduled_date END,
                  start_min=CASE WHEN excluded.start_min<>'' THEN excluded.start_min ELSE start_min END,
                  duration_min=CASE WHEN excluded.duration_min<>'' THEN excluded.duration_min ELSE duration_min END,
                  travel_min=CASE WHEN excluded.travel_min<>'' THEN excluded.travel_min ELSE travel_min END,
                  route_position=CASE WHEN excluded.route_position<>'' THEN excluded.route_position ELSE route_position END,
                  service_window=CASE WHEN excluded.service_window<>'' THEN excluded.service_window ELSE service_window END,
                  start_time=CASE WHEN excluded.start_time<>'' THEN excluded.start_time ELSE start_time END,
                  end_time=CASE WHEN excluded.end_time<>'' THEN excluded.end_time ELSE end_time END,
                  city=CASE WHEN excluded.city<>'' THEN excluded.city ELSE city END,
                  observation=CASE WHEN excluded.observation<>'' THEN excluded.observation ELSE observation END,
                  detail_state=CASE
                    WHEN excluded.status='' THEN activities.detail_state
                    WHEN activities.detail_state='complete'
                      AND (LOWER(activities.status) LIKE '%complete%'
                        OR LOWER(activities.status) LIKE '%conclu%'
                        OR LOWER(activities.status) LIKE '%notdone%'
                        OR LOWER(activities.status) LIKE '%cancel%'
                        OR LOWER(activities.status) LIKE '%suspend%')
                      AND NOT (LOWER(excluded.status) LIKE '%complete%'
                        OR LOWER(excluded.status) LIKE '%conclu%'
                        OR LOWER(excluded.status) LIKE '%notdone%'
                        OR LOWER(excluded.status) LIKE '%cancel%'
                        OR LOWER(excluded.status) LIKE '%suspend%')
                      THEN 'complete'
                    WHEN activities.status<>excluded.status THEN 'pending'
                    WHEN excluded.technician_id<>'' AND activities.technician_id<>excluded.technician_id THEN 'pending'
                    WHEN excluded.start_min<>'' AND activities.start_min<>excluded.start_min THEN 'pending'
                    ELSE activities.detail_state END,
                  detail_checked_at=CASE
                    WHEN (excluded.technician_id<>'' AND activities.technician_id<>excluded.technician_id)
                      OR (excluded.start_min<>'' AND activities.start_min<>excluded.start_min)
                      OR (activities.status<>excluded.status) THEN ''
                    ELSE activities.detail_checked_at END,
                  updated_at=excluded.updated_at""", (*row.values(), "complete" if details else "pending", stamp))
                persisted = db.execute(
                    "SELECT status,technician_id,bucket,contract FROM activities WHERE activity_id=?",
                    (row["activity_id"],),
                ).fetchone()
                if previous and persisted:
                    for field, event_type in (
                        ("status", "status_changed"),
                        ("technician_id", "technician_changed"),
                        ("bucket", "bucket_changed"),
                    ):
                        before = _text(previous[field])
                        after = _text(persisted[field]) or before
                        if before != after:
                            db.execute("""INSERT INTO activity_events(
                              activity_id,contract,event_type,previous_value,current_value,
                              observed_at,source) VALUES(?,?,?,?,?,?,?)""",
                              (row["activity_id"], _text(persisted["contract"]) or _text(previous["contract"]),
                               event_type, before, after, stamp,
                               _text(payload.get("source"), 120) or "collector"))
                for child in _items(raw.get("orders") or raw.get("tasks")):
                    self._save_order(db, self._order(child, row["activity_id"], row["contract"]), stamp)
            for raw in orders:
                self._save_order(db, self._order(raw), stamp)
            for raw in details:
                self._save_detail(db, raw, stamp, profile)
            if payload.get("snapshot_complete") is True and active_ids:
                db.execute("DELETE FROM live_visible")
                db.executemany(
                    "INSERT INTO live_visible(activity_id,observed_at) VALUES(?,?)",
                    [(activity_id, stamp) for activity_id in active_ids],
                )
                # O coletor DOM antigo usava S+d (agenda da rota) como se fosse
                # janela do cliente. Sem OS/detalhe vinculado esse valor nao e
                # uma janela oficial e gerava TEC1 falso na TV.
                db.execute("""UPDATE activities SET service_window=''
                  WHERE activity_id IN (SELECT activity_id FROM live_visible)
                    AND activity_id NOT IN (SELECT activity_id FROM orders)""")
            db.execute("INSERT INTO runs(source,observed_at,received_at,activities,orders,details) VALUES(?,?,?,?,?,?)",
                       (_text(payload.get("source"), 120) or "n8n", stamp, _now(), len(activities), len(orders), len(details)))
            collector = _text(payload.get("collector"), 120)
            if collector:
                self._set_collector_state(
                    db, collector=collector, state="online", source=_text(payload.get("source"), 120),
                    bucket=_text(payload.get("bucket"), 120), success_at=stamp,
                    attempt_at=_now(), error="", records=len(active_ids) or len(activities),
                    details=payload.get("collector_details") if isinstance(payload.get("collector_details"), dict) else {},
                )
        return {"ok": True, "schema": self.SCHEMA, "activities": len(activities),
                "orders": len(orders), "details": len(details), "status": self.status()}

    def ingest_history(self, payload: dict[str, Any]) -> dict[str, Any]:
        aid = _digits(_first(payload, "activity_id", "aid"))
        rows = _items(payload.get("rows") or payload.get("history"))
        if not aid or not rows:
            raise ValueError("Historico sem activity_id ou eventos")
        stamp = _text(payload.get("observed_at"), 80) or _now()
        contract = _digits(_first(payload, "contract", "contrato"))
        normalized_rows: list[dict[str, str]] = []
        for raw in rows:
            changes = []
            for change in _items(raw.get("changes")):
                label = _text(_first(change, "translation", "label", "name"), 240)
                if any(sensitive in _ascii(label) for sensitive in (
                    "nome do cliente", "endereco", "telefone", "e-mail", "email", "cpf", "documento do cliente"
                )):
                    continue
                if re.search(r"(?:nome\s+do\s+cliente|endere[cÃ§]o|telefone|e-?mail|cpf|documento\s+do\s+cliente)", label, re.I):
                    continue
                changes.append(change)
            for change in changes:
                label = _text(_first(change, "translation", "label", "name"), 240)
                if not contract and re.search(r"^contrato$", label, re.I):
                    contract = _digits(change.get("value"))
            actions = _items(raw.get("action"))
            action = " | ".join(_text(_first(item, "translation", "label", "name"), 160) for item in actions)
            action_time = _text(raw.get("action_time"), 40)
            action_timestamp = _text(raw.get("action_timestamp"), 50)
            user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
            user_name = _text(_first(user, "name", "login"), 240)
            changes_json = json.dumps(changes, ensure_ascii=False, separators=(",", ":"))
            digest_source = "|".join((action_timestamp, action_time, user_name, action, changes_json))
            event_key = hashlib.sha256(digest_source.encode("utf-8")).hexdigest()[:32]
            normalized_rows.append({
                "activity_id": aid, "event_key": event_key, "contract": contract,
                "action_time": action_time, "action_timestamp": action_timestamp,
                "user_name": user_name, "action": action, "changes_json": changes_json,
            })
        with self.lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM activities WHERE activity_id=?", (aid,)).fetchone():
                db.execute("""INSERT INTO activities(
                  activity_id,profile,contract,description,activity_type,bucket,technician_id,
                  technician_login,technician_name,status,scheduled_date,start_min,duration_min,
                  travel_min,route_position,service_window,start_time,end_time,city,observation,
                  detail_state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (aid, "other", contract, "Atividade TOA", "", "", "", "", "", "", "",
                   "", "", "", "", "", "", "", "", "", "history", stamp))
            elif contract:
                db.execute("UPDATE activities SET contract=CASE WHEN contract='' THEN ? ELSE contract END WHERE activity_id=?", (contract, aid))
            for row in normalized_rows:
                db.execute("""INSERT INTO activity_history VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(activity_id,event_key) DO UPDATE SET
                  contract=excluded.contract,action_time=excluded.action_time,
                  action_timestamp=excluded.action_timestamp,user_name=excluded.user_name,
                  action=excluded.action,changes_json=excluded.changes_json,updated_at=excluded.updated_at""",
                  (*row.values(), stamp))
        return {"ok": True, "activity_id": aid, "contract": contract, "events": len(normalized_rows)}

    @staticmethod
    def _history_summary(history: list[dict[str, Any]]) -> dict[str, Any]:
        outcomes: dict[str, dict[str, Any]] = {}
        confirmations: list[dict[str, Any]] = []
        equipment: list[dict[str, Any]] = []
        for event in history:
            changes = event.get("changes") or []
            task_updates: dict[str, dict[str, str]] = {}
            serial = ""
            equipment_type = ""
            for change in changes:
                label = _text(_first(change, "translation", "label", "name"), 240)
                simple_label = _ascii(label)
                value = _text(change.get("value"))
                close_match = re.search(r"C[oÃ³]d(?:igo)?\s+de\s+Baixa\s*(\d+)", label, re.I)
                status_match = re.search(r"Status\s+da\s+O\.S\s*(\d+)", label, re.I)
                close_match = close_match or re.search(r"cod(?:igo)?\s+de\s+baixa\s*(\d+)", simple_label)
                status_match = status_match or re.search(r"status\s+da\s+o\.s\s*(\d+)", simple_label)
                if close_match:
                    task = close_match.group(1)
                    code_match = re.match(r"\s*(\d+)\s*(?:-\s*(.*))?", value)
                    task_updates.setdefault(task, {})["close_code"] = code_match.group(1) if code_match else ""
                    task_updates[task]["close_description"] = code_match.group(2) if code_match and code_match.group(2) else value
                if status_match:
                    task_updates.setdefault(status_match.group(1), {})["os_status"] = value
                if re.search(r"Valida[cÃ§][aÃ£]o\s+Baixa", label, re.I):
                    confirmations.append({"confirmed_at": event["action_time"], "message": value,
                                          "success": bool(re.search(r"sucesso", value, re.I)), "user": event["user_name"]})
                elif "validacao baixa" in simple_label:
                    confirmations.append({"confirmed_at": event["action_time"], "message": value,
                                          "success": bool(re.search(r"sucesso", value, re.I)), "user": event["user_name"]})
                if re.search(r"Serial\s+Equipamento\s+Instalado", label, re.I): serial = value
                if re.search(r"Tipo\s+de\s+Equipamento", label, re.I): equipment_type = value
            for task, values in task_updates.items():
                outcome = outcomes.setdefault(task, {"task_index": task})
                outcome.update(values)
                outcome.update({"tabulated_at": event["action_time"], "user": event["user_name"]})
            if serial or equipment_type:
                equipment.append({"type": equipment_type, "serial": serial, "recorded_at": event["action_time"]})
        return {"os_outcomes": list(outcomes.values()), "confirmations": confirmations,
                "installed_equipment_from_history": equipment}

    def _save_detail(self, db: sqlite3.Connection, raw: dict[str, Any], stamp: str, profile: str) -> None:
        aid = _digits(_first(raw, "activity_id", "atividade_id", "aid", "id"))
        contract = _digits(_first(raw, "contract", "contrato", "customer_number"))
        activity = self._activity(raw, profile)
        if not aid:
            aid = activity["activity_id"]
        if aid:
            db.execute("""UPDATE activities SET contract=CASE WHEN ?<>'' THEN ? ELSE contract END,
              status=CASE WHEN ?<>'' THEN ? ELSE status END,
              service_window=CASE WHEN ?<>'' THEN ? ELSE service_window END,
              start_time=CASE WHEN ?<>'' THEN ? ELSE start_time END,
              end_time=CASE WHEN ?<>'' THEN ? ELSE end_time END,
              observation=CASE WHEN ?<>'' THEN ? ELSE observation END,
              detail_state='complete',detail_checked_at=?,updated_at=?
              WHERE activity_id=?""", (contract, contract, activity["status"], activity["status"],
              activity["service_window"], activity["service_window"],
              activity["start_time"], activity["start_time"], activity["end_time"], activity["end_time"],
              activity["observation"], activity["observation"], stamp, stamp, aid))
        for child in _items(raw.get("orders") or raw.get("tasks")):
            self._save_order(db, self._order(child, aid, contract), stamp)
        equipment = raw.get("equipment") if isinstance(raw.get("equipment"), dict) else {}
        categories = {"installed": raw.get("installed_equipment") or equipment.get("installed", []),
                      "removed": raw.get("removed_equipment") or equipment.get("removed", []),
                      "customer": raw.get("customer_equipment") or equipment.get("customer", []),
                      "material": raw.get("materials") or raw.get("miscelaneas") or []}
        for category, values in categories.items():
            for index, item in enumerate(_items(values)):
                serial = _text(_first(item, "serial", "numero_serial"), 240)
                code = _text(_first(item, "code", "material_code", "codigo"), 120)
                inventory_id = _text(_first(item, "inventory_id", "invid", "id"), 160)
                key = inventory_id or serial or f"{code}:{index}"
                try:
                    quantity = float(str(_first(item, "quantity", "quantidade", "used_quantity") or 0).replace(",", "."))
                except (TypeError, ValueError):
                    quantity = 0
                db.execute("""INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(activity_id,category,item_key) DO UPDATE SET contract=excluded.contract,
                  code=excluded.code,description=excluded.description,serial=excluded.serial,
                  quantity=excluded.quantity,unit=excluded.unit,pool=excluded.pool,updated_at=excluded.updated_at""",
                  (aid or f"contract:{contract}", category, key, contract, inventory_id, code,
                   _text(_first(item, "description", "descricao", "name", "type")), serial, quantity,
                   _text(_first(item, "unit", "unidade"), 40), _text(_first(item, "pool", "movimentacao"), 80), stamp))

    def status(self) -> dict[str, Any]:
        with self.lock, self._connect() as db:
            counts = {name: db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                      for name in ("activities", "orders", "inventory", "activity_history")}
            counts["pending_details"] = db.execute("SELECT COUNT(*) FROM activities WHERE detail_state='pending'").fetchone()[0]
            last = db.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        return {"ok": True, "schema": self.SCHEMA, "counts": counts, "last_run": dict(last) if last else None}

    def detail_queue(self, limit: int = 100) -> dict[str, Any]:
        with self.lock, self._connect() as db:
            rows = [dict(row) for row in db.execute("""SELECT a.activity_id,a.contract,a.bucket,a.scheduled_date,
              a.technician_id,a.technician_login,a.status,a.start_min,a.duration_min,a.service_window,
              GROUP_CONCAT(o.os_number) os_numbers FROM activities a LEFT JOIN orders o ON o.activity_id=a.activity_id
              WHERE a.detail_state='pending'
                 OR (LOWER(a.status) IN ('started','iniciado','enroute','em rota')
                   AND (a.detail_checked_at='' OR julianday(a.detail_checked_at) <= julianday('now','-45 seconds')))
              GROUP BY a.activity_id
              ORDER BY CASE LOWER(a.status)
                WHEN 'started' THEN 0 WHEN 'iniciado' THEN 0
                WHEN 'enroute' THEN 1 WHEN 'em rota' THEN 1
                WHEN 'pending' THEN 2 WHEN 'pendente' THEN 2
                ELSE 3 END,
                CASE WHEN a.detail_state='pending' THEN 0 ELSE 1 END,
                COALESCE(NULLIF(a.detail_checked_at,''),'0000') ASC,
                CASE WHEN a.service_window LIKE '%:%-%:%' THEN 0 ELSE 1 END,
                CASE WHEN a.service_window LIKE '%:%-%:%'
                  THEN TRIM(SUBSTR(a.service_window, INSTR(a.service_window,'-') + 1))
                  ELSE '99:99' END,
                CASE WHEN a.start_min GLOB '[0-9]*' THEN CAST(a.start_min AS INTEGER) ELSE 99999 END,
                a.updated_at DESC LIMIT ?""",
              (min(1000, max(1, limit)),)).fetchall()]
        return {"ok": True, "count": len(rows), "items": rows}

    def record(self, identifier: str) -> dict[str, Any]:
        key = _digits(identifier)
        if not key:
            raise ValueError("Contrato ou atividade invalida")
        with self.lock, self._connect() as db:
            activities = [dict(row) for row in db.execute(
                "SELECT * FROM activities WHERE contract=? OR activity_id=? ORDER BY scheduled_date,start_min", (key, key))]
            aids = [row["activity_id"] for row in activities]
            if aids:
                marks = ",".join("?" for _ in aids)
                orders = [dict(row) for row in db.execute(
                    f"SELECT * FROM orders WHERE activity_id IN ({marks}) OR contract=? ORDER BY task_index,os_number", (*aids, key))]
                inventory = [dict(row) for row in db.execute(
                    f"SELECT * FROM inventory WHERE activity_id IN ({marks}) OR contract=? ORDER BY category,description,serial", (*aids, key))]
            else:
                orders = [dict(row) for row in db.execute("SELECT * FROM orders WHERE contract=?", (key,))]
                inventory = [dict(row) for row in db.execute("SELECT * FROM inventory WHERE contract=?", (key,))]
            history_rows = [dict(row) for row in db.execute(
                "SELECT * FROM activity_history WHERE contract=? OR activity_id=? ORDER BY action_timestamp,action_time",
                (key, key))]
        history = []
        for row in history_rows:
            row["changes"] = json.loads(row.pop("changes_json") or "[]")
            history.append(row)
        grouped = {name: [] for name in ("installed", "removed", "customer", "material")}
        for item in inventory:
            grouped.setdefault(item["category"], []).append(item)
        return {"ok": True, "schema": self.SCHEMA, "identifier": key, "activities": activities,
                "orders": orders, "inventory": grouped, "history": history,
                "operational_outcome": self._history_summary(history),
                "summary": {"activity_count": len(activities), "os_count": len(orders),
                            "inventory_count": len(inventory),
                            "detail_complete": bool(activities) and all(row["detail_state"] == "complete" for row in activities)}}

    def feed(self, profile: str = "", date: str = "") -> dict[str, Any]:
        clauses, values = [], []
        if profile and profile != "all": clauses.append("profile=?"); values.append(profile.casefold())
        if date: clauses.append("scheduled_date=?"); values.append(date)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.lock, self._connect() as db:
            last = db.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
            last_live = db.execute(
                "SELECT * FROM runs WHERE source='toa-live-all-buckets' ORDER BY id DESC LIMIT 1"
            ).fetchone()
            live_count = db.execute("SELECT COUNT(*) FROM live_visible").fetchone()[0]
            if last_live and live_count:
                live_clause = "activity_id IN (SELECT activity_id FROM live_visible)"
                where = f" WHERE {live_clause}" + (f" AND {' AND '.join(clauses)}" if clauses else "")
            activities = [dict(row) for row in db.execute(f"SELECT * FROM activities{where} ORDER BY scheduled_date,start_min", values)]
            linked = {row["activity_id"]: [] for row in activities}
            if linked:
                marks = ",".join("?" for _ in linked)
                for row in db.execute(f"SELECT * FROM orders WHERE activity_id IN ({marks})", list(linked)):
                    linked[row["activity_id"]].append(dict(row))
        # Uma realocacao cria outra atividade para o mesmo contrato enquanto a
        # tentativa anterior permanece na fotografia como suspended. Algumas
        # vezes as OS ainda ficam ligadas somente a tentativa antiga. Criamos
        # aqui uma visao operacional (sem alterar o dado bruto): a tentativa
        # nao suspensa mais recente passa a representar essas OS.
        families: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for activity in activities:
            contract = _text(activity.get("contract"))
            if not contract:
                continue
            signature = _text(activity.get("activity_type")) or _ascii(activity.get("description"))
            families.setdefault((contract, _text(activity.get("scheduled_date")), signature), []).append(activity)
        successor_by_suspended: dict[str, dict[str, Any]] = {}
        inherited_successors: set[str] = set()
        for attempts in families.values():
            current = [row for row in attempts if not _suspended_status(row.get("status"))
                       and "cancel" not in _ascii(row.get("status"))]
            if not current:
                continue
            successor = max(current, key=lambda row: (
                int(row.get("start_min")) if str(row.get("start_min", "")).isdigit() else -1,
                _text(row.get("updated_at")), _text(row.get("activity_id")),
            ))
            for old in attempts:
                if not _suspended_status(old.get("status")):
                    continue
                successor_by_suspended[old["activity_id"]] = successor
                if linked.get(old["activity_id"]) and not linked.get(successor["activity_id"]):
                    inherited_successors.add(successor["activity_id"])

        orders, timeline = [], []
        for a in activities:
            successor = successor_by_suspended.get(a["activity_id"])
            effective = successor or a
            # Tentativa suspensa e historica. Se houver realocacao atual, ela
            # nao pode aparecer novamente como pendente/em execucao/TEC1.
            if successor and not linked[a["activity_id"]]:
                continue
            if a["activity_id"] in inherited_successors and not linked[a["activity_id"]]:
                continue
            effective_window = effective["service_window"]
            start_m = int(effective["start_min"]) if str(effective.get("start_min", "")).isdigit() else None
            if start_m is not None and effective_window and "-" in effective_window:
                parts = [p.strip() for p in effective_window.split("-")]
                if len(parts) == 2 and ":" in parts[1]:
                    try:
                        wh, wm = map(int, parts[1].split(":")[:2])
                        if start_m > (wh * 60 + wm) and not _terminal_status(effective["status"]):
                            effective_window = ""
                    except Exception:
                        pass
            common = {"profile": effective["profile"], "date": effective["scheduled_date"], "scheduled_date": effective["scheduled_date"],
              "technician": effective["technician_name"] or effective["technician_login"] or effective["technician_id"],
              "technician_name": effective["technician_name"], "technician_login": effective["technician_login"],
              "activity_status": effective["status"], "city": effective["city"], "contract": effective["contract"],
              "service_window": effective_window, "time_window": effective_window,
              "detail_state": effective["detail_state"],
              "is_scheduled": not _oracle_unscheduled(
                  effective["scheduled_date"], effective["start_time"], effective["end_time"]),
              "started_at": effective["start_time"], "ended_at": effective["end_time"], "activity_type": effective["activity_type"],
              "activity_id": effective["activity_id"], "bucket": effective["bucket"], "observation": effective["observation"],
              "route_start": _clock_from_minutes(effective["start_min"]),
              "route_end": _clock_after_minutes(effective["start_min"], effective["duration_min"]),
              "travel_time": effective["travel_min"], "route_position": effective["route_position"],
              "source_file": "DATALAKE TOA"}
            if successor:
                common["reallocated_from_activity_id"] = a["activity_id"]
            if not linked[a["activity_id"]]:
                auxiliary = bool(re.search(r"REFEI[CÇ][AÃ]O|NA BASE|REUNI[AÃ]O", a["description"], re.I))
                row = {**common, "service": a["description"] or "Atividade TOA", "status": a["status"]}
                if auxiliary:
                    timeline.append({**row, "is_auxiliary": True,
                                     "auxiliary_type": "meal" if re.search(r"REFEI", a["description"], re.I) else "toa_activity"})
                else:
                    orders.append({**row, "os_number": a["activity_id"], "num_os": a["activity_id"],
                                   "toa_status": a["status"], "live_activity": True})
            for order in linked[a["activity_id"]]:
                orders.append({**common, "contract": order["contract"] or a["contract"],
                  "os_number": order["os_number"], "num_os": order["os_number"],
                  "service": order["service"] or effective["description"],
                  # O ciclo de vida da atividade oficial sempre prevalece sobre
                  # status vazio/antigo da tarefa individual.
                  "status": effective["status"] if _terminal_status(effective["status"])
                    else (order["status"] or effective["status"]),
                  "toa_status": effective["status"] if _terminal_status(effective["status"])
                    else (order["status"] or effective["status"]),
                  "close_code": order["close_code"]})
        last_row = dict(last) if last else {}
        live_row = dict(last_live) if last_live else {}
        observed = live_row.get("observed_at") or last_row.get("observed_at") or _now()
        last_source = live_row.get("source") or last_row.get("source", "")
        live_age_seconds = None
        if live_row.get("received_at"):
            try:
                live_age_seconds = max(0, int((dt.datetime.now().astimezone() - dt.datetime.fromisoformat(live_row["received_at"])).total_seconds()))
            except (TypeError, ValueError):
                live_age_seconds = None
        return {"ok": True, "schema": self.SCHEMA, "source": "toa_datalake",
          # O coletor opera em ciclos moderados para nao pressionar o Oracle.
          # A fotografia continua valida entre dois ciclos completos.
          "live": last_source == "toa-live-all-buckets" and live_age_seconds is not None and live_age_seconds <= 180,
          "liveAgeSeconds": live_age_seconds, "lastRunSource": last_source,
          "files": [{"filename": "DATALAKE TOA", "bucket": "TODOS", "sourceRows": len(activities)}],
          "orders": orders, "timelineActivities": timeline, "errors": [], "loadedAt": observed}

    def collectors(self) -> list[dict[str, Any]]:
        now = dt.datetime.now().astimezone()
        with self.lock, self._connect() as db:
            rows = [dict(row) for row in db.execute(
                "SELECT * FROM collector_state ORDER BY collector"
            )]
        for row in rows:
            try:
                stamp = dt.datetime.fromisoformat(row.get("last_success_at") or "")
                row["age_seconds"] = max(0, int((now - stamp).total_seconds()))
            except (TypeError, ValueError):
                row["age_seconds"] = None
            row["fresh"] = row["state"] == "online" and row["age_seconds"] is not None and row["age_seconds"] <= 180
            try:
                row["details"] = json.loads(row.pop("details_json") or "{}")
            except json.JSONDecodeError:
                row["details"] = {}
        return rows

    def health(self) -> dict[str, Any]:
        status = self.status()
        collectors = self.collectors()
        active = [row for row in collectors if row["fresh"]]
        return {
            "ok": True,
            "service": "dominium-toa-monitor",
            "schema": self.SCHEMA,
            "database": {"ok": True, "counts": status["counts"]},
            "collector": {
                "ok": bool(active),
                "state": "online" if active else ("degraded" if collectors else "offline"),
                "items": collectors,
            },
            "last_run": status["last_run"],
            "server_time": _now(),
        }

    def monitor_summary(self, profile: str = "", date: str = "") -> dict[str, Any]:
        feed = self.feed(profile=profile, date=date)
        rows = feed["orders"]
        counts = {"total": len(rows), "field": 0, "completed": 0, "pending": 0}
        for row in rows:
            counts[_status_group(row.get("status"))] += 1
        active_technicians = {
            _text(row.get("technician"), 240) for row in rows
            if _status_group(row.get("status")) == "field" and _text(row.get("technician"), 240)
        }
        alerts = self.tec1_alerts(profile=profile, date=date, horizon_minutes=30, include_late=True)
        return {
            "ok": True, "schema": self.SCHEMA, "source": feed["source"],
            "live": feed["live"], "loaded_at": feed["loadedAt"],
            "counts": {**counts, "active_technicians": len(active_technicians),
                       "tec1_attention": alerts["counts"]["attention"],
                       "tec1_late": alerts["counts"]["late"]},
            "collectors": self.collectors(),
        }

    def activities_api(
        self, *, profile: str = "", date: str = "", status: str = "",
        bucket: str = "", limit: int = 500, offset: int = 0,
    ) -> dict[str, Any]:
        feed = self.feed(profile=profile, date=date)
        rows = feed["orders"]
        if status:
            wanted = status.casefold()
            rows = [row for row in rows if _status_group(row.get("status")) == wanted
                    or _ascii(row.get("status")) == _ascii(wanted)]
        if bucket:
            rows = [row for row in rows if _ascii(row.get("bucket")) == _ascii(bucket)]
        safe_rows = []
        for row in rows:
            is_scheduled = not _oracle_unscheduled(
                row.get("scheduled_date"), row.get("started_at"), row.get("ended_at"))
            safe_rows.append({
                "activity_id": row.get("activity_id", ""), "os": row.get("os_number", ""),
                "contract": row.get("contract", ""),
                "service": _text(row.get("service"), 240).split(",", 1)[0],
                "status": row.get("status", ""), "status_group": _status_group(row.get("status")),
                "date": row.get("scheduled_date", ""), "service_window": row.get("service_window", ""),
                "route_start": row.get("route_start", ""), "route_end": row.get("route_end", ""),
                "technician": row.get("technician", ""), "technician_login": row.get("technician_login", ""),
                "bucket": row.get("bucket", ""), "observation": row.get("observation", ""),
                "detail_state": row.get("detail_state", ""),
                "is_scheduled": is_scheduled,
                "window_verified": is_scheduled and (
                    not row.get("detail_state") or row.get("detail_state") == "complete"),
            })
        total = len(safe_rows)
        start = max(0, offset)
        end = start + min(5000, max(1, limit))
        return {"ok": True, "schema": self.SCHEMA, "total": total, "offset": start,
                "limit": end - start, "items": safe_rows[start:end], "live": feed["live"],
                "loaded_at": feed["loadedAt"]}

    def buckets(self, profile: str = "", date: str = "") -> dict[str, Any]:
        rows = self.activities_api(profile=profile, date=date, limit=5000)["items"]
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            name = _text(row.get("bucket"), 120) or "NAO_INFORMADO"
            item = grouped.setdefault(name, {"bucket": name, "total": 0, "field": 0, "completed": 0, "pending": 0})
            item["total"] += 1
            item[row["status_group"]] += 1
        return {"ok": True, "count": len(grouped), "items": sorted(grouped.values(), key=lambda row: row["bucket"])}

    def technicians(self, profile: str = "", date: str = "") -> dict[str, Any]:
        rows = self.activities_api(profile=profile, date=date, limit=5000)["items"]
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = _text(row.get("technician_login"), 160) or _text(row.get("technician"), 240) or "NAO_INFORMADO"
            item = grouped.setdefault(key, {
                "login": row.get("technician_login", ""), "name": row.get("technician", ""),
                "buckets": set(), "total": 0, "field": 0, "completed": 0, "pending": 0,
            })
            item["buckets"].add(row.get("bucket", ""))
            item["total"] += 1
            item[row["status_group"]] += 1
        items = []
        for item in grouped.values():
            item["buckets"] = sorted(value for value in item["buckets"] if value)
            items.append(item)
        items.sort(key=lambda row: (row["name"] or row["login"]).casefold())
        return {"ok": True, "count": len(items), "items": items}

    def tec1_alerts(
        self, *, profile: str = "", date: str = "", horizon_minutes: int = 30,
        include_late: bool = True,
    ) -> dict[str, Any]:
        rows = self.activities_api(profile=profile, date=date, limit=5000)["items"]
        now = dt.datetime.now().astimezone()
        by_contract: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not row.get("is_scheduled", True):
                continue
            if row.get("detail_state") and row.get("detail_state") != "complete":
                continue
            if row["status_group"] == "completed":
                continue
            deadline = _window_end(row.get("date"), row.get("service_window"))
            if not deadline:
                continue
            minutes = int((deadline - now).total_seconds() // 60)
            if minutes > horizon_minutes or (minutes < 0 and not include_late):
                continue
            key = row.get("contract") or row.get("activity_id") or row.get("os")
            alert = by_contract.setdefault(key, {
                "key": key, "contract": row.get("contract", ""), "activity_ids": [], "os_numbers": [],
                "technician": row.get("technician", ""), "technician_login": row.get("technician_login", ""),
                "bucket": row.get("bucket", ""), "window": row.get("service_window", ""),
                "deadline": deadline.isoformat(), "minutes_remaining": minutes,
                "state": "late" if minutes < 0 else "attention", "services": [],
            })
            alert["activity_ids"].append(row.get("activity_id", ""))
            alert["os_numbers"].append(row.get("os", ""))
            alert["services"].append(row.get("service", ""))
            if minutes < alert["minutes_remaining"]:
                alert["minutes_remaining"] = minutes
                alert["state"] = "late" if minutes < 0 else "attention"
        items = sorted(by_contract.values(), key=lambda row: (row["minutes_remaining"], row["contract"]))
        return {"ok": True, "horizon_minutes": horizon_minutes,
                "counts": {"total": len(items),
                           "attention": sum(row["state"] == "attention" for row in items),
                           "late": sum(row["state"] == "late" for row in items)},
                "items": items}
