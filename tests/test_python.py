from __future__ import annotations

import http.client
import datetime as dt
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

import app
from toa_datalake_store import TOADatalakeStore
from backend.toa import toa_discovery_browser


class LocalServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.dist = Path(self.temporary_directory.name)
        (self.dist / "index.html").write_text("<h1>DOMINIUM TOA</h1>", encoding="utf-8")
        (self.dist / "asset.txt").write_text("asset-ok", encoding="utf-8")
        self.original_dist = app.DIST
        self.original_store = app.STORE
        app.DIST = self.dist
        app.STORE = TOADatalakeStore(self.dist / "local-api.sqlite3")
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        app.DIST = self.original_dist
        app.STORE = self.original_store
        self.temporary_directory.cleanup()

    def request(
        self, path: str, *, method: str = "GET", payload: dict | None = None,
    ) -> tuple[int, str, str]:
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        body = response.read().decode("utf-8")
        content_type = response.getheader("Content-Type", "")
        connection.close()
        return response.status, content_type, body

    def test_serves_static_asset_and_spa_fallback(self) -> None:
        self.assertEqual(self.request("/asset.txt"), (200, "text/plain; charset=utf-8", "asset-ok"))
        status, content_type, body = self.request("/rota/inexistente")
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "text/html; charset=utf-8")
        self.assertIn("DOMINIUM TOA", body)

    def test_path_traversal_does_not_escape_dist(self) -> None:
        status, _, body = self.request("/%2e%2e/package.json")
        self.assertEqual(status, 200)
        self.assertIn("DOMINIUM TOA", body)
        self.assertNotIn('"scripts"', body)

    def test_local_collector_does_not_need_cloud_token(self) -> None:
        previous = os.environ.get("DOMINIUM_INGEST_TOKEN")
        os.environ["DOMINIUM_INGEST_TOKEN"] = "token-usado-somente-na-nuvem"
        try:
            status, _, body = self.request(
                "/api/v1/collector/heartbeat", method="POST", payload={
                    "collector": "test-local", "state": "online",
                    "source": "unit-test", "observed_at": dt.datetime.now().astimezone().isoformat(),
                },
            )
        finally:
            if previous is None:
                os.environ.pop("DOMINIUM_INGEST_TOKEN", None)
            else:
                os.environ["DOMINIUM_INGEST_TOKEN"] = previous
        self.assertEqual(status, 200, body)
        self.assertTrue(json.loads(body)["ok"])

    def test_location_ingest_and_track_endpoints(self) -> None:
        points = [
            {"observed_at": "2026-08-21T08:00:00-03:00", "latitude": -3.73746,
             "longitude": -38.54362, "accuracy_m": 12, "speed_kmh": 20},
            {"observed_at": "2026-08-21T08:05:00-03:00", "latitude": -3.73246,
             "longitude": -38.54362, "accuracy_m": 10, "speed_kmh": 18},
        ]
        visits = [{
            "date": "2026-08-21", "scheduled_at": "2026-08-21T08:00:00-03:00",
            "latitude": -3.73740, "longitude": -38.54360, "marker_label": "A",
            "activity_id": "196900001", "os_number": "2650000001",
            "contract": "4242424", "service": "INSTALACAO", "status": "complete",
        }]
        status, _, body = self.request(
            "/api/v1/ingest/technician-locations", method="POST", payload={
                "source": "unit-test", "technician": {
                    "id": "101", "login": "Z641921", "name": "TECNICO TESTE",
                }, "bucket": "FTZ-DMV_01", "points": points, "visits": visits,
            },
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["inserted"], 2)
        self.assertEqual(json.loads(body)["visits_inserted"], 1)

        status, _, body = self.request(
            "/api/v1/technician-monitor/summary?date=2026-08-21",
        )
        summary = json.loads(body)
        self.assertEqual(status, 200, body)
        self.assertEqual(summary["technician_count"], 1)
        self.assertGreater(summary["items"][0]["distance_km"], 0.5)

        status, _, body = self.request(
            "/api/v1/technician-monitor/track/Z641921?date=2026-08-21",
        )
        track = json.loads(body)
        self.assertEqual(status, 200, body)
        self.assertEqual(track["point_count"], 2)
        self.assertEqual(track["visit_count"], 1)
        self.assertEqual(track["visits"][0]["marker_label"], "A")
        self.assertEqual(track["visits"][0]["contract"], "4242424")
        self.assertEqual(track["technician"]["name"], "TECNICO TESTE")

        status, _, body = self.request(
            "/api/v1/technician-monitor/close-day", method="POST", payload={
                "date": "2026-08-21", "source": "unit-test",
            },
        )
        closure = json.loads(body)
        self.assertEqual(status, 200, body)
        self.assertTrue(closure["ok"])
        self.assertEqual(closure["technician_count"], 1)
        self.assertGreater(closure["distance_km"], 0.5)


