import unittest

from backend.toa.toa_capture import normalize_entry


class TOACaptureInventoryRuleTests(unittest.TestCase):
    def test_only_install_and_deinstall_are_operational(self):
        entry = {
            "aid": "123456789",
            "contract": "4252617",
            "os": {
                "activity": {
                    "aid": "123456789",
                    "contract": "4252617",
                    "work_type": "INSTALACAO",
                    "status": "complete",
                    "technician_id": "328898",
                },
                "route": {"aid": "123456789"},
                "tasks": [
                    {"index": 1, "os_number": "2650000001", "status": "E", "close_code": "409"}
                ],
                "inventory": [
                    {"invid": "1", "activity_id": "123456789", "kind": "equipment", "pool": "install", "serial": "INST1"},
                    {"invid": "2", "activity_id": "123456789", "kind": "equipment", "pool": "deinstall", "serial": "REM1"},
                    {"invid": "3", "activity_id": "123456789", "kind": "equipment", "pool": "customer", "serial": "CLI1"},
                    {"invid": "4", "activity_id": "123456789", "kind": "equipment", "pool": "resource", "serial": "REC1"},
                    {
                        "invid": "5",
                        "activity_id": "123456789",
                        "kind": "material",
                        "pool": "install",
                        "material_code": "MAT-IN",
                        "quantity": "2",
                    },
                    {"invid": "6", "activity_id": "123456789", "kind": "material", "pool": "deinstall", "material_code": "MAT-OUT", "quantity": "1"},
                    {
                        "invid": "7",
                        "activity_id": "123456789",
                        "kind": "material",
                        "pool": "customer",
                        "material_code": "MAT-CLI",
                        "quantity": "9",
                    },
                ],
                "responsibility": {
                    "assigned_technician": {"id": "328898"},
                    "route_provider": {"id": "328898"},
                    "inventory_providers": [],
                    "form_submitters": [],
                },
            },
            "classification": {"category": "produtiva", "codes": ["409"]},
            "automation": {"decision": "candidate_after_validation", "reasons": []},
        }

        result = normalize_entry(entry)
        self.assertEqual([item["serial"] for item in result.installed_equipment], ["INST1"])
        self.assertEqual([item["serial"] for item in result.removed_equipment], ["REM1"])
        self.assertEqual([item["serial"] for item in result.customer_equipment], ["CLI1"])
        self.assertEqual([item["material_code"] for item in result.materials], ["MAT-IN"])
        self.assertEqual([item["material_code"] for item in result.removed_materials], ["MAT-OUT"])
        self.assertNotIn("REC1", str(result.installed_equipment + result.removed_equipment))
        self.assertNotIn("MAT-CLI", str(result.materials))
        self.assertIn("inventory_pool_ignored:3:resource", result.validation_warnings)
        self.assertIn("inventory_pool_ignored:6:customer", result.validation_warnings)
        self.assertEqual(result.decision, "candidate_after_validation")


if __name__ == "__main__":
    unittest.main()
