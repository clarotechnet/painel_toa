"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const listeners = {};
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  chrome: {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [], sendMessage: async () => {}, reload: async () => {} },
    runtime: {
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } },
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
    },
  },
});

vm.runInContext(fs.readFileSync(require.resolve("./service-worker.js"), "utf8"), context);

const state = context.emptyState();
state.metadata.bucketMode = true;
state.resources = [context.candidateResource({ resourceId: "101", name: "TECNICO DE FOLGA" })];

let result = context.saveBucketFromIds(state, "NTL-DMV", ["101"], "NTL-DMV");
assert.equal(result.total, 1);
assert.equal(state.buckets[0].resources[0].loginDisponivel, false);

result = context.saveBucketFromIds(state, "NTL-DMV_VT", ["101"], "NTL-DMV_VT");
assert.equal(result.total, 1);
assert.equal(state.buckets.length, 2);

context.hydrateBuckets(state, { resourceId: "101", name: "TECNICO DE FOLGA", login: "Z1001", validation: "hint_provider" });
assert.equal(state.buckets[0].resources[0].login, "Z1001");
assert.equal(state.buckets[1].resources[0].login, "Z1001");

console.log("TOA Discovery: buckets exatos, duplicidade legítima e técnico sem login validados.");
