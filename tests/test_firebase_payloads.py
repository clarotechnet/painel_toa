import unittest

from firebase_payloads import build_location_patch, build_snapshot_patch


class FirebasePayloadTests(unittest.TestCase):
    def test_snapshot_patch_builds_current_tree(self):
        envelope = {
            "schema": "dominium.toa.cloud-snapshot.v1",
            "sourceKey": "all",
            "publishedAt": "2026-09-10T12:00:00-03:00",
            "feed": {
                "orders": [{"activity_id": "123", "os_number": "456", "contract": "789"}],
                "timelineActivities": [{"activity_id": "123", "type": "started", "started_at": "12:00"}],
                "stats": {"total": 1},
            },
        }
        patch, state = build_snapshot_patch(envelope, {}, now_ms=1_000)
        self.assertEqual(patch["schema"], "dominium.toa.firebase-patch.v1")
        self.assertEqual(patch["updates"]["dominium/toa/current/schema"], envelope["schema"])
        self.assertIn("dominium/toa/current/feed/orders/123_456_789", patch["updates"])
        self.assertIn("dominium/toa/current/feed/timelineActivities/123_started_12:00", patch["updates"])
        self.assertEqual(state["lastFullAt"], 1_000)
    def test_location_patch_builds_public_history_tree(self):
        envelope = {
            "schema": "dominium.toa.technician-location-batch.v2",
            "publishedAt": "2026-09-10T12:01:00-03:00",
            "resources": [{
                "technician": {"id": "29310", "login": "Z123", "name": "Tecnico Teste"},
                "bucket": "NTL-DMV",
                "gps_real": [{
                    "observed_at": "2026-09-10T12:00:30-03:00",
                    "latitude": -5.80,
                    "longitude": -35.20,
                    "accuracy_m": 12,
                }],
            }],
        }
        patch = build_location_patch(envelope)
        self.assertEqual(patch["summary"]["accepted"], 1)
        paths = patch["updates"]
        prefix = "dominium/toa/history/technicianLocations/2026-09-10/technicians/Z123"
        self.assertEqual(paths[f"{prefix}/technician_name"], "Tecnico Teste")
        self.assertTrue(any(key.startswith(f"{prefix}/gpsReal/") for key in paths))


if __name__ == "__main__":
    unittest.main()
