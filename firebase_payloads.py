from __future__ import annotations

import json
import math
import re
import time
from typing import Any, Callable

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_KEY_RE = re.compile(r"[.#$\[\]/]")


def safe_key(value: Any, *, max_length: int = 700) -> str:
    text = str(value or "sem-id")
    return _KEY_RE.sub("_", text)[:max_length]


def _fnv1a(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    result = 2166136261
    for char in text:
        result ^= ord(char)
        result = (result * 16777619) & 0xFFFFFFFF
    return format(result, "x")


def _stable_key(parts: list[Any], fallback: str) -> str:
    values = [str(item) for item in parts if item]
    return "_".join(values) if values else fallback


def _keyed(items: list[Any], key_of: Callable[[dict[str, Any], int], str]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    occurrences: dict[str, int] = {}
    for index, raw in enumerate(items):
        item = raw if isinstance(raw, dict) else {"value": raw}
        base = safe_key(key_of(item, index))
        occurrences[base] = occurrences.get(base, 0) + 1
        key = base if occurrences[base] == 1 else f"{base}_{occurrences[base]}"
        output[key] = raw
    return output


def build_snapshot_patch(
    envelope: dict[str, Any],
    state: dict[str, Any] | None = None,
    *,
    now_ms: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if envelope.get("schema") != "dominium.toa.cloud-snapshot.v1":
        raise ValueError("Schema de snapshot invalido")
    feed = envelope.get("feed")
    if not isinstance(feed, dict):
        raise ValueError("Snapshot sem o campo feed")
    orders_raw = feed.get("orders")
    timeline_raw = feed.get("timelineActivities")
    if not isinstance(orders_raw, list) or not isinstance(timeline_raw, list):
        raise ValueError("Snapshot TOA sem as colecoes esperadas")
    orders = _keyed(orders_raw, lambda item, index: _stable_key([
        item.get("activity_id") or item.get("activityId"),
        item.get("os_number") or item.get("num_os") or item.get("os"),
        item.get("contract"),
    ], f"order_{index}"))
    timeline = _keyed(timeline_raw, lambda item, index: _stable_key([
        item.get("activity_id") or item.get("activityId"),
        item.get("type") or item.get("activity_type") or item.get("service"),
        item.get("started_at") or item.get("start_time") or item.get("route_start"),
    ], f"timeline_{index}"))

    current_state = dict(state or {})
    previous_orders = dict(current_state.get("orderHashes") or {})
    previous_timeline = dict(current_state.get("timelineHashes") or {})
    now = int(now_ms if now_ms is not None else time.time() * 1000)
    last_full_at = int(current_state.get("lastFullAt") or 0)
    force_full = not last_full_at or now - last_full_at >= 30 * 60 * 1000
    order_hashes = {key: _fnv1a(value) for key, value in orders.items()}
    timeline_hashes = {key: _fnv1a(value) for key, value in timeline.items()}

    updates: dict[str, Any] = {}
    base = "dominium/toa/current"
    updates[f"{base}/schema"] = envelope["schema"]
    updates[f"{base}/sourceKey"] = str(envelope.get("sourceKey") or "all")
    updates[f"{base}/publishedAt"] = envelope.get("publishedAt") or ""
    updates[f"{base}/receivedAt"] = envelope.get("publishedAt") or ""
    updates[f"{base}/trigger"] = str(envelope.get("trigger") or "")[:120]
    for key, value in feed.items():
        if key not in {"orders", "timelineActivities"}:
            updates[f"{base}/feed/{safe_key(key)}"] = value
    for key, value in orders.items():
        if force_full or previous_orders.get(key) != order_hashes[key]:
            updates[f"{base}/feed/orders/{key}"] = value
    for key in previous_orders:
        if key not in orders:
            updates[f"{base}/feed/orders/{key}"] = None
    for key, value in timeline.items():
        if force_full or previous_timeline.get(key) != timeline_hashes[key]:
            updates[f"{base}/feed/timelineActivities/{key}"] = value
    for key in previous_timeline:
        if key not in timeline:
            updates[f"{base}/feed/timelineActivities/{key}"] = None

    next_state = {
        "orderHashes": order_hashes,
        "timelineHashes": timeline_hashes,
        "lastFullAt": now if force_full else last_full_at,
    }
    return {
        "schema": "dominium.toa.firebase-patch.v1",
        "updates": updates,
        "summary": {
            "orders": len(orders_raw),
            "timelineActivities": len(timeline_raw),
            "changedPaths": len(updates),
            "forceFull": force_full,
        },
    }, next_state


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _location_metadata(
    updates: dict[str, Any],
    base: str,
    technician: dict[str, Any],
    resource: dict[str, Any],
    published_at: str,
) -> None:
    updates[f"{base}/technician_id"] = str(technician.get("id") or "")
    updates[f"{base}/technician_login"] = str(technician.get("login") or "")
    updates[f"{base}/technician_name"] = str(
        technician.get("name") or technician.get("login") or technician.get("id") or ""
    )
    updates[f"{base}/bucket"] = str(resource.get("bucket") or "")
    updates[f"{base}/profile"] = str(resource.get("profile") or "")
    updates[f"{base}/updated_at"] = published_at


def build_location_patch(envelope: dict[str, Any]) -> dict[str, Any]:
    if envelope.get("schema") not in {
        "dominium.toa.technician-locations.v1",
        "dominium.toa.technician-location-batch.v2",
    }:
        raise ValueError("Schema GPS invalido")
    resources = envelope.get("resources")
    if not isinstance(resources, list):
        raise ValueError("Lote sem resources")
    published_at = str(envelope.get("publishedAt") or envelope.get("captured_at") or "")
    updates: dict[str, Any] = {}
    accepted = planned = stops = snapshots = ignored = 0

    for raw_resource in resources:
        if not isinstance(raw_resource, dict):
            ignored += 1
            continue
        resource = raw_resource
        technician = resource.get("technician") if isinstance(resource.get("technician"), dict) else {}
        technician_key = safe_key(technician.get("login") or technician.get("id"), max_length=180)
        if technician_key == "sem-id":
            ignored += 1
            continue
        gps_real = resource.get("gps_real") if isinstance(resource.get("gps_real"), list) else resource.get("points") or []
        service_stops = resource.get("service_stops") if isinstance(resource.get("service_stops"), list) else resource.get("visits") or []
        planned_route = resource.get("planned_route") if isinstance(resource.get("planned_route"), list) else []
        snapshot_date = str(resource.get("visit_snapshot_date") or "")[:10]
        valid_snapshot = bool(_DATE_RE.fullmatch(snapshot_date))
        replace_planned = bool(resource.get("replace_planned_route") or resource.get("replace_visits")) and valid_snapshot
        replace_stops = bool(resource.get("replace_service_stops") or resource.get("replace_visits")) and valid_snapshot
        snapshot_planned: dict[str, Any] = {}
        snapshot_stops: dict[str, Any] = {}
        for point in gps_real:
            if not isinstance(point, dict):
                ignored += 1
                continue
            observed_at = str(point.get("observed_at") or "")
            day = observed_at[:10]
            latitude = _number(point.get("latitude"))
            longitude = _number(point.get("longitude"))
            if not _DATE_RE.fullmatch(day) or latitude is None or longitude is None:
                ignored += 1
                continue
            base = f"dominium/toa/history/technicianLocations/{day}/technicians/{technician_key}"
            _location_metadata(updates, base, technician, resource, published_at)
            updates[f"{base}/last_at"] = observed_at
            point_key = safe_key(f"{observed_at}_{_fnv1a([latitude, longitude])}", max_length=180)
            updates[f"{base}/gpsReal/{point_key}"] = {
                "observed_at": observed_at,
                "latitude": latitude,
                "longitude": longitude,
                "accuracy_m": _number(point.get("accuracy_m")),
                "speed_kmh": _number(point.get("speed_kmh")),
                "heading": _number(point.get("heading")),
                "altitude_m": _number(point.get("altitude_m")),
                "activity_id": str(point.get("activity_id") or ""),
            }
            accepted += 1
        for route_point in planned_route:
            if not isinstance(route_point, dict):
                ignored += 1
                continue
            latitude = _number(route_point.get("latitude"))
            longitude = _number(route_point.get("longitude"))
            day = str(route_point.get("date") or route_point.get("scheduled_at") or snapshot_date)[:10]
            if not _DATE_RE.fullmatch(day) or latitude is None or longitude is None:
                ignored += 1
                continue
            base = f"dominium/toa/history/technicianLocations/{day}/technicians/{technician_key}"
            _location_metadata(updates, base, technician, resource, published_at)
            route_key = safe_key(
                f"{route_point.get('activity_id') or route_point.get('marker_label') or 'rota'}_{latitude:.6f}_{longitude:.6f}",
                max_length=180,
            )
            value = {
                "scheduled_at": str(route_point.get("scheduled_at") or ""),
                "latitude": latitude,
                "longitude": longitude,
                "marker_label": str(route_point.get("marker_label") or ""),
                "activity_id": str(route_point.get("activity_id") or ""),
            }
            if replace_planned and day == snapshot_date:
                snapshot_planned[route_key] = value
            else:
                updates[f"{base}/plannedRoute/{route_key}"] = value
            planned += 1
        for stop in service_stops:
            if not isinstance(stop, dict):
                ignored += 1
                continue
            latitude = _number(stop.get("latitude"))
            longitude = _number(stop.get("longitude"))
            day = str(stop.get("date") or stop.get("scheduled_at") or snapshot_date)[:10]
            if not _DATE_RE.fullmatch(day) or latitude is None or longitude is None:
                ignored += 1
                continue
            base = f"dominium/toa/history/technicianLocations/{day}/technicians/{technician_key}"
            _location_metadata(updates, base, technician, resource, published_at)
            stop_key = safe_key(
                f"{stop.get('activity_id') or 'atividade'}_{latitude:.6f}_{longitude:.6f}",
                max_length=180,
            )
            value = {
                "date": day,
                "scheduled_at": str(stop.get("scheduled_at") or ""),
                "latitude": latitude,
                "longitude": longitude,
                "marker_label": str(stop.get("marker_label") or ""),
                "activity_id": str(stop.get("activity_id") or ""),
                "os_number": str(stop.get("os_number") or ""),
                "contract": str(stop.get("contract") or ""),
                "service": str(stop.get("service") or ""),
                "status": str(stop.get("status") or ""),
                "service_window": str(stop.get("service_window") or ""),
            }
            if replace_stops and day == snapshot_date:
                snapshot_stops[stop_key] = value
            else:
                updates[f"{base}/serviceStops/{stop_key}"] = value
            stops += 1
        if replace_planned:
            base = f"dominium/toa/history/technicianLocations/{snapshot_date}/technicians/{technician_key}"
            _location_metadata(updates, base, technician, resource, published_at)
            updates[f"{base}/plannedRoute"] = snapshot_planned or None
            snapshots += 1
        if replace_stops:
            base = f"dominium/toa/history/technicianLocations/{snapshot_date}/technicians/{technician_key}"
            _location_metadata(updates, base, technician, resource, published_at)
            updates[f"{base}/serviceStops"] = snapshot_stops or None
            snapshots += 1

    if not accepted and not planned and not stops and not snapshots:
        raise ValueError("Nenhum dado tecnico valido no lote")
    return {
        "schema": "dominium.toa.firebase-patch.v1",
        "updates": updates,
        "summary": {
            "accepted": accepted,
            "planned": planned,
            "stops": stops,
            "snapshots": snapshots,
            "ignored": ignored,
            "paths": len(updates),
        },
    }
