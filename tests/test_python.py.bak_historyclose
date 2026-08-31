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
from cloud_sync import CloudPublisher
from toa_datalake_store import TOADatalakeStore
from backend.toa import toa_discovery_browser
from backend.toa.edge_voice import EdgeVoiceService, EdgeVoiceError, EDGE_VOICE


class LocalServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.dist = Path(self.temporary_directory.name)
        (self.dist / "index.html").write_text("<h1>DOMINIUM TOA</h1>", encoding="utf-8")
        (self.dist / "asset.txt").write_text("asset-ok", encoding="utf-8")
        self.original_dist = app.DIST
        self.original_store = app.STORE
        self.original_renderer = EDGE_VOICE._renderer
        EDGE_VOICE._renderer = lambda text, voice, rate: b"mock-audio-content"
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
        EDGE_VOICE._renderer = self.original_renderer
        self.temporary_directory.cleanup()

    def request(
        self, path: str, *, method: str = "GET", payload: dict | None = None,
    ) -> tuple[int, str, str | bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw_body = response.read()
        content_type = response.getheader("Content-Type", "")
        if "audio/" in content_type or "octet-stream" in content_type:
            parsed_body = raw_body
        else:
            parsed_body = raw_body.decode("utf-8")
        connection.close()
        return response.status, content_type, parsed_body

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
                "schema": "dominium.toa.technician-location-batch.v2",
                "source": "unit-test", "technician": {
                    "id": "101", "login": "Z641921", "name": "TECNICO TESTE",
                }, "bucket": "FTZ-DMV_01", "gps_real": points,
                "planned_route": [{
                    "scheduled_at": visits[0]["scheduled_at"],
                    "latitude": visits[0]["latitude"], "longitude": visits[0]["longitude"],
                    "marker_label": "A", "activity_id": "196900001",
                }],
                "service_stops": visits,
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
        self.assertEqual(track["planned_route"], [])
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

    def test_location_monitor_merges_aliases_and_rejects_foreign_visits(self) -> None:
        app.STORE.ingest({"source": "unit-test", "activities": [{
            "activity_id": "196900101", "scheduled_date": "2026-08-21",
            "technician_id": "101", "technician_login": "Z641921",
            "technician_name": "TECNICO CERTO", "bucket": "FTZ-DMV_01",
            "route_position": "1", "contract": "111", "description": "INSTALACAO",
        }, {
            "activity_id": "196900202", "scheduled_date": "2026-08-21",
            "technician_id": "202", "technician_login": "Z999999",
            "technician_name": "OUTRO TECNICO", "bucket": "REC-DMV",
            "route_position": "2", "contract": "222", "description": "REPARO",
        }]})
        payload = {
            "source": "unit-test", "date": "2026-08-21", "resources": [{
                "technician": {"id": "101", "login": "Z641921", "name": "TECNICO CERTO"},
                "bucket": "FTZ-DMV_01",
                "points": [
                    {"observed_at": "2026-08-21T08:00:00-03:00", "latitude": -3.73746, "longitude": -38.54362},
                    {"observed_at": "2026-08-21T08:05:00-03:00", "latitude": -3.73246, "longitude": -38.54362},
                ],
                "visits": [
                    {"date": "2026-08-21", "latitude": -3.73740, "longitude": -38.54360,
                     "marker_label": "A", "activity_id": "196900101"},
                    {"date": "2026-08-21", "latitude": -23.55052, "longitude": -46.63331,
                     "marker_label": "B", "activity_id": "196900202"},
                ],
            }, {
                # Mesmo tecnico visto somente pelo PID: deve ser unido ao login externo.
                "technician": {"id": "101", "name": "TECNICO CERTO"},
                "bucket": "FTZ-DMV_01",
                "visits": [{"date": "2026-08-21", "latitude": -3.73740,
                            "longitude": -38.54360, "marker_label": "A",
                            "activity_id": "196900101", "contract": "111"}],
            }],
        }
        status, _, body = self.request(
            "/api/v1/ingest/technician-locations", method="POST", payload=payload,
        )
        self.assertEqual(status, 200, body)

        summary = json.loads(self.request(
            "/api/v1/technician-monitor/summary?date=2026-08-21",
        )[2])
        self.assertEqual(summary["technician_count"], 1)
        self.assertEqual(summary["items"][0]["technician_login"], "Z641921")
        self.assertEqual(summary["items"][0]["visit_count"], 1)

        track_by_login = json.loads(self.request(
            "/api/v1/technician-monitor/track/Z641921?date=2026-08-21",
        )[2])
        track_by_pid = json.loads(self.request(
            "/api/v1/technician-monitor/track/101?date=2026-08-21",
        )[2])
        self.assertEqual(track_by_login["point_count"], 2)
        self.assertEqual(track_by_login["visit_count"], 1)
        self.assertEqual(track_by_login["visits"][0]["activity_id"], "196900101")
        self.assertEqual(track_by_login["visits"][0]["contract"], "111")
        self.assertEqual(track_by_pid["technician"]["login"], "Z641921")
        self.assertEqual(track_by_pid["point_count"], 2)

    def test_location_snapshot_replaces_only_visits_for_pid_and_date(self) -> None:
        app.STORE.ingest({"source": "unit-test", "activities": [{
            "activity_id": "196901001", "scheduled_date": "2026-08-21",
            "technician_id": "301", "technician_login": "Z301",
            "technician_name": "TECNICO 301", "bucket": "NTL-DMV",
        }, {
            "activity_id": "196902001", "scheduled_date": "2026-08-21",
            "technician_id": "302", "technician_login": "Z302",
            "technician_name": "TECNICO 302", "bucket": "NTL-DMV",
        }]})
        first = {
            "source": "unit-test", "date": "2026-08-21", "resources": [{
                "technician": {"id": "301", "login": "Z301", "name": "TECNICO 301"},
                "bucket": "NTL-DMV", "replace_visits": True,
                "visit_snapshot_date": "2026-08-21",
                "points": [{
                    "observed_at": "2026-08-21T08:00:00-03:00",
                    "latitude": -5.80, "longitude": -35.20, "activity_id": "196901001",
                }],
                "visits": [
                    {"date": "2026-08-21", "latitude": -5.81, "longitude": -35.21,
                     "activity_id": "196901001", "marker_label": "A"},
                    {"date": "2026-08-21", "latitude": -5.82, "longitude": -35.22,
                     "activity_id": "196901002", "marker_label": "B"},
                ],
            }, {
                "technician": {"id": "302", "login": "Z302", "name": "TECNICO 302"},
                "bucket": "NTL-DMV", "visits": [{
                    "date": "2026-08-21", "latitude": -5.90, "longitude": -35.30,
                    "activity_id": "196902001", "marker_label": "A",
                }],
            }],
        }
        self.assertTrue(app.STORE.ingest_locations(first)["ok"])
        replacement = {
            "source": "unit-test", "date": "2026-08-21", "resources": [{
                # A fotografia nova chega somente pelo PID e deve substituir as
                # visitas do mesmo recurso, sem apagar GPS nem outro técnico.
                "technician": {"id": "301", "name": "TECNICO 301"},
                "bucket": "NTL-DMV", "replace_visits": True,
                "visit_snapshot_date": "2026-08-21", "visits": [],
            }],
        }
        result = app.STORE.ingest_locations(replacement)
        self.assertEqual(result["visits_deleted"], 2)
        track_301 = app.STORE.technician_location_track("Z301", date="2026-08-21")
        track_302 = app.STORE.technician_location_track("Z302", date="2026-08-21")
        self.assertEqual(track_301["point_count"], 1)
        self.assertEqual(track_301["points"][0]["activity_id"], "196901001")
        self.assertEqual(track_301["visit_count"], 0)
        self.assertEqual(track_302["visit_count"], 1)

    def test_location_alias_points_are_sorted_and_deduplicated(self) -> None:
        app.STORE.ingest({"source": "unit-test", "activities": [{
            "activity_id": "196903001", "scheduled_date": "2026-08-21",
            "technician_id": "401", "technician_login": "Z401",
            "technician_name": "TECNICO 401", "bucket": "FTZ-DMV_01",
        }]})
        app.STORE.ingest_locations({"source": "unit-test", "resources": [{
            "technician": {"id": "401"}, "bucket": "FTZ-DMV_01", "points": [{
                "observed_at": "2026-08-21T08:05:00-03:00",
                "latitude": -3.73, "longitude": -38.54,
            }],
        }, {
            "technician": {"login": "Z401"}, "bucket": "FTZ-DMV_01", "points": [{
                "observed_at": "2026-08-21T08:00:00-03:00",
                "latitude": -3.74, "longitude": -38.55,
            }, {
                "observed_at": "2026-08-21T08:05:00-03:00",
                "latitude": -3.73, "longitude": -38.54, "activity_id": "196903001",
            }],
        }]})
        track = app.STORE.technician_location_track("401", date="2026-08-21")
        self.assertEqual(track["point_count"], 2)
        self.assertEqual(track["points"][0]["observed_at"], "2026-08-21T08:00:00-03:00")
        self.assertEqual(track["points"][1]["activity_id"], "196903001")

    def test_cloud_location_merge_preserves_latest_visit_snapshot(self) -> None:
        previous = [{
            "technician": {"id": "501", "login": "Z501"},
            "points": [{"observed_at": "2026-08-21T08:00:00-03:00", "latitude": -5.8, "longitude": -35.2}],
            "visits": [{"activity_id": "old", "latitude": -5.8, "longitude": -35.2}],
        }]
        current = [{
            "technician": {"id": "501", "login": "Z501"},
            "replace_visits": True, "visit_snapshot_date": "2026-08-21",
            "points": [{"observed_at": "2026-08-21T08:05:00-03:00", "latitude": -5.81, "longitude": -35.21}],
            "visits": [{"activity_id": "new", "latitude": -5.81, "longitude": -35.21}],
        }]
        merged = CloudPublisher._merge_location_resources(previous, current)
        self.assertEqual(len(merged), 1)
        self.assertTrue(merged[0]["replace_planned_route"])
        self.assertTrue(merged[0]["replace_service_stops"])
        self.assertEqual(merged[0]["visit_snapshot_date"], "2026-08-21")
        self.assertEqual([row["activity_id"] for row in merged[0]["service_stops"]], ["new"])
        self.assertEqual(merged[0]["planned_route"], [])
    def test_voice_status_and_models_endpoints(self) -> None:
        status, content_type, body = self.request("/api/v1/voice/status")
        self.assertEqual(status, 200, body)
        self.assertIn("application/json", content_type)
        payload = json.loads(body)
        self.assertEqual(payload["default_voice"], "pt-BR-FranciscaNeural")
        self.assertIn("pt-BR-FranciscaNeural", payload["voices"])
        self.assertIn("pt-BR-AntonioNeural", payload["voices"])

        status, content_type, body = self.request("/v1/models")
        self.assertEqual(status, 200, body)
        models = json.loads(body)
        self.assertEqual(models["data"][0]["id"], "tts-1")

    def test_voice_synthesis_post_and_get_endpoints(self) -> None:
        status, content_type, body = self.request(
            "/api/v1/voice/speak", method="POST", payload={
                "text": "Alerta de teste.",
                "voice": "pt-BR-FranciscaNeural",
                "rate": "+0%",
            },
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(content_type, "audio/mpeg")
        self.assertGreater(len(body), 0)

        # GET speak
        status, content_type, body = self.request(
            "/api/v1/voice/speak?text=Alerta+rapido&voice=antonio&rate=%2B10%25",
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(content_type, "audio/mpeg")

    def test_openai_compatible_speech_endpoint(self) -> None:
        status, content_type, body = self.request(
            "/v1/audio/speech", method="POST", payload={
                "model": "tts-1",
                "input": "Alerta openai format.",
                "voice": "alloy",
                "speed": 1.1,
            },
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(content_type, "audio/mpeg")


class EdgeVoiceTests(unittest.TestCase):
    def test_synthesizes_and_caches_audio(self) -> None:
        rendered: list[tuple[str, str, str]] = []

        def mock_renderer(text: str, voice: str, rate: str) -> bytes:
            rendered.append((text, voice, rate))
            return b"fake-audio-bytes"

        service = EdgeVoiceService(renderer=mock_renderer, cache_size=10)
        audio1 = service.synthesize("Alerta TEC1", voice="pt-BR-FranciscaNeural", rate="+10%")
        self.assertEqual(audio1, b"fake-audio-bytes")
        self.assertEqual(len(rendered), 1)

        # Cache hit: nao deve chamar o renderer novamente
        audio2 = service.synthesize("Alerta TEC1", voice="pt-BR-FranciscaNeural", rate="+10%")
        self.assertEqual(audio2, b"fake-audio-bytes")
        self.assertEqual(len(rendered), 1)

    def test_aliases_and_speed_normalization(self) -> None:
        calls: list[tuple[str, str, str]] = []

        def mock_renderer(text: str, voice: str, rate: str) -> bytes:
            calls.append((text, voice, rate))
            return b"audio"

        service = EdgeVoiceService(renderer=mock_renderer)
        service.synthesize("Teste 1", voice="alloy", rate=1.0)
        self.assertEqual(calls[-1][1], "pt-BR-FranciscaNeural")
        self.assertEqual(calls[-1][2], "+0%")

        service.synthesize("Teste 2", voice="echo", rate=1.15)
        self.assertEqual(calls[-1][1], "pt-BR-AntonioNeural")
        self.assertEqual(calls[-1][2], "+15%")

        service.synthesize("Teste 3", voice="thalita", rate="-5%")
        self.assertEqual(calls[-1][1], "pt-BR-ThalitaMultilingualNeural")
        self.assertEqual(calls[-1][2], "-5%")

    def test_rejects_empty_or_excessive_text(self) -> None:
        service = EdgeVoiceService()
        with self.assertRaises(ValueError):
            service.synthesize("   ")
        with self.assertRaises(ValueError):
            service.synthesize("A" * 1000)
        with self.assertRaises(ValueError):
            service.synthesize("OK", voice="voz_invalida_123")


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
