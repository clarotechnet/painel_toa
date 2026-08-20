"use strict";

const assert = require("node:assert/strict");
const {
  classifyDisconnectInventory,
} = require("./disconnect-inventory");

const result = classifyDisconnectInventory([
  { serial: "CLIENTE-1", tipo: "MODEM", pool: "customer" },
  { serial: "NOVO-1", tipo: "MODEM", pool: "install" },
  { serial: "NOVO-1", tipo: "", modelo: "M1", pool: "INSTALL" },
  { serial: "RETIRADO-1", tipo: "DECODER", pool: "deinstall" },
  { serial: "DUVIDOSO-1", tipo: "ONT", pool: "provider" },
]);

assert.deepEqual(result.installed.map(item => item.serial), ["NOVO-1"]);
assert.equal(result.installed[0].modelo, "M1");
assert.deepEqual(result.removed.map(item => item.serial), ["RETIRADO-1"]);
assert.deepEqual(result.unknown.map(item => item.serial), ["DUVIDOSO-1"]);
assert.equal(
  [...result.installed, ...result.removed, ...result.unknown]
    .some(item => item.serial === "CLIENTE-1"),
  false
);

console.log("disconnect_inventory_ok");
