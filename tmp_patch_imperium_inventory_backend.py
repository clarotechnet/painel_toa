from pathlib import Path

root = Path(r'C:\Users\Usuario\Documents\sistematoa')
backend_path = root / 'backend' / 'toa' / 'toa_capture.py'
cloud_path = root / 'toa_cloud_bridge' / 'src' / 'core.js'
cloud_test_path = root / 'toa_cloud_bridge' / 'test' / 'core.test.mjs'


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing:{label}')
    return text.replace(old, new, 1)

backend = backend_path.read_text(encoding='utf-8')
start = backend.index('    raw_inventory = _dedupe_dicts(')
end = backend.index('\n    forms = _dedupe_dicts(', start)
old = backend[start:end]
new = '''    raw_inventory = _dedupe_dicts(
        os_data.get("inventory", []),
        _inventory_key,
        "inventory",
        errors,
        warnings,
    )
    inventory: list[dict[str, Any]] = []
    installed: list[dict[str, Any]] = []
    removed: list[dict[str, Any]] = []
    customer: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    pools: list[str] = []
'''
new += '''    for position, item in enumerate(raw_inventory):
        pool = _text(item.get("pool")).casefold()
        kind = _text(item.get("kind")).casefold()
        movement_pool = pool in {"install", "deinstall"}
        item_aid = _text(item.get("activity_id"))
        if pool and pool not in pools:
            pools.append(pool)

        if not item_aid:
            target = errors if movement_pool else warnings
            prefix = "inventory" if movement_pool else "ignored_inventory"
            target.append(f"{prefix}_activity_id_missing:{position}")
            continue
        if item_aid != activity_aid:
            target = errors if movement_pool else warnings
            prefix = "inventory" if movement_pool else "ignored_inventory"
            target.append(f"{prefix}_activity_id_conflict:{position}")
            continue

        if not movement_pool:
            if kind == "equipment" and pool == "customer":
                customer.append(item)
            warnings.append(f"inventory_pool_ignored:{position}:{pool or 'empty'}")
            continue

        inventory.append(item)
        if kind == "material":
            if pool == "install":
                materials.append(item)
                if item.get("quantity") in (None, ""):
                    warnings.append(f"material_quantity_missing:{position}")
            else:
                warnings.append(f"deinstall_material_requires_review:{position}")
'''
new += '''        elif kind == "equipment":
            if pool == "install":
                installed.append(item)
            elif pool == "deinstall":
                removed.append(item)
        else:
            warnings.append(f"inventory_kind_unmapped:{position}:{kind or 'empty'}")
'''
backend = backend[:start] + new + backend[end:]
backend_path.write_text(backend, encoding='utf-8')

cloud = cloud_path.read_text(encoding='utf-8')
old = '''export function selectOperationalMaterials(source) {
  const src = source && typeof source === "object" ? source : {};
  if (src.materials_applicable === false) {
    return [];
  }
  const ops = Array.isArray(src.materials) ? src.materials : [];
  if (ops.length > 0) {
    return ops;
  }
  const raw = Array.isArray(src.materialsRaw) ? src.materialsRaw : [];
  if (raw.length > 0) {
    return raw;
  }
  return [];
}
'''
new = '''export function selectOperationalMaterials(source) {
  const src = source && typeof source === "object" ? source : {};
  if (src.materials_applicable === false) return [];

  const explicitInstalled = Array.isArray(src.installed_materials)
    ? src.installed_materials
    : (Array.isArray(src.installedMaterials) ? src.installedMaterials : []);
  if (explicitInstalled.length > 0) {
    return explicitInstalled.filter((item) => {
      const pool = text(item?.pool, 30).toLowerCase();
      return !pool || pool === "install";
    });
  }

  const operational = Array.isArray(src.materials) ? src.materials : [];
  const filteredOperational = operational.filter(
    (item) => text(item?.pool, 30).toLowerCase() === "install",
  );
  if (filteredOperational.length > 0) return filteredOperational;

  const raw = Array.isArray(src.materialsRaw) ? src.materialsRaw : [];
  return raw.filter((item) => text(item?.pool, 30).toLowerCase() === "install");
}
'''
cloud = replace_once(cloud, old, new, 'cloud material pool filter')
old = '''    equipment: {
      installed: installedEquip,
      removed: removedEquip,
      customer: customerEquip,
      unknown: unknownEquip,
    },
    materials: operationalMaterials,
'''
new = '''    equipment: {
      installed: installedEquip,
      removed: removedEquip,
      customer: customerEquip,
      unknown: unknownEquip,
    },
    operational_inventory: {
      installed_equipment: installedEquip,
      removed_equipment: removedEquip,
      materials: operationalMaterials,
    },
    ignored_inventory: {
      customer_equipment: customerEquip,
      unknown_equipment: unknownEquip,
    },
    materials: operationalMaterials,
'''
cloud = replace_once(cloud, old, new, 'cloud operational inventory')
cloud_path.write_text(cloud, encoding='utf-8')

