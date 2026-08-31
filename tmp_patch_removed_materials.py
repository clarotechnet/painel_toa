from pathlib import Path

root = Path(r'C:\Users\Usuario\Documents\sistematoa')
backend_path = root / 'backend' / 'toa' / 'toa_capture.py'
cloud_path = root / 'toa_cloud_bridge' / 'src' / 'core.js'
test_path = root / 'tests' / 'test_toa_capture_inventory_rule.py'
cloud_test_path = root / 'toa_cloud_bridge' / 'test' / 'core.test.mjs'


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing:{label}')
    return text.replace(old, new, 1)

backend = backend_path.read_text(encoding='utf-8')
backend = rep(
    backend,
    '    materials: list[dict[str, Any]]\n    assigned_technician: dict[str, Any]\n',
    '    materials: list[dict[str, Any]]\n    removed_materials: list[dict[str, Any]]\n    assigned_technician: dict[str, Any]\n',
    'dataclass removed materials',
)
backend = rep(
    backend,
    '    materials: list[dict[str, Any]] = []\n    pools: list[str] = []\n',
    '    materials: list[dict[str, Any]] = []\n    removed_materials: list[dict[str, Any]] = []\n    pools: list[str] = []\n',
    'removed material list',
)
backend = rep(
    backend,
    '            else:\n                warnings.append(f"deinstall_material_requires_review:{position}")\n',
    '            else:\n                removed_materials.append(item)\n',
    'deinstall material preserve',
)
backend = rep(
    backend,
    '        materials=materials,\n        assigned_technician=assigned,\n',
    '        materials=materials,\n        removed_materials=removed_materials,\n        assigned_technician=assigned,\n',
    'return removed materials',
)
backend = rep(
    backend,
    '    _print_inventory("Materiais/miscelaneas", order.materials)\n',
    '    _print_inventory("Materiais/miscelaneas instalados", order.materials)\n    _print_inventory("Materiais/miscelaneas retirados", order.removed_materials)\n',
    'print removed materials',
)
backend_path.write_text(backend, encoding='utf-8')
cloud = cloud_path.read_text(encoding='utf-8')
cloud = rep(
    cloud,
    '  const rawOpsMaterials = selectOperationalMaterials(source);\n  const operationalMaterials = sanitizeInventoryList(rawOpsMaterials);\n',
    '  const rawOpsMaterials = selectOperationalMaterials(source);\n  const operationalMaterials = sanitizeInventoryList(rawOpsMaterials);\n  const removedMaterials = sanitizeInventoryList(\n    source.removed_materials ?? source.removedMaterials,\n  ).filter((item) => item.pool.toLowerCase() === "deinstall");\n',
    'cloud removed materials',
)
cloud = rep(
    cloud,
    '      installedEquip.length + removedEquip.length + customerEquip.length + unknownEquip.length + operationalMaterials.length\n',
    '      installedEquip.length + removedEquip.length + customerEquip.length + unknownEquip.length + operationalMaterials.length + removedMaterials.length\n',
    'cloud inventory count',
)
cloud = rep(
    cloud,
    '    materials_count: Number(source.inventory_diagnostics?.materials_count ?? operationalMaterials.length),\n',
    '    materials_count: Number(source.inventory_diagnostics?.materials_count ?? operationalMaterials.length),\n    removed_materials_count: Number(source.inventory_diagnostics?.removed_materials_count ?? removedMaterials.length),\n',
    'cloud removed diagnostic',
)
cloud = rep(
    cloud,
    '      removed_equipment: removedEquip,\n      materials: operationalMaterials,\n',
    '      removed_equipment: removedEquip,\n      materials: operationalMaterials,\n      removed_materials: removedMaterials,\n',
    'cloud operational removed materials',
)
cloud = rep(
    cloud,
    '    materials: operationalMaterials,\n    captured_materials_for_audit: capturedAuditMaterials,\n',
    '    materials: operationalMaterials,\n    removed_materials: removedMaterials,\n    captured_materials_for_audit: capturedAuditMaterials,\n',
    'cloud top level removed materials',
)
cloud_path.write_text(cloud, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
test = rep(
    test,
    '                    {\n                        "invid": "6",\n                        "activity_id": "123456789",\n                        "kind": "material",\n                        "pool": "customer",\n',
    '                    {"invid": "6", "activity_id": "123456789", "kind": "material", "pool": "deinstall", "material_code": "MAT-OUT", "quantity": "1"},\n                    {\n                        "invid": "7",\n                        "activity_id": "123456789",\n                        "kind": "material",\n                        "pool": "customer",\n',
    'python removed material fixture',
)
test = rep(
    test,
    '        self.assertEqual([item["material_code"] for item in result.materials], ["MAT-IN"])\n',
    '        self.assertEqual([item["material_code"] for item in result.materials], ["MAT-IN"])\n        self.assertEqual([item["material_code"] for item in result.removed_materials], ["MAT-OUT"])\n',
    'python removed material assertion',
)
test = rep(
    test,
    '        self.assertIn("inventory_pool_ignored:5:customer", result.validation_warnings)\n',
    '        self.assertIn("inventory_pool_ignored:6:customer", result.validation_warnings)\n',
    'python customer position',
)
test_path.write_text(test, encoding='utf-8')

cloud_test = cloud_test_path.read_text(encoding='utf-8')
needle = '    unknownEquipment: [{ invid: "4", pool: "resource", serial: "REC1" }],\n'
cloud_test = rep(
    cloud_test,
    needle,
    needle + '    removedMaterials: [{ invid: "4B", pool: "deinstall", material_code: "MAT-OUT", used_quantity: "1" }],\n',
    'cloud removed material fixture',
)
cloud_test = rep(
    cloud_test,
    '  assert.deepEqual(result.operational_inventory.materials.map(x => x.material_code), ["MAT-IN"]);\n',
    '  assert.deepEqual(result.operational_inventory.materials.map(x => x.material_code), ["MAT-IN"]);\n  assert.deepEqual(result.operational_inventory.removed_materials.map(x => x.material_code), ["MAT-OUT"]);\n',
    'cloud removed material assertion',
)
cloud_test_path.write_text(cloud_test, encoding='utf-8')
print('removed-materials-patched')
