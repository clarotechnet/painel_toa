(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TNToaInventoryCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TASK_LAYOUTS = Object.freeze([
    Object.freeze({ index: 1, os: '193', status: '194', closeCode: '195' }),
    Object.freeze({ index: 2, os: '196', status: '197', closeCode: '198' }),
  ]);

  function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function collectionEntries(value) {
    if (!value || typeof value !== 'object') return [];
    return Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);
  }

  function identifierText(item, key) {
    return text(item?._identifier_structure?.[key]?.text);
  }

  function decimalString(value) {
    const raw = text(value).replace(',', '.');
    if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return '';
    const [whole, fraction = ''] = raw.split('.');
    const cleanWhole = whole.replace(/^0+(?=\d)/, '') || '0';
    const cleanFraction = fraction.replace(/0+$/, '');
    return cleanFraction ? `${cleanWhole}.${cleanFraction}` : cleanWhole;
  }

  function inventoryQuantities(item) {
    const rawUsed = item?.quantity
      ?? item?.used_quantity
      ?? item?.usedQuantity
      ?? item?.quantity_used
      ?? item?.invqty
      ?? item?.qty;
    const rawAvailable = item?.quantidade_estoque
      ?? item?.stock_quantity
      ?? item?.quantity_stock
      ?? item?.available_stock;
    const displayedAvailable = identifierText(item, 'quantidade_estoque')
      || identifierText(item, 'stock_quantity')
      || identifierText(item, 'quantity_stock')
      || identifierText(item, 'available_stock');

    return {
      used_quantity: decimalString(rawUsed),
      available_stock: decimalString(displayedAvailable || rawAvailable),
    };
  }

  function normalizePool(value) {
    const pool = text(value).toLowerCase();
    if (pool === 'install' || pool === 'deinstall' || pool === 'customer') {
      return pool;
    }
    return pool;
  }

  function normalizeInventoryItem(item, fallbackId, expectedAid) {
    const raw = item && typeof item === 'object' ? item : {};
    const activityId = text(raw.inv_aid);
    const serial = text(raw.invsn).replace(/^\*+|\*+$/g, '').toUpperCase();
    const identifierMaterial = identifierText(raw, '192');
    const identifierCodeMatch = identifierMaterial.match(/^(\d{5,})(?:[_\s-]|$)/);
    const materialCode = text(
      raw['192']
      ?? raw.invcode
      ?? raw.code
      ?? identifierCodeMatch?.[1]
    );
    const materialDescription = identifierMaterial
      || text(raw.invname ?? raw.description)
      || materialCode;
    const equipmentType = identifierText(raw, 'invtype') || text(raw.invtype);
    const quantities = inventoryQuantities(raw);
    const kind = serial ? 'equipment' : (materialCode ? 'material' : 'unknown');
    const validationErrors = [];
    const validationWarnings = [];

    if (!activityId) validationErrors.push('inventory_activity_id_missing');
    if (expectedAid && activityId && activityId !== text(expectedAid)) {
      validationErrors.push('inventory_activity_id_mismatch');
    }
    if (kind === 'material') {
      if (!quantities.used_quantity || quantities.used_quantity === '0') {
        validationErrors.push('material_used_quantity_invalid');
      }
      if (!materialDescription) validationWarnings.push('material_description_missing');
    }
    if (kind === 'equipment' && !normalizePool(raw.invpool)) {
      validationWarnings.push('equipment_pool_missing');
    }
    if (kind === 'unknown') validationErrors.push('inventory_identity_missing');

    return {
      invid: text(raw.invid ?? fallbackId),
      activity_id: activityId,
      provider_id: text(raw.inv_pid),
      pool: normalizePool(raw.invpool),
      kind,
      serial,
      material_code: materialCode,
      type: equipmentType,
      description: kind === 'equipment'
        ? (identifierText(raw, '192') || text(raw.description ?? raw.invname))
        : materialDescription,
      action_code: text(raw['419']),
      action: identifierText(raw, '419') || text(raw['419']),
      point: identifierText(raw, '335') || text(raw['335']),
      location: identifierText(raw, '307') || text(raw['307']),
      used_quantity: quantities.used_quantity,
      available_stock: quantities.available_stock,
      quantity: quantities.used_quantity,
      identifier: text(raw._identifier),
      raw_fields: Object.keys(raw).sort(),
      validation_errors: validationErrors,
      validation_warnings: validationWarnings,
    };
  }

  function activityTasks(activity) {
    return TASK_LAYOUTS.map((layout) => ({
      index: layout.index,
      os_number: text(activity?.[layout.os]),
      status: text(activity?.[layout.status]),
      close_code: text(activity?.[layout.closeCode]),
      source_fields: {
        os: layout.os,
        status: layout.status,
        close_code: layout.closeCode,
      },
    })).filter((task) => task.os_number || task.status || task.close_code);
  }

  function providerFromDelta(delta, providerId) {
    const wanted = text(providerId);
    if (!wanted) return null;
    return delta?.Provider?.[wanted]
      || collectionEntries(delta?.Provider).find(
        ([key, item]) => text(item?.pid ?? key) === wanted
      )?.[1]
      || null;
  }

  function providerSummary(delta, providerId) {
    const id = text(providerId);
    const provider = providerFromDelta(delta, id);
    return {
      id,
      external_id: text(provider?.external_id),
      name: text(provider?.pname ?? provider?.name ?? provider?._identifier),
    };
  }

  function uniqueObjects(items, keyFunction) {
    const result = new Map();
    for (const item of items || []) {
      const key = text(keyFunction(item));
      if (key && !result.has(key)) result.set(key, item);
    }
    return [...result.values()];
  }

  function normalizeForm(item, fallbackId) {
    return {
      form_data_id: text(item?.form_data_id ?? fallbackId),
      activity_id: text(item?.activity_id),
      label: text(item?.form_label ?? item?.label),
      provider_id: text(item?.provider_id),
      user_id: text(item?.user_id),
      user_name: text(item?.user_name),
      submitted_at: text(item?.submitted_at),
      created_at: text(item?.created_at),
    };
  }

  function classifyEquipment(items) {
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

  function findActivity(delta, aid) {
    const wanted = text(aid);
    if (!wanted) return null;
    const direct = delta?.Activity?.[wanted];
    if (direct) return [wanted, direct];
    return collectionEntries(delta?.Activity).find(
      ([key, activity]) => text(activity?.aid ?? key) === wanted
    ) || null;
  }

  function normalizeActivityResponse(response, requestedAid, options = {}) {
    const delta = response?.delta || response?.data?.delta;
    if (!delta || typeof delta !== 'object') {
      throw new Error('toa_delta_missing');
    }

    const selected = findActivity(delta, requestedAid);
    if (!selected) throw new Error('toa_activity_not_found');
    const [activityKey, activity] = selected;
    const aid = text(activity?.aid ?? activityKey);
    const route = {
      aid: text(options?.route?.aid),
      pid: text(options?.route?.pid),
      external_id: text(options?.route?.external_id),
      date: text(options?.route?.date),
    };
    const validationErrors = [];
    const validationWarnings = [];

    if (!aid) validationErrors.push('activity_id_missing');
    if (route.aid && route.aid !== aid) validationErrors.push('route_activity_id_mismatch');

    const allInventory = collectionEntries(delta.Inventory);
    const foreignInventoryCount = allInventory.filter(
      ([, item]) => text(item?.inv_aid) && text(item?.inv_aid) !== aid
    ).length;
    const inventory = allInventory
      .filter(([, item]) => text(item?.inv_aid) === aid)
      .map(([key, item]) => normalizeInventoryItem(item, key, aid));
    if (foreignInventoryCount) {
      validationWarnings.push(`foreign_inventory_ignored:${foreignInventoryCount}`);
    }

    const allForms = collectionEntries(delta.FormData);
    const foreignFormsCount = allForms.filter(
      ([, item]) => text(item?.activity_id) && text(item?.activity_id) !== aid
    ).length;
    const forms = allForms
      .filter(([, item]) => text(item?.activity_id) === aid)
      .map(([key, item]) => normalizeForm(item, key));
    if (foreignFormsCount) validationWarnings.push(`foreign_forms_ignored:${foreignFormsCount}`);

    for (const item of inventory) {
      validationErrors.push(...item.validation_errors.map((error) => `${error}:${item.invid}`));
      validationWarnings.push(...item.validation_warnings.map((warning) => `${warning}:${item.invid}`));
    }

    const assignedProviderId = text(
      activity?.auto_routed_to_provider_id
      ?? activity?.pid
      ?? activity?.apid
      ?? activity?.provider_id
      ?? activity?.resource_id
    );
    const assignedTechnician = providerSummary(delta, assignedProviderId);
    if (!assignedTechnician.name) {
      assignedTechnician.name = text(activity?.auto_routed_to_provider_name);
    }
    if (!assignedTechnician.external_id) {
      assignedTechnician.external_id = text(activity?.['466'] ?? route.external_id);
    }
    const routeProvider = providerSummary(delta, route.pid);
    const inventoryProviders = uniqueObjects(
      inventory
        .map((item) => providerSummary(delta, item.provider_id))
        .filter((provider) => provider.id),
      (provider) => provider.id
    );
    const formSubmitters = uniqueObjects(
      forms.map((form) => ({
        provider_id: form.provider_id,
        user_id: form.user_id,
        user_name: form.user_name,
      })),
      (item) => `${item.provider_id}|${item.user_id}|${item.user_name}`
    );

    const equipment = classifyEquipment(inventory);
    const materials = inventory.filter((item) => item.kind === 'material');
    const unknownInventory = inventory.filter((item) => item.kind === 'unknown');

    const normalized = {
      schema_version: 2,
      capture_source: text(options.captureSource) || 'toa-extension',
      captured_at: new Date().toISOString(),
      aid,
      contract: text(activity?.customer_number),
      route,
      activity: {
        aid,
        contract: text(activity?.customer_number),
        customer_name: text(activity?.cname),
        status: text(activity?.astatus ?? activity?.status ?? activity?.activity_status),
        work_type: identifierText(activity, 'aworktype')
          || text(activity?.aworktype ?? activity?.['544'] ?? activity?.atype),
        scheduled_date: route.date || text(activity?.auto_routed_to_date ?? activity?.date),
      },
      tasks: activityTasks(activity),
      inventory,
      installed_equipment: equipment.installed_equipment,
      removed_equipment: equipment.removed_equipment,
      customer_equipment: equipment.customer_equipment,
      unknown_equipment: equipment.unknown_equipment,
      materials,
      unknown_inventory: unknownInventory,
      forms,
      responsibility: {
        assigned_technician: assignedTechnician,
        route_provider: routeProvider,
        inventory_providers: inventoryProviders,
        form_submitters: formSubmitters,
      },
      validation: {
        valid: validationErrors.length === 0,
        errors: [...new Set(validationErrors)],
        warnings: [...new Set(validationWarnings)],
      },
    };

    return clone(normalized);
  }

  return Object.freeze({
    TASK_LAYOUTS,
    activityTasks,
    decimalString,
    inventoryQuantities,
    normalizeInventoryItem,
    normalizeActivityResponse,
  });
});