cloud_test = cloud_test_path.read_text(encoding='utf-8')
cloud_test = cloud_test.replace(
    'materials: [{ invid: "2", kind: "material", material_code: "22056332", used_quantity: "1" }],',
    'materials: [{ invid: "2", kind: "material", pool: "install", material_code: "22056332", used_quantity: "1" }],',
)
cloud_test = cloud_test.replace(
    '{ invid: "101", material_code: "MAT01", used_quantity: "2" },',
    '{ invid: "101", pool: "install", material_code: "MAT01", used_quantity: "2" },',
)
cloud_test = cloud_test.replace(
    '{ invid: "102", material_code: "MAT02", used_quantity: "5" },',
    '{ invid: "102", pool: "install", material_code: "MAT02", used_quantity: "5" },',
)
cloud_test = cloud_test.replace(
    '{ invid: "201", material_code: "RAW01", used_quantity: "1" },',
    '{ invid: "201", pool: "install", material_code: "RAW01", used_quantity: "1" },',
)

cloud_test += '''\n\ntest("customer/recurso nunca entram no inventario operacional de baixa", () => {
  const result = sanitizeOperationalSnapshot({
    contract: "4252617",
    installedEquipment: [{ invid: "1", pool: "install", serial: "INST1" }],
    removedEquipment: [{ invid: "2", pool: "deinstall", serial: "REM1" }],
    customerEquipment: [{ invid: "3", pool: "customer", serial: "CLI1" }],
    unknownEquipment: [{ invid: "4", pool: "resource", serial: "REC1" }],
    materials: [
      { invid: "5", pool: "install", material_code: "MAT-IN", used_quantity: "2" },
      { invid: "6", pool: "customer", material_code: "MAT-CLI", used_quantity: "9" },
      { invid: "7", pool: "resource", material_code: "MAT-REC", used_quantity: "8" },
    ],
  }, "4252617");

  assert.deepEqual(result.operational_inventory.installed_equipment.map(x => x.serial), ["INST1"]);
  assert.deepEqual(result.operational_inventory.removed_equipment.map(x => x.serial), ["REM1"]);
  assert.deepEqual(result.operational_inventory.materials.map(x => x.material_code), ["MAT-IN"]);
  assert.deepEqual(result.ignored_inventory.customer_equipment.map(x => x.serial), ["CLI1"]);
  assert.deepEqual(result.ignored_inventory.unknown_equipment.map(x => x.serial), ["REC1"]);
  assert.equal(JSON.stringify(result.operational_inventory).includes("CLI1"), false);
  assert.equal(JSON.stringify(result.operational_inventory).includes("REC1"), false);
  assert.equal(JSON.stringify(result.operational_inventory).includes("MAT-CLI"), false);
});\n'''
cloud_test_path.write_text(cloud_test, encoding='utf-8')
print('backend-cloud-patched')
