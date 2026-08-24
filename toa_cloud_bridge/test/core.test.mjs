import assert from "node:assert/strict";
import test from "node:test";

import {
  BridgeInputError,
  normalizeContract,
  sanitizeOperationalSnapshot,
} from "../src/core.js";

test("normaliza contrato e recusa valores invalidos", () => {
  assert.equal(normalizeContract("CLIENTE - 4252617"), "4252617");
  assert.throws(() => normalizeContract("abc"), BridgeInputError);
});

test("snapshot remove dados pessoais e preserva materiais/equipamentos", () => {
  const result = sanitizeOperationalSnapshot({
    contrato: "4252617",
    aid: "196603398",
    nome: "NAO PODE VAZAR",
    telefone: "84999999999",
    cpfCliente: "12345678900",
    endereco: "RUA NAO PODE VAZAR",
    tecnico: "ROBERTO TESTE",
    observation: "Instalacao concluida",
    tasks: [{ os_number: "2650569933", close_code: "409", status: "E" }],
    installedEquipment: [{ invid: "1", kind: "equipment", pool: "install", serial: "abc123" }],
    materials: [{ invid: "2", kind: "material", material_code: "22056332", used_quantity: "1" }],
    captureValidation: { valid: true, warnings: ["aviso"] },
  }, "4252617");

  const serialized = JSON.stringify(result);
  assert.equal(result.contract, "4252617");
  assert.equal(result.tasks[0].close_code, "409");
  assert.equal(result.equipment.installed[0].serial, "ABC123");
  assert.equal(result.materials[0].material_code, "22056332");
  assert.equal(result.technician_observation, "Instalacao concluida");
  assert.deepEqual(result.close_codes, ["409"]);
  assert.doesNotMatch(serialized, /NAO PODE VAZAR|84999999999|12345678900|RUA NAO/);
});

test("snapshot bloqueia contrato divergente", () => {
  assert.throws(
    () => sanitizeOperationalSnapshot({ contract: "4259999" }, "4252617"),
    /outro contrato/,
  );
});

test("produtiva com miscelaneas: preserva materiais e gera diagnostico correto", () => {
  const result = sanitizeOperationalSnapshot({
    contract: "4252617",
    materials: [
      { invid: "101", material_code: "MAT01", used_quantity: "2" },
      { invid: "102", material_code: "MAT02", used_quantity: "5" },
    ],
    materials_applicable: true,
    materials_complete: true,
  }, "4252617");

  assert.equal(result.materials.length, 2);
  assert.equal(result.materials[0].material_code, "MAT01");
  assert.equal(result.materials[1].material_code, "MAT02");
  assert.equal(result.materials_applicable, true);
  assert.equal(result.materials_complete, true);
  assert.equal(result.inventory_diagnostics.materials_count, 2);
  assert.equal(result.inventory_diagnostics.captured_materials_count, 0);
});

test("fallback produtivo: materials vazio e materialsRaw preenchido resulta em materiais operacionais", () => {
  const result = sanitizeOperationalSnapshot({
    contract: "4252617",
    materials: [],
    materialsRaw: [
      { invid: "201", material_code: "RAW01", used_quantity: "1" },
    ],
    materials_applicable: true,
  }, "4252617");

  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].material_code, "RAW01");
  assert.equal(result.materials_applicable, true);
  assert.equal(result.inventory_diagnostics.materials_count, 1);
});

test("desconexao: materials vazio e audit preenchido nao mistura com operacionais", () => {
  const result = sanitizeOperationalSnapshot({
    contract: "4252617",
    materials: [],
    captured_materials_for_audit: [
      { invid: "301", material_code: "AUDIT01", used_quantity: "3" },
    ],
    materials_applicable: false,
    materials_complete: true,
  }, "4252617");

  assert.equal(result.materials.length, 0);
  assert.equal(result.captured_materials_for_audit.length, 1);
  assert.equal(result.captured_materials_for_audit[0].material_code, "AUDIT01");
  assert.equal(result.materials_applicable, false);
  assert.equal(result.materials_complete, true);
  assert.equal(result.inventory_diagnostics.materials_count, 0);
  assert.equal(result.inventory_diagnostics.captured_materials_count, 1);
});

test("sem inventario: diagnostica contagem zero de forma explicita", () => {
  const result = sanitizeOperationalSnapshot({
    contract: "4252617",
    materials: [],
    materials_applicable: true,
  }, "4252617");

  assert.equal(result.materials.length, 0);
  assert.equal(result.inventory_diagnostics.inventory_count, 0);
  assert.equal(result.inventory_diagnostics.materials_count, 0);
  assert.equal(result.inventory_diagnostics.captured_materials_count, 0);
});


