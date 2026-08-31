from pathlib import Path

root = Path(r'C:\Users\Usuario\Documents\sistematoa\toa-bridge')
core_path = root / 'toa-inventory-core.js'
main_path = root / 'content-main.js'
test_path = root / 'test-toa-inventory-core.js'


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing:{label}')
    return text.replace(old, new, 1)

core = core_path.read_text(encoding='utf-8')

old = """  function normalizePool(value) {
    const pool = text(value).toLowerCase();
    if (pool === 'install' || pool === 'deinstall' || pool === 'customer') {
      return pool;
    }
    return pool;
  }
"""
new = """  function normalizePool(value) {
    return text(value).toLowerCase();
  }

  function isMovementPool(value) {
    const pool = normalizePool(value);
    return pool === 'install' || pool === 'deinstall';
  }
"""
core = replace_once(core, old, new, 'pool helpers')
old = """  function classifyEquipment(items) {
    const output = {
      installed_equipment: [],
      removed_equipment: [],
      customer_equipment: [],
      unknown_equipment: [],
    };

    for (const item of items.filter((entry) => entry.kind === 'equipment')) {
      if (item.pool === 'install') output.installed_equipment.push(item);
      else if (item.pool === 'deinstall') output.removed_equipment.push(item);
      else if (item.pool === 'customer') output.customer_equipment.push(item);
      else output.unknown_equipment.push(item);
    }
    return output;
  }
"""
new = old + """
  function classifyMaterials(items) {
    const output = {
      installed_materials: [],
      removed_materials: [],
      customer_materials: [],
      unknown_materials: [],
    };
    for (const item of items.filter((entry) => entry.kind === 'material')) {
      if (item.pool === 'install') output.installed_materials.push(item);
      else if (item.pool === 'deinstall') output.removed_materials.push(item);
      else if (item.pool === 'customer') output.customer_materials.push(item);
      else output.unknown_materials.push(item);
    }
    return output;
  }
"""
core = replace_once(core, old, new, 'material classifier')
old = """    const allInventory = collectionEntries(delta.Inventory);
    const foreignInventoryCount = allInventory.filter(
      ([, item]) => text(item?.inv_aid) && text(item?.inv_aid) !== aid
    ).length;
    const inventory = allInventory
      .filter(([, item]) => text(item?.inv_aid) === aid)
      .map(([key, item]) => normalizeInventoryItem(item, key, aid));
    if (foreignInventoryCount) {
      validationWarnings.push(`foreign_inventory_ignored:${foreignInventoryCount}`);
    }
"""
new = """    const allInventory = collectionEntries(delta.Inventory);
    const foreignInventoryCount = allInventory.filter(
      ([, item]) => text(item?.inv_aid) && text(item?.inv_aid) !== aid
    ).length;
    const unboundInventoryCount = allInventory.filter(
      ([, item]) => !text(item?.inv_aid)
    ).length;
    const inventory = allInventory
      .filter(([, item]) => text(item?.inv_aid) === aid)
      .map(([key, item]) => normalizeInventoryItem(item, key, aid));
    if (foreignInventoryCount) validationWarnings.push(`foreign_inventory_ignored:${foreignInventoryCount}`);
    if (unboundInventoryCount) validationWarnings.push(`resource_inventory_ignored:${unboundInventoryCount}`);
"""
core = replace_once(core, old, new, 'inventory selection')
old = """    for (const item of inventory) {
      validationErrors.push(...item.validation_errors.map((error) => `${error}:${item.invid}`));
      validationWarnings.push(...item.validation_warnings.map((warning) => `${warning}:${item.invid}`));
    }
"""
new = """    for (const item of inventory) {
      const prefix = isMovementPool(item.pool) ? '' : 'ignored_';
      const target = isMovementPool(item.pool) ? validationErrors : validationWarnings;
      target.push(...item.validation_errors.map((error) => `${prefix}${error}:${item.invid}`));
      validationWarnings.push(...item.validation_warnings.map((warning) => `${warning}:${item.invid}`));
      if (!isMovementPool(item.pool)) {
        validationWarnings.push(`inventory_pool_ignored:${item.pool || 'unknown'}:${item.invid}`);
      }
    }
"""
core = replace_once(core, old, new, 'movement validation')
old = """    const equipment = classifyEquipment(inventory);
    const materials = inventory.filter((item) => item.kind === 'material');
    const unknownInventory = inventory.filter((item) => item.kind === 'unknown');
"""
new = """    const equipment = classifyEquipment(inventory);
    const materialGroups = classifyMaterials(inventory);
    const movementInventory = inventory.filter((item) => isMovementPool(item.pool));
    const ignoredInventory = inventory.filter((item) => !isMovementPool(item.pool));
    const materials = materialGroups.installed_materials;
    const unknownInventory = movementInventory.filter((item) => item.kind === 'unknown');
"""
core = replace_once(core, old, new, 'movement groups')