class DiscoveryConfigurationTests(unittest.TestCase):
    def test_extension_path_points_to_packaged_extension(self) -> None:
        manifest = toa_discovery_browser.EXTENSION_PATH / "manifest.json"
        self.assertTrue(manifest.is_file(), manifest)


class DatalakeLiveMergeTests(unittest.TestCase):
    def test_oracle_year_3000_sentinel_is_never_a_tec1_alert(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = TOADatalakeStore(Path(directory) / "unscheduled.sqlite3")
            today = dt.date.today().isoformat()
            store.ingest({"source": "toa-live-all-buckets", "activities": [{
                "activity_id": "187458590", "contract": "1077489", "bucket": "MRO-DMV",
                "description": "Visita Tecnica", "status": "pending", "scheduled_date": today,
                "service_window": "00:00 - 00:01", "start_time": "3000-01-01 00:00:00",
                "end_time": "3000-01-01 00:52:00", "technician_name": "SMALEY",
            }]})
            activity = store.activities_api(date=today)["items"][0]
            self.assertFalse(activity["is_scheduled"])
            self.assertFalse(activity["window_verified"])
            self.assertFalse(store.tec1_alerts(date=today)["items"])

    def test_official_detail_is_terminal_and_reallocation_inherits_orders(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = TOADatalakeStore(Path(directory) / "terminal.sqlite3")
            store.ingest({
                "source": "toa-live-all-buckets", "snapshot_complete": True,
                "active_activity_ids": ["197000001", "196000001"],
                "activities": [
                    {"activity_id": "197000001", "contract": "4249000",
                     "activity_type": "4", "description": "Instalacao",
                     "status": "suspended", "scheduled_date": "2026-08-13",
                     "service_window": "08:00 - 09:00", "start_min": 487,
                     "technician_name": "TECNICO ANTIGO", "technician_login": "ZOLD",
                     "orders": [{"os_number": "2650000001"}, {"os_number": "2650000002"}]},
                    {"activity_id": "196000001", "contract": "4249000",
                     "activity_type": "4", "description": "Instalacao",
                     "status": "complete", "scheduled_date": "2026-08-13", "start_min": 588,
                     "technician_name": "TECNICO ATUAL", "technician_login": "ZNEW"},
                ],
            })
            # O detalhe e a fonte autoritativa. Uma fotografia resumida atrasada
            # nao pode reabrir a atividade concluida.
            store.ingest({"source": "toa-live-detail-readonly", "details": [{
                "activity_id": "196000001", "contract": "4249000", "status": "complete",
                "start_time": "10:37", "end_time": "11:53",
            }]})
            store.ingest({"source": "toa-live-all-buckets", "activities": [{
                "activity_id": "196000001", "status": "started", "scheduled_date": "2026-08-13",
            }]})

            rows = [row for row in store.feed()["orders"] if row["contract"] == "4249000"]
            self.assertEqual({row["os_number"] for row in rows}, {"2650000001", "2650000002"})
            self.assertTrue(all(row["activity_id"] == "196000001" for row in rows))
            self.assertTrue(all(row["status"] == "complete" for row in rows))
            self.assertTrue(all(row["technician_login"] == "ZNEW" for row in rows))
            self.assertFalse(store.tec1_alerts(date="2026-08-13")["items"])
            with store._connect() as db:
                current = db.execute(
                    "SELECT status,detail_state FROM activities WHERE activity_id='196000001'"
                ).fetchone()
            self.assertEqual(tuple(current), ("complete", "complete"))

    def test_api_v1_summary_collectors_events_and_filters(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = TOADatalakeStore(Path(directory) / "api.sqlite3")
            store.ingest({"source": "toa-live-all-buckets", "collector": "toa-time-get",
                          "snapshot_complete": True, "active_activity_ids": ["196000001"],
                          "activities": [{
                              "activity_id": "196000001", "contract": "4250001", "bucket": "NTL-DMV",
                              "description": "Instalacao", "status": "pending", "scheduled_date": "2026-08-13",
                              "service_window": "08:00 - 22:00", "technician_name": "TECNICO UM",
                              "technician_login": "Z000001",
                          }]})
            store.ingest({"source": "toa-live-all-buckets", "collector": "toa-time-get",
                          "snapshot_complete": True, "active_activity_ids": ["196000001"],
                          "activities": [{"activity_id": "196000001", "status": "started",
                                          "scheduled_date": "2026-08-13"}]})
            summary = store.monitor_summary(date="2026-08-13")
            self.assertEqual(summary["counts"]["field"], 1)
            self.assertTrue(store.collectors())
            self.assertEqual(store.buckets(date="2026-08-13")["items"][0]["bucket"], "NTL-DMV")
            self.assertEqual(store.technicians(date="2026-08-13")["items"][0]["login"], "Z000001")
            with store._connect() as db:
                event = db.execute("SELECT event_type,current_value FROM activity_events").fetchone()
            self.assertEqual(tuple(event), ("status_changed", "started"))

    def test_live_status_preserves_csv_window_and_exposes_route_schedule(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = TOADatalakeStore(Path(directory) / "live.sqlite3")
            store.ingest({"source": "csv", "activities": [{
                "activity_id": "196846949", "contract": "4250000",
                "description": "Instalacao", "status": "pending",
                "scheduled_date": "2026-08-13", "service_window": "08:00 - 11:00",
            }], "orders": [{"os_number": "2650000000", "activity_id": "196846949"}]})
            store.ingest({"source": "toa-live-all-buckets", "activities": [{
                "activity_id": "196846949", "status": "started", "start_min": 573,
                "duration_min": 101, "technician_login": "Z123456",
                "technician_name": "TECNICO TESTE", "scheduled_date": "2026-08-13",
            }]})
            feed = store.feed()
            self.assertTrue(feed["live"])
            self.assertEqual(feed["orders"][0]["service_window"], "08:00 - 11:00")
            self.assertEqual(feed["orders"][0]["activity_status"], "started")
            self.assertEqual(feed["orders"][0]["route_start"], "09:33")
            self.assertEqual(feed["orders"][0]["route_end"], "11:14")

    def test_history_separates_tabulation_and_confirmation(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = TOADatalakeStore(Path(directory) / "history.sqlite3")
            store.ingest_history({"activity_id": "196850397", "rows": [
                {"action_time": "13/08/26 13:27", "action_timestamp": "2026-08-13 16:27:36",
                 "user": {"name": "TECNICO (Z672212)"}, "action": [{"translation": "atualizado"}],
                 "changes": [{"translation": "Contrato", "value": "1415329"},
                             {"translation": "Cód de Baixa 1", "value": "301 - TIPO DE OS INCORRETA"},
                             {"translation": "Status da O.S 1", "value": "Não Executada"},
                             {"translation": "Endereço", "value": "NAO DEVE SER SALVO"}]},
                {"action_time": "13/08/26 13:33", "action_timestamp": "2026-08-13 16:33:23",
                 "user": {"name": "App UT1_DISPLAY_PROFILE"}, "action": [{"translation": "atualizado"}],
                 "changes": [{"translation": "Validação Baixa", "value": "Baixa realizada com sucesso."}]},
            ]})
            record = store.record("1415329")
            outcome = record["operational_outcome"]
            self.assertEqual(outcome["os_outcomes"][0]["close_code"], "301")
            self.assertEqual(outcome["os_outcomes"][0]["os_status"], "Não Executada")
            self.assertEqual(outcome["os_outcomes"][0]["tabulated_at"], "13/08/26 13:27")
            self.assertTrue(outcome["confirmations"][0]["success"])
            self.assertNotIn("NAO DEVE SER SALVO", json.dumps(record, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
