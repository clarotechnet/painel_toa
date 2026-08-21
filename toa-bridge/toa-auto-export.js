(function installTOAAutoExport(root) {
  "use strict";

  const POLL_FIRST_DELAY_MS = 500;
  const POLL_INTERVAL_MS = 2000;
  const EXPORT_TIMEOUT_MS = 8 * 60 * 1000;
  const observedBuckets = new Map();
  const observedTreeNodes = new Map();
  const activeControllers = new Map();
  let selectedProviderId = "";

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  function validateDate(value) {
    const date = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data de exportacao invalida");
    return date;
  }

  function isDMVBucket(name) {
    return /^(?:NTL|PWM|FTZ|JCR|MRO)-DMV(?:_[A-Z0-9]+)*$/i.test(name);
  }

  function rememberTreeNode(rawNode, fallbackId = "", source = "Time.get") {
    if (!rawNode || typeof rawNode !== "object") return null;
    const providerId = compact(rawNode.z || fallbackId);
    if (!/^\d+$/.test(providerId)) return null;

    const previous = observedTreeNodes.get(providerId) || {};
    const name = compact(rawNode.n || previous.name);
    const parentId = compact(rawNode.p ?? previous.parentId ?? "");
    const externalId = compact(rawNode.e || previous.externalId);
    const node = {
      providerId,
      name,
      parentId: /^\d+$/.test(parentId) ? parentId : "",
      externalId,
      type: Number.isFinite(Number(rawNode.t)) ? Number(rawNode.t) : previous.type,
      source,
      seenAt: Date.now(),
    };
    observedTreeNodes.set(providerId, node);

    if (isDMVBucket(name)) {
      observedBuckets.set(providerId, {
        name: name.toUpperCase(),
        providerId,
        source,
      });
    }
    return node;
  }

  function rememberTimeResponse(payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.p && typeof payload.p === "object") {
      const selected = rememberTreeNode(payload.p, payload.pid, "Time.get:selected");
      selectedProviderId = compact(selected?.providerId || payload.pid || selectedProviderId);
    }

    const trees = Array.isArray(payload.trees) ? payload.trees : [];
    for (const tree of trees) {
      const updates = tree?.tree_updates;
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) continue;
      for (const [fallbackId, rawNode] of Object.entries(updates)) {
        rememberTreeNode(rawNode, fallbackId, "Time.get:tree");
      }
    }

    // O OFS varia o nome desta coleção entre endpoints/builds. Observar todas
    // as formas completa a árvore sem alterar nenhuma atividade do TOA.
    const providerCollections = [
      payload?.delta?.providers,
      payload?.delta?.Provider,
      payload?.providers,
      payload?.Provider,
    ];
    for (const providers of providerCollections) {
      if (!providers || typeof providers !== "object" || Array.isArray(providers)) continue;
      for (const [fallbackId, rawProvider] of Object.entries(providers)) {
        if (!rawProvider || typeof rawProvider !== "object") continue;
        rememberTreeNode({
          ...rawProvider,
          z: rawProvider.z || rawProvider.pid || fallbackId,
          n: rawProvider.n || rawProvider.pname || rawProvider.name,
          e: rawProvider.e || rawProvider.external_id || rawProvider.login,
          p: rawProvider.p ?? rawProvider.parent_id ?? rawProvider.parentId,
          t: rawProvider.t ?? 5,
        }, fallbackId, "Time.get:delta");
      }
    }
  }

  function routeForProvider(providerId) {
    let currentId = compact(providerId);
    const visited = new Set();

    for (let depth = 0; depth < 20; depth += 1) {
      if (!/^\d+$/.test(currentId) || visited.has(currentId)) return null;
      visited.add(currentId);

      const node = observedTreeNodes.get(currentId);
      if (!node) return null;

      if (isDMVBucket(node.name)) {
        return {
          name: compact(node.name).toUpperCase(),
          providerId: node.providerId,
          source: node.source || "tree",
        };
      }
      currentId = compact(node.parentId);
    }
    return null;
  }

  function selectedProvider() {
    if (!selectedProviderId) return null;
    const node = observedTreeNodes.get(selectedProviderId);
    return node ? { ...node, route: routeForProvider(selectedProviderId) } : null;
  }

  function treeStatus() {
    return {
      nodes: observedTreeNodes.size,
      buckets: discoverBuckets().length,
      observedAt: Date.now(),
    };
  }

  function isTimeGet(url) {
    try {
      const parsed = new URL(String(url || ""), location.href);
      return parsed.origin === location.origin
        && parsed.searchParams.get("m")?.toLowerCase() === "time"
        && parsed.searchParams.get("a")?.toLowerCase() === "get";
    } catch {
      return false;
    }
  }

  function installTimeResponseObserver() {
    const previousFetch = root.fetch;
    if (typeof previousFetch === "function") {
      root.fetch = async function observedFetch(input) {
        const response = await previousFetch.apply(this, arguments);
        if (isTimeGet(typeof input === "string" ? input : input?.url)) {
          response.clone().json().then(rememberTimeResponse).catch(() => {});
        }
        return response;
      };
    }

    const previousOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function observedOpen(_method, url) {
      this.__technetTimeGet = isTimeGet(url);
      return previousOpen.apply(this, arguments);
    };
    const previousSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function observedSend() {
      if (this.__technetTimeGet) {
        this.addEventListener("load", () => {
          try {
            rememberTimeResponse(JSON.parse(this.responseText));
          } catch {
            // The regular TOA request remains untouched when its body is not JSON.
          }
        }, { once: true });
      }
      return previousSend.apply(this, arguments);
    };
  }

  function discoverBuckets() {
    const buckets = new Map();
    for (const [providerId, bucket] of observedBuckets) {
      buckets.set(providerId, { ...bucket });
    }

    for (const element of document.querySelectorAll("[data-label-pid], .edt-item[data-id][role='treeitem']")) {
      const label = element.matches("[data-label-pid]")
        ? element
        : element.querySelector("[data-label-pid]");
      const providerId = compact(label?.dataset.labelPid || element.dataset.id);
      const namedElement = label?.querySelector(".rtl-prov-name") || label || element;
      const name = compact(namedElement?.textContent).toUpperCase();
      if (!/^\d+$/.test(providerId) || !isDMVBucket(name)) continue;
      buckets.set(providerId, { name, providerId, source: "DOM" });
    }

    return [...buckets.values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }

  function generateDownloadId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function buildDownloadUrl(providerId, date, downloadId) {
    const query = new URLSearchParams({
      m: "gridexport",
      a: "download",
      itype: "manage",
      providerId: String(providerId),
      date,
      panel: "top",
      view: "time",
      downloadId,
      dates: date,
    });
    query.append(String(Date.now()), "");
    return `${location.origin}/?${query.toString()}`;
  }

  function oracleStatus(downloadId) {
    return new Promise((resolve, reject) => {
      if (!root.toa?.app?.trigger) {
        reject(new Error("Status de exportacao do Oracle indisponivel"));
        return;
      }
      const timeout = setTimeout(() => reject(new Error("Timeout consultando exportacao")), 12000);
      root.toa.app.trigger("global.data.get", {
        controller: "gridexport",
        method: "getfilepreparationstatus",
        params: { downloadId },
        responseHandler: (_event, response) => {
          clearTimeout(timeout);
          resolve(response?.downloadFilePreparationStatus || null);
        },
      });
    });
  }

  function filenameFrom(response, fallback) {
    const disposition = response.headers.get("content-disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = disposition.match(/filename="?([^";]+)"?/i);
    try {
      return decodeURIComponent((encoded?.[1] || plain?.[1] || fallback).trim());
    } catch {
      return fallback;
    }
  }

  async function exportBucket(bucket, date) {
    const safeDate = validateDate(date);
    const downloadId = generateDownloadId();
    const controller = new AbortController();
    const jobId = `${bucket.providerId}:${safeDate}:${downloadId}`;
    const deadline = Date.now() + EXPORT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort("timeout"), EXPORT_TIMEOUT_MS);
    const fallback = `Atividades-${bucket.name}_${safeDate.slice(8, 10)}_${safeDate.slice(5, 7)}_${safeDate.slice(2, 4)}.csv`;
    activeControllers.set(jobId, controller);

    try {
      const responsePromise = fetch(buildDownloadUrl(bucket.providerId, safeDate, downloadId), {
        method: "GET",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { Accept: "text/x-comma-separated-values,text/csv;q=0.9,*/*;q=0.1" },
      });

      await delay(POLL_FIRST_DELAY_MS);
      while (Date.now() < deadline && !controller.signal.aborted) {
        try {
          const status = await oracleStatus(downloadId);
          if (!status || typeof status !== "object") break;
          if (status.state === "error") throw new Error(status.errorMessage || "Oracle recusou a exportacao");
          if (status.state === "done") break;
        } catch (error) {
          if (String(error?.message || error).includes("recusou")) throw error;
          break;
        }
        await delay(POLL_INTERVAL_MS);
      }
      if (Date.now() >= deadline) controller.abort("timeout");

      const response = await responsePromise;
      if (response.status === 401 || response.status === 403) throw new Error("Sessao Oracle expirada ou sem permissao");
      if (response.status === 409) throw new Error("Oracle atingiu o limite de exportacoes simultaneas");
      if (!response.ok) throw new Error(`Oracle retornou HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      const filename = filenameFrom(response, fallback);
      if (/(?:comma-separated-values|text\/csv)/i.test(contentType) || /\.csv$/i.test(filename)) {
        const csv = await response.text();
        const firstLine = csv.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
        if (!firstLine.includes(",") || !/(?:Login do T|Data|Contrato|Numero da)/i.test(firstLine)) {
          throw new Error("A resposta do TOA nao e um CSV de atividades valido");
        }
        return { csv, filename, downloadId, route: bucket.name, format: "csv" };
      }
      if (/(?:spreadsheetml|application\/zip|application\/octet-stream)/i.test(contentType) || /\.xlsx$/i.test(filename)) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const chunks = [];
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
        }
        return {
          base64: btoa(chunks.join("")),
          filename: /\.xlsx$/i.test(filename) ? filename : filename.replace(/\.csv$/i, ".xlsx"),
          downloadId,
          route: bucket.name,
          format: "xlsx",
        };
      }
      throw new Error(`Formato de exportacao TOA nao reconhecido: ${contentType || "sem content-type"}`);
    } finally {
      clearTimeout(timeout);
      activeControllers.delete(jobId);
    }
  }

  async function exportRoute(route, date) {
    const normalizedRoute = compact(route).toUpperCase();
    const bucket = discoverBuckets().find((item) => item.name === normalizedRoute);
    if (!bucket) throw new Error(`Bucket ${normalizedRoute} nao encontrado na arvore atual do TOA`);
    return exportBucket(bucket, date);
  }

  function cancelAll() {
    for (const controller of activeControllers.values()) controller.abort("cancelled");
    activeControllers.clear();
  }

  installTimeResponseObserver();
  root.TNTOAAutoExport = Object.freeze({
    discoverBuckets,
    exportRoute,
    routeForProvider,
    selectedProvider,
    treeStatus,
    cancelAll,
    // Respostas de detalhes/sincronização podem trazer um técnico que ainda
    // não apareceu no Time.get observado após a extensão iniciar.
    observePayload: rememberTimeResponse,
  });
})(globalThis);