old = """      inventory,
      installed_equipment: equipment.installed_equipment,
      removed_equipment: equipment.removed_equipment,
      customer_equipment: equipment.customer_equipment,
      unknown_equipment: equipment.unknown_equipment,
      materials,
      unknown_inventory: unknownInventory,
"""
new = """      inventory,
      movement_inventory: movementInventory,
      ignored_inventory: ignoredInventory,
      installed_equipment: equipment.installed_equipment,
      removed_equipment: equipment.removed_equipment,
      customer_equipment: equipment.customer_equipment,
      unknown_equipment: equipment.unknown_equipment,
      materials,
      installed_materials: materialGroups.installed_materials,
      removed_materials: materialGroups.removed_materials,
      customer_materials: materialGroups.customer_materials,
      unknown_materials: materialGroups.unknown_materials,
      unknown_inventory: unknownInventory,
"""
core = replace_once(core, old, new, 'normalized movement fields')
old = """    inventoryQuantities,
    normalizeInventoryItem,
    normalizeActivityResponse,
"""
new = """    inventoryQuantities,
    isMovementPool,
    normalizeInventoryItem,
    normalizeActivityResponse,
"""
core = replace_once(core, old, new, 'exports')
core_path.write_text(core, encoding='utf-8')

main = main_path.read_text(encoding='utf-8')
old = """    const equipmentRaw = (capture.inventory || [])
      .filter(item => item.kind === 'equipment')
      .map(legacyEquipmentFromCapture);
    const materialsRaw = (capture.materials || []).map(legacyMaterialFromCapture);
"""
new = """    const movementInventory = Array.isArray(capture.movement_inventory)
      ? capture.movement_inventory
      : (capture.inventory || []).filter(item => ['install', 'deinstall'].includes(item.pool));
    const equipmentRaw = movementInventory
      .filter(item => item.kind === 'equipment')
      .map(legacyEquipmentFromCapture);
    const materialsRaw = (capture.installed_materials || capture.materials || [])
      .map(legacyMaterialFromCapture);
    const removedMaterialsRaw = (capture.removed_materials || []).map(legacyMaterialFromCapture);
"""
main = replace_once(main, old, new, 'legacy movement filter')
old = """    ctx.inventory = capture.inventory || [];
    ctx.installedEquipment = capture.installed_equipment || [];
    ctx.removedEquipment = capture.removed_equipment || [];
    ctx.customerEquipment = capture.customer_equipment || [];
    ctx.unknownEquipment = capture.unknown_equipment || [];
    ctx.materials = capture.materials || [];
"""
new = """    ctx.inventory = capture.inventory || [];
    ctx.movementInventory = movementInventory;
    ctx.ignoredInventory = capture.ignored_inventory || [];
    ctx.installedEquipment = capture.installed_equipment || [];
    ctx.removedEquipment = capture.removed_equipment || [];
    ctx.customerEquipment = capture.customer_equipment || [];
    ctx.unknownEquipment = capture.unknown_equipment || [];
    ctx.materials = capture.installed_materials || capture.materials || [];
    ctx.installedMaterials = capture.installed_materials || capture.materials || [];
    ctx.removedMaterials = capture.removed_materials || [];
"""
main = replace_once(main, old, new, 'ctx movement fields')

