(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TNDisconnectInventory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizedPool(item) {
    return String(item?.pool || "").trim().toLowerCase();
  }

  function movementKey(item, index) {
    const serial = String(item?.serial || "").trim().toUpperCase();
    const inventoryId = String(item?.invid || item?.inventory_id || "").trim();
    return serial || inventoryId || `missing-identity-${index}`;
  }

  function mergeMovement(current, item) {
    if (!current) return { ...item };
    return {
      ...current,
      tipo: current.tipo || item?.tipo || "",
      modelo: current.modelo || item?.modelo || "",
      invid: current.invid ?? item?.invid,
    };
  }

  function classifyDisconnectInventory(values) {
    const raw = Array.isArray(values) ? values : [];
    const buckets = {
      installed: new Map(),
      removed: new Map(),
      unknown: new Map(),
    };

    raw.forEach((item, index) => {
      const pool = normalizedPool(item);
      // Existing customer inventory is context only. It is never an equipment
      // movement for the current disconnect activity.
      if (pool === "customer") return;

      const target = pool === "install"
        ? buckets.installed
        : (pool === "deinstall" ? buckets.removed : buckets.unknown);
      const key = movementKey(item, index);
      target.set(key, mergeMovement(target.get(key), item));
    });

    return {
      installed: Array.from(buckets.installed.values()),
      removed: Array.from(buckets.removed.values()),
      unknown: Array.from(buckets.unknown.values()),
    };
  }

  return Object.freeze({
    classifyDisconnectInventory,
    normalizedPool,
  });
});
