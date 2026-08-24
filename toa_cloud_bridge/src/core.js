const CONTRACT_PATTERN = /^\d{5,18}$/;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,100}$/;
const MAX_ARRAY_ITEMS = 100;

export function normalizeContract(value) {
  const contract = String(value ?? "").replace(/\D+/g, "");
  if (!CONTRACT_PATTERN.test(contract)) {
    throw new BridgeInputError("invalid_contract", "Contrato deve ter entre 5 e 18 digitos");
  }
  return contract;
}

export function normalizeIdentifier(value, fallback = "") {
  const identifier = String(value ?? fallback).trim();
  if (!ID_PATTERN.test(identifier)) {
    throw new BridgeInputError("invalid_identifier", "Identificador invalido");
  }
  return identifier;
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function uniqueStrings(values, maxItems = MAX_ARRAY_ITEMS) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, 100))
    .filter(Boolean))].slice(0, maxItems);
}

function sanitizeTask(value) {
  const task = value && typeof value === "object" ? value : {};
  return {
    index: text(task.index, 10),
    os_number: text(task.os_number ?? task.osNumber ?? task.os, 30).replace(/\D+/g, ""),
    status: text(task.status, 80),
    close_code: text(task.close_code ?? task.closeCode, 30),
  };
}

function sanitizeInventory(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    inventory_id: text(item.inventory_id ?? item.invid, 80),
    kind: text(item.kind, 30),
    pool: text(item.pool, 30),
    action_code: text(item.action_code, 50),
    material_code: text(item.material_code ?? item.code, 80),
    description: text(item.description ?? item.name ?? item.type, 300),
    serial: text(item.serial, 150).toUpperCase(),
    quantity: text(item.quantity ?? item.used_quantity, 50),
    available_stock: text(item.available_stock, 50),
    point: text(item.point, 100),
  };
}

function sanitizeInventoryList(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_ARRAY_ITEMS)
    .map(sanitizeInventory);
}

function sanitizeValidation(value) {
  const validation = value && typeof value === "object" ? value : {};
  return {
    valid: validation.valid === true,
    errors: uniqueStrings(validation.errors),
    warnings: uniqueStrings(validation.warnings),
    reasons: uniqueStrings(validation.reasons),
  };
}

export function selectOperationalMaterials(source) {
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

export function sanitizeOperationalSnapshot(value, expectedContract = "") {
  const source = value && typeof value === "object" ? value : {};
  const contract = normalizeContract(source.contract ?? source.contrato ?? expectedContract);
  if (expectedContract && contract !== normalizeContract(expectedContract)) {
    throw new BridgeInputError("contract_mismatch", "Resultado pertence a outro contrato");
  }

  const equipment = source.equipment && typeof source.equipment === "object"
    ? source.equipment
    : {};

  const installedEquip = sanitizeInventoryList(
    equipment.installed ?? source.installed_equipment ?? source.installedEquipment,
  );
  const removedEquip = sanitizeInventoryList(
    equipment.removed ?? source.removed_equipment ?? source.removedEquipment,
  );
  const customerEquip = sanitizeInventoryList(
    equipment.customer ?? source.customer_equipment ?? source.customerEquipment,
  );
  const unknownEquip = sanitizeInventoryList(
    equipment.unknown ?? source.unknown_equipment ?? source.unknownEquipment,
  );

  const rawOpsMaterials = selectOperationalMaterials(source);
  const operationalMaterials = sanitizeInventoryList(rawOpsMaterials);
  const rawAudit = source.captured_materials_for_audit ?? source.capturedMaterialsForAudit;
  const capturedAuditMaterials = sanitizeInventoryList(Array.isArray(rawAudit) ? rawAudit : []);

  const materialsApplicable = source.materials_applicable !== false;
  const materialsComplete = source.materials_complete !== false;

  const totalInventoryCount = Number(
    source.inventory_diagnostics?.inventory_count ?? (
      installedEquip.length + removedEquip.length + customerEquip.length + unknownEquip.length + operationalMaterials.length
    )
  );

  const inventoryDiagnostics = {
    inventory_count: totalInventoryCount,
    materials_count: Number(source.inventory_diagnostics?.materials_count ?? operationalMaterials.length),
    captured_materials_count: Number(source.inventory_diagnostics?.captured_materials_count ?? capturedAuditMaterials.length),
    source: text(source.inventory_diagnostics?.source ?? source.source ?? "toa-extension-direct", 80),
  };

  const snapshot = {
    schema_version: 1,
    contract,
    activity_id: text(source.activity_id ?? source.aid, 40),
    activity_type: text(source.activity_type ?? source.tipoOS ?? source.tipoServico, 200),
    status: text(source.status, 100),
    scheduled_date: text(source.scheduled_date ?? source.date, 40),
    service_window: text(source.service_window ?? source.janela ?? source.horario, 100),
    route: text(source.route ?? source.rota ?? source.route_name, 150),
    city: text(source.city ?? source.cidade, 120),
    technician: {
      id: text(source.technician?.id ?? source.installer_id ?? source.pid, 80),
      login: text(source.technician?.login ?? source.technician_login, 80),
      name: text(source.technician?.name ?? source.tecnico, 200),
    },
    technician_observation: text(
      source.technician_observation ?? source.activity_observation ?? source.observation ?? source.observacao,
      4000,
    ),
    tasks: (Array.isArray(source.tasks) ? source.tasks : [])
      .slice(0, 20)
      .map(sanitizeTask)
      .filter((item) => item.os_number),
    close_codes: uniqueStrings([
      ...(Array.isArray(source.close_codes ?? source.closeCodes)
        ? (source.close_codes ?? source.closeCodes)
        : []),
      ...(Array.isArray(source.tasks)
        ? source.tasks.map((task) => task?.close_code ?? task?.closeCode)
        : []),
    ]),
    equipment: {
      installed: installedEquip,
      removed: removedEquip,
      customer: customerEquip,
      unknown: unknownEquip,
    },
    materials: operationalMaterials,
    captured_materials_for_audit: capturedAuditMaterials,
    materials_applicable: materialsApplicable,
    materials_complete: materialsComplete,
    inventory_diagnostics: inventoryDiagnostics,
    validation: sanitizeValidation(source.validation ?? source.captureValidation),
    captured_at: text(source.captured_at ?? source.fetched_at, 80) || new Date().toISOString(),
    source: "toa-extension-direct",
    read_only: true,
  };

  return snapshot;
}

export function jsonSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export class BridgeInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BridgeInputError";
    this.code = code;
  }
}