old = """    ctx.materialsRaw = materialsRaw;
    ctx.inventoryUnclassified = [
"""
new = """    ctx.materialsRaw = materialsRaw;
    ctx.removedMaterialsRaw = removedMaterialsRaw;
    ctx.inventoryUnclassified = [
"""
main = replace_once(main, old, new, 'removed material raw')
old = """          inventory: Array.isArray(ctx.inventory) ? ctx.inventory : [],
          installedEquipment: Array.isArray(ctx.installedEquipment) ? ctx.installedEquipment : [],
          removedEquipment: Array.isArray(ctx.removedEquipment) ? ctx.removedEquipment : [],
          customerEquipment: Array.isArray(ctx.customerEquipment) ? ctx.customerEquipment : [],
          unknownEquipment: Array.isArray(ctx.unknownEquipment) ? ctx.unknownEquipment : [],
          materials: Array.isArray(ctx.materials) ? ctx.materials : [],
          materialsRaw: Array.isArray(ctx.materialsRaw) ? ctx.materialsRaw : [],
"""
new = """          inventory: Array.isArray(ctx.inventory) ? ctx.inventory : [],
          movementInventory: Array.isArray(ctx.movementInventory) ? ctx.movementInventory : [],
          ignoredInventory: Array.isArray(ctx.ignoredInventory) ? ctx.ignoredInventory : [],
          installedEquipment: Array.isArray(ctx.installedEquipment) ? ctx.installedEquipment : [],
          removedEquipment: Array.isArray(ctx.removedEquipment) ? ctx.removedEquipment : [],
          customerEquipment: Array.isArray(ctx.customerEquipment) ? ctx.customerEquipment : [],
          unknownEquipment: Array.isArray(ctx.unknownEquipment) ? ctx.unknownEquipment : [],
          materials: Array.isArray(ctx.materials) ? ctx.materials : [],
          installedMaterials: Array.isArray(ctx.installedMaterials) ? ctx.installedMaterials : [],
          removedMaterials: Array.isArray(ctx.removedMaterials) ? ctx.removedMaterials : [],
          materialsRaw: Array.isArray(ctx.materialsRaw) ? ctx.materialsRaw : [],
          removedMaterialsRaw: Array.isArray(ctx.removedMaterialsRaw) ? ctx.removedMaterialsRaw : [],
"""
main = replace_once(main, old, new, 'sync payload movement fields')
main_path.write_text(main, encoding='utf-8')
test = test_path.read_text(encoding='utf-8')
anchor = """        5: {
          invid: 5,
          inv_aid: 999999999,
          invpool: 'install',
          invsn: 'FOREIGN123',
        },
"""
extra = anchor + """        6: {
          invid: 6,
          inv_aid: 194300555,
          invpool: 'customer',
          192: '22000001',
          _identifier_structure: { 192: { text: '22000001_MATERIAL CLIENTE' } },
        },
        7: {
          invid: 7,
          inv_aid: 194300555,
          invpool: 'deinstall',
          192: '22000002',
          quantity: '2',
          _identifier_structure: { 192: { text: '22000002_MATERIAL RETIRADO' } },
        },
"""
test = replace_once(test, anchor, extra, 'test inventory extra 1')
anchor = """        7: {
          invid: 7,
          inv_aid: 194300555,
          invpool: 'deinstall',
          192: '22000002',
          quantity: '2',
          _identifier_structure: { 192: { text: '22000002_MATERIAL RETIRADO' } },
        },
"""
extra = anchor + """        8: {
          invid: 8,
          inv_aid: 194300555,
          inv_pid: 328898,
          invpool: 'resource',
          invsn: 'RESOURCE-STOCK-1',
          _identifier_structure: { invtype: { text: 'ESTOQUE TECNICO' } },
        },
        9: {
          invid: 9,
          inv_pid: 328898,
          invpool: 'resource',
          invsn: 'RESOURCE-STOCK-2',
        },
"""
test = replace_once(test, anchor, extra, 'test inventory extra 2')
old = """assert.equal(capture.inventory.length, 4);
assert.equal(capture.installed_equipment[0].serial, '2CD8AE5D436F');
assert.equal(capture.removed_equipment[0].serial, 'B4F26757B818');
assert.equal(capture.customer_equipment[0].serial, '241786844144');
assert.equal(capture.materials[0].material_code, '22069613');
"""
new = """assert.equal(capture.inventory.length, 7);
assert.equal(capture.movement_inventory.length, 4);
assert.equal(capture.ignored_inventory.length, 3);
assert.equal(capture.installed_equipment[0].serial, '2CD8AE5D436F');
assert.equal(capture.removed_equipment[0].serial, 'B4F26757B818');
assert.equal(capture.customer_equipment[0].serial, '241786844144');
assert.equal(capture.materials.length, 1, 'materials legacy alias must contain install only');
assert.equal(capture.installed_materials[0].material_code, '22069613');
assert.equal(capture.removed_materials[0].material_code, '22000002');
assert.equal(capture.customer_materials[0].material_code, '22000001');
assert.equal(capture.materials[0].material_code, '22069613');
"""
test = replace_once(test, old, new, 'movement assertions')
old = """assert.match(capture.validation.warnings.join('|'), /foreign_inventory_ignored:1/);
assert.match(capture.validation.warnings.join('|'), /foreign_forms_ignored:1/);
assert.equal(JSON.stringify(source), before, 'normalization must not mutate TOA data');
"""
new = """assert.match(capture.validation.warnings.join('|'), /foreign_inventory_ignored:1/);
assert.match(capture.validation.warnings.join('|'), /resource_inventory_ignored:1/);
assert.match(capture.validation.warnings.join('|'), /inventory_pool_ignored:customer:3/);
assert.match(capture.validation.warnings.join('|'), /inventory_pool_ignored:resource:8/);
assert.match(capture.validation.warnings.join('|'), /ignored_material_used_quantity_invalid:6/);
assert.match(capture.validation.warnings.join('|'), /foreign_forms_ignored:1/);
assert.equal(capture.validation.valid, true, 'ignored pools cannot invalidate closure payload');
assert.equal(JSON.stringify(source), before, 'normalization must not mutate TOA data');
"""
test = replace_once(test, old, new, 'validation assertions')

test += """
assert.equal(core.isMovementPool('install'), true);
assert.equal(core.isMovementPool('deinstall'), true);
assert.equal(core.isMovementPool('customer'), false);
assert.equal(core.isMovementPool('resource'), false);
"""
test_path.write_text(test, encoding='utf-8')

print('imperium-inventory-rule-patched')
