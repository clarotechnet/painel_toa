(function installTOADiscoveryHook() {
  "use strict";

  if (window.__TOA_DISCOVERY_HOOK_ACTIVE__) return;
  Object.defineProperty(window, "__TOA_DISCOVERY_HOOK_ACTIVE__", {
    value: true,
    configurable: false,
    enumerable: false,
  });

  const core = window.__TOA_DISCOVERY_CORE__;
  if (!core) return;

  const CHANNEL = "TOA_DISCOVERY_V1";
  const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
  const MAX_CANDIDATES = 1200;
  const VALIDATION_CONCURRENCY = 6;
  const validationState = {
    candidates: new Map(),
    validated: new Set(),
    rejected: new Set(),
    template: null,
    running: false,
    bucketMode: false,
    currentBucket: "",
    fastSweepRunning: false,
    generation: 0,
  };
  const liveProviders = new Map();
  let liveIdentity = "";

  const nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const NativeWebSocket = window.WebSocket;
  const NativeEventSource = window.EventSource;

  function emit(type, payload) {
    try {
      window.postMessage({ channel: CHANNEL, direction: "page-to-extension", type, payload }, location.origin);
    } catch (_) {}
  }

  function absoluteUrl(url) {
    try { return new URL(String(url || ""), location.href).href; } catch (_) { return String(url || ""); }
  }

  function headerMap(input) {
    const output = {};
    try {
      const headers = new Headers(input || {});
      for (const [name, value] of headers.entries()) {
        const lower = name.toLowerCase();
        if (["x-requested-with", "x-oa", "x-platform", "x-ofs-csrf-secure", "content-type"].includes(lower)) {
          output[lower] = value;
        }
      }
    } catch (_) {}
    return output;
  }

  function isHintProvider(url) {
    try {
      const parsed = new URL(absoluteUrl(url));
      return String(parsed.searchParams.get("m") || "").toLowerCase() === "hint"
        && String(parsed.searchParams.get("a") || "").toLowerCase() === "provider";
    } catch (_) { return false; }
  }

  function rememberHintTemplate(method, url, body, headers) {
    if (!isHintProvider(url) || String(method || "GET").toUpperCase() !== "POST") return;
    try {
      const params = body instanceof URLSearchParams
        ? new URLSearchParams(body.toString())
        : new URLSearchParams(typeof body === "string" ? body : "");
      if (!params.has("id")) return;
      validationState.template = {
        url: absoluteUrl(url),
        params,
        headers: { ...headers },
      };
      emit("VALIDATION_TEMPLATE_READY", { ready: true, observedAt: new Date().toISOString() });
      scheduleValidation();
    } catch (_) {}
  }

  function analyzeExchange(meta, responseText) {
    try {
      const text = String(responseText || "");
      const liveSnapshot = core.sanitizeTimeSnapshot(meta.url, text);
      if (liveSnapshot) {
        const nextIdentity = `${liveSnapshot.group_id}|${liveSnapshot.scheduled_date}`;
        if (liveIdentity && liveIdentity !== nextIdentity) liveProviders.clear();
        liveIdentity = nextIdentity;
        for (const provider of liveSnapshot.providers || []) {
          liveProviders.set(String(provider.technician_id || ""), provider);
        }
        liveSnapshot.providers = [...liveProviders.values()];
        emit("LIVE_SNAPSHOT", liveSnapshot);
      }
      const summary = core.summarizeExchange({
        ...meta,
        baseUrl: location.href,
        responseText: text.length <= MAX_RESPONSE_BYTES ? text : "",
        responseBytes: meta.responseBytes || text.length,
      });
      if (validationState.bucketMode && Array.isArray(summary.resources)) {
        summary.bucket = validationState.currentBucket || detectCurrentBucket();
        registerCandidates(summary.resources.map((resource) => ({
          ...resource,
          source: "NETWORK:CURRENT_BUCKET",
          bucket: summary.bucket,
        })), summary.bucket);
      }
      emit("EXCHANGE", summary);
    } catch (error) {
      emit("CAPTURE_ERROR", { stage: "analyze_exchange", message: String(error && error.message || error).slice(0, 240), at: new Date().toISOString() });
    }
  }

  if (nativeFetch) {
    window.fetch = async function toaDiscoveryFetch(input, init) {
      const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : String(input && input.url || "");
      const method = String(init && init.method || input && input.method || "GET").toUpperCase();
      const body = init && init.body;
      const headers = headerMap([...(input && input.headers ? new Headers(input.headers).entries() : []), ...(init && init.headers ? new Headers(init.headers).entries() : [])]);
      rememberHintTemplate(method, requestUrl, body, headers);
      const response = await nativeFetch(input, init);
      try {
        const clone = response.clone();
        const responseType = clone.headers.get("content-type") || "";
        clone.text().then((text) => analyzeExchange({
          method,
          url: requestUrl,
          body,
          requestType: headers["content-type"] || "",
          responseType,
          responseBytes: Number(clone.headers.get("content-length") || text.length || 0),
          status: clone.status,
          transport: "fetch",
        }, text)).catch(() => {});
      } catch (_) {}
      return response;
    };
  }

  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function toaDiscoveryOpen(method, url, ...rest) {
      this.__toaDiscovery = { method: String(method || "GET").toUpperCase(), url: absoluteUrl(url), headers: {}, body: null };
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function toaDiscoverySetHeader(name, value) {
      try {
        if (this.__toaDiscovery) {
          const lower = String(name || "").toLowerCase();
          if (["x-requested-with", "x-oa", "x-platform", "x-ofs-csrf-secure", "content-type"].includes(lower)) {
            this.__toaDiscovery.headers[lower] = String(value || "");
          }
        }
      } catch (_) {}
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function toaDiscoverySend(body) {
      const meta = this.__toaDiscovery || { method: "GET", url: location.href, headers: {} };
      meta.body = body;
      rememberHintTemplate(meta.method, meta.url, body, meta.headers);
      try {
        this.addEventListener("load", function toaDiscoveryXHRLoad() {
          try {
            let text = "";
            if (!this.responseType || this.responseType === "text") text = String(this.responseText || "");
            else if (this.responseType === "json") text = JSON.stringify(this.response || null);
            analyzeExchange({
              method: meta.method,
              url: meta.url,
              body: meta.body,
              requestType: meta.headers["content-type"] || "",
              responseType: this.getResponseHeader("content-type") || this.responseType || "",
              responseBytes: Number(this.getResponseHeader("content-length") || text.length || 0),
              status: this.status,
              transport: "xhr",
            }, text);
          } catch (_) {}
        }, { once: true });
      } catch (_) {}
      return originalSend.call(this, body);
    };
  } catch (error) {
    emit("CAPTURE_ERROR", { stage: "xhr_hook", message: String(error && error.message || error).slice(0, 240), at: new Date().toISOString() });
  }

  if (typeof NativeWebSocket === "function") {
    try {
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, args, NewTarget) {
          const socket = Reflect.construct(Target, args, NewTarget);
          const url = String(args[0] || "");
          socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            analyzeExchange({ method: "MESSAGE", url, responseType: "websocket", status: 101, transport: "websocket" }, event.data);
          });
          return socket;
        },
      });
    } catch (_) {}
  }

  if (typeof NativeEventSource === "function") {
    try {
      window.EventSource = new Proxy(NativeEventSource, {
        construct(Target, args, NewTarget) {
          const source = Reflect.construct(Target, args, NewTarget);
          const url = String(args[0] || "");
          source.addEventListener("message", (event) => {
            analyzeExchange({ method: "EVENT", url, responseType: "event-stream", status: 200, transport: "eventsource" }, event.data);
          });
          return source;
        },
      });
    } catch (_) {}
  }

  function registerCandidates(items, bucket) {
    const changed = [];
    for (const item of items || []) {
      const id = String(item && item.resourceId || "").trim();
      if (!/^\d{2,8}$/.test(id) || validationState.candidates.size >= MAX_CANDIDATES) continue;
      const previous = validationState.candidates.get(id) || {};
      const bucketName = String(item.bucket || bucket || validationState.currentBucket || "").slice(0, 60);
      const buckets = [...new Set([...(previous.buckets || []), bucketName].filter(Boolean))];
      const safe = {
        ...previous,
        resourceId: id,
        userId: String(item.userId || previous.userId || "").slice(0, 30),
        login: String(item.login || previous.login || "").slice(0, 80),
        name: String(item.name || previous.name || "").slice(0, 160),
        resourceType: String(item.resourceType || previous.resourceType || "").slice(0, 80),
        accountStatus: String(item.accountStatus || previous.accountStatus || "").slice(0, 80),
        availabilityStatus: String(item.availabilityStatus || previous.availabilityStatus || "").slice(0, 80),
        source: String(item.source || previous.source || "unknown").slice(0, 120),
        buckets,
      };
      validationState.candidates.set(id, safe);
      if (!previous.resourceId || JSON.stringify(previous) !== JSON.stringify(safe)) changed.push(safe);
    }
    if (changed.length) {
      emit("RESOURCE_CANDIDATES", { candidates: changed, bucket: String(bucket || validationState.currentBucket || ""), total: validationState.candidates.size, capturedAt: new Date().toISOString() });
      scheduleValidation();
    }
    return (items || []).map((item) => String(item && item.resourceId || "")).filter((id) => /^\d{2,8}$/.test(id));
  }

  function cleanResourceName(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length < 3 || text.length > 160) return "";
    if (/^[A-Z]{2,5}(?:[-_][A-Z0-9]{2,})+$/i.test(text)) return "";
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return "";
    if (/^(?:\+?\d[\d\s().-]{7,})$/.test(text)) return "";
    return text;
  }

  function resourceNameFromElement(element) {
    const row = element.closest && element.closest('[role="treeitem"],tr,li,[class*="resource" i],[class*="provider" i]');
    const scope = row || element;
    const attributes = ["data-resource-name", "data-provider-name", "aria-label", "title"];
    for (const name of attributes) {
      const value = scope.getAttribute && scope.getAttribute(name);
      const clean = cleanResourceName(value);
      if (clean) return clean;
    }
    const label = scope.querySelector && scope.querySelector('[class*="name" i],[class*="label" i]');
    return cleanResourceName(label && label.textContent || scope.textContent);
  }

  function scanDOM(bucket) {
    const found = [];
    const snapshot = { resources: [], activities: [], events: [], routes: [], fields: [] };
    const appendEntities = (entities) => {
      if (!entities) return;
      for (const key of Object.keys(snapshot)) {
        if (Array.isArray(entities[key]) && snapshot[key].length < 5000) snapshot[key].push(...entities[key].slice(0, 5000 - snapshot[key].length));
      }
    };
    const elements = document.querySelectorAll ? document.querySelectorAll("*") : [];
    const limit = Math.min(elements.length, 12000);
    const jq = window.jQuery || (window.$ && window.$.data ? window.$ : null);
    for (let index = 0; index < limit; index += 1) {
      const element = elements[index];
      const attributeModel = {};
      for (const attribute of Array.from(element.attributes || [])) {
        const name = core.normalizeKey(attribute.name);
        if (/(?:aid|activity|pid|provider|resource|status|route|window|duration|travel|coordinate|latitude|longitude)/.test(name)) {
          attributeModel[attribute.name] = attribute.value;
        }
        if (!/(?:pid|provider|resource)/.test(name)) continue;
        const matches = String(attribute.value || "").match(/\b\d{2,8}\b/g) || [];
        const resourceName = resourceNameFromElement(element);
        matches.forEach((resourceId) => found.push({ resourceId, name: resourceName, bucket: bucket || validationState.currentBucket, source: `DOM:${attribute.name}` }));
      }
      if (Object.keys(attributeModel).length) appendEntities(core.extractEntities(attributeModel));
      try {
        if (jq && typeof jq.hasData === "function" && jq.hasData(element)) {
          const data = jq.data(element);
          found.push(...core.collectResourceCandidates(data, "JQUERY-DATA"));
          appendEntities(core.extractEntities(data));
          const resourceContext = Boolean(element.closest && element.closest('[id*="resource" i],[class*="resource" i],[id*="provider" i],[class*="provider" i],[id*="tree" i],[class*="tree" i]'));
          if (resourceContext && data && typeof data === "object") {
            for (const [key, value] of Object.entries(data)) {
              if (core.isSensitiveKey(key)) continue;
              const normalized = core.normalizeKey(key);
              if (["id", "pid", "resourceid", "providerid"].includes(normalized) && ["string", "number"].includes(typeof value) && /^\d{2,8}$/.test(String(value))) {
                found.push({ resourceId: String(value), name: resourceNameFromElement(element), bucket: bucket || validationState.currentBucket, source: "JQUERY-DATA:TREE" });
              }
            }
          }
        }
      } catch (_) {}
    }
    const resourceIds = registerCandidates(found, bucket);
    if (snapshot.activities.length || snapshot.events.length || snapshot.routes.length || snapshot.fields.length || snapshot.resources.length) {
      emit("MODEL_ENTITIES", { ...snapshot, bucket: bucket || validationState.currentBucket || "", source: "DOM/JQUERY", capturedAt: new Date().toISOString() });
    }
    return resourceIds;
  }

  function scanKnownModels() {
    const names = ["_DATA", "delta", "$app", "app", "App", "OFS", "ofsc", "Oracle", "application"];
    for (const name of names) {
      try {
        const model = window[name];
        if (model && typeof model === "object") {
          registerCandidates(core.collectResourceCandidates(model, `WINDOW:${name}`));
          const entities = core.extractEntities(model);
          if (entities.activities.length || entities.events.length || entities.routes.length || entities.fields.length || entities.resources.length) {
            emit("MODEL_ENTITIES", { ...entities, source: `WINDOW:${name}`, capturedAt: new Date().toISOString() });
          }
        }
      } catch (_) {}
    }
  }

  function cleanBucketLabel(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const match = text.match(/\b([A-Z]{2,5}(?:[-_][A-Z0-9]{2,})+)\b/);
    return match ? match[1].slice(0, 60) : "";
  }

  function detectCurrentBucket() {
    const preferred = document.querySelectorAll
      ? document.querySelectorAll('[aria-selected="true"], [class*="selected" i], [class*="active" i]')
      : [];
    for (const element of preferred) {
      const label = cleanBucketLabel(element.textContent);
      if (label) return label;
    }
    const elements = document.querySelectorAll ? document.querySelectorAll("body *") : [];
    let best = "";
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < Math.min(elements.length, 5000); index += 1) {
      const element = elements[index];
      const text = String(element.textContent || "").trim();
      if (text.length > 60 || !/^[A-Z]{2,5}(?:[-_][A-Z0-9]{2,})+$/.test(text)) continue;
      const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const score = Math.max(0, rect.top) + Math.max(0, rect.left) * 0.25;
      if (score < bestScore) { best = text; bestScore = score; }
    }
    return best.slice(0, 60);
  }

  function emitBucketContext() {
    const bucket = detectCurrentBucket();
    if (bucket) {
      validationState.currentBucket = bucket;
      emit("BUCKET_CONTEXT", { bucket, capturedAt: new Date().toISOString() });
    }
    return bucket;
  }

  function scanCurrentBucketSources() {
    emitBucketContext();
    // O modelo global do TOA acumula recursos de buckets visitados anteriormente.
    // Em modo bucket, somente as respostas de rede observadas depois do reset entram
    // na coleta; reler _DATA/delta aqui voltaria a misturar cidades.
    emit("SCAN_COMPLETE", { candidateCount: validationState.candidates.size, bucketMode: true, capturedAt: new Date().toISOString() });
  }

  function scanStorage(storage, label) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || core.isSensitiveKey(key)) continue;
        const raw = storage.getItem(key);
        if (!raw || raw.length > 1024 * 1024 || !(raw.trim().startsWith("{") || raw.trim().startsWith("["))) continue;
        try { registerCandidates(core.collectResourceCandidates(JSON.parse(raw), `${label}:${key}`)); } catch (_) {}
      }
    } catch (_) {}
  }

  function scanAllSources() {
    if (validationState.bucketMode) {
      scanCurrentBucketSources();
      return;
    }
    scanDOM();
    scanKnownModels();
    scanStorage(window.sessionStorage, "SESSION-STORAGE");
    scanStorage(window.localStorage, "LOCAL-STORAGE");
    emit("SCAN_COMPLETE", { candidateCount: validationState.candidates.size, capturedAt: new Date().toISOString() });
  }

  async function validateCandidate(candidate, generation) {
    const template = validationState.template;
    if (!template || !nativeFetch || generation !== validationState.generation) return;
    const id = candidate.resourceId;
    if (validationState.validated.has(id) || validationState.rejected.has(id)) return;
    try {
      const params = new URLSearchParams(template.params.toString());
      params.set("id", id);
      const headers = { ...template.headers };
      if (!headers["content-type"]) headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      const response = await nativeFetch(template.url, {
        method: "POST",
        credentials: "include",
        headers,
        body: params.toString(),
      });
      const text = await response.text();
      if (generation !== validationState.generation) return;
      const resource = core.parseResourceHint(text, id);
      if (response.ok && resource && String(resource.resourceId) === id) {
        validationState.validated.add(id);
        emit("RESOURCE_VALIDATED", { resource, source: candidate.source, buckets: candidate.buckets || [] });
        try { console.info(`[RESOURCE] pid ${id} -> ${resource.name} / ${resource.login}`); } catch (_) {}
      } else {
        validationState.rejected.add(id);
        emit("RESOURCE_REJECTED", { resourceId: id, source: candidate.source, reason: response.ok ? "not_a_resource" : `http_${response.status}` });
        try { console.info(`[RESOURCE] pid ${id} rejeitado`); } catch (_) {}
      }
    } catch (error) {
      validationState.rejected.add(id);
      emit("RESOURCE_REJECTED", { resourceId: id, source: candidate.source, reason: "request_failed" });
    }
  }

  async function validateAllCandidates() {
    if (validationState.running || !validationState.template) return;
    validationState.running = true;
    const generation = validationState.generation;
    try {
      const pending = [...validationState.candidates.values()].filter((candidate) => !validationState.validated.has(candidate.resourceId) && !validationState.rejected.has(candidate.resourceId));
      let cursor = 0;
      async function worker() {
        while (cursor < pending.length) {
          const candidate = pending[cursor++];
          if (generation !== validationState.generation) return;
          await validateCandidate(candidate, generation);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }
      await Promise.all(Array.from({ length: Math.min(VALIDATION_CONCURRENCY, pending.length) }, () => worker()));
      emit("VALIDATION_COMPLETE", {
        candidates: validationState.candidates.size,
        validated: validationState.validated.size,
        rejected: validationState.rejected.size,
        capturedAt: new Date().toISOString(),
      });
    } finally {
      validationState.running = false;
    }
  }

  let validationTimer = null;
  function scheduleValidation() {
    if (!validationState.template || validationTimer) return;
    validationTimer = setTimeout(() => {
      validationTimer = null;
      validateAllCandidates();
    }, 350);
  }

  function visibleBucketTargets() {
    const output = new Map();
    const elements = document.querySelectorAll ? document.querySelectorAll("body *") : [];
    for (let index = 0; index < Math.min(elements.length, 10000); index += 1) {
      const element = elements[index];
      if (element.children && element.children.length > 4) continue;
      const label = cleanBucketLabel(element.textContent);
      if (!label || String(element.textContent || "").replace(/\s+/g, " ").trim().length > 60) continue;
      const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
      if (!rect || rect.width <= 0 || rect.height <= 0 || rect.left > Math.min(620, window.innerWidth * 0.45)) continue;
      const treeTarget = element.closest && element.closest('[role="treeitem"],li,[class*="tree-node" i],[class*="tree_item" i]');
      const target = treeTarget || element;
      const exact = String(element.textContent || "").replace(/\s+/g, " ").trim().toUpperCase() === label.toUpperCase();
      const score = (exact ? 100 : 0) + (treeTarget ? 60 : 0) + (rect.left < 360 ? 25 : 0) - Math.min(20, rect.left / 50);
      const previous = output.get(label);
      if (!previous || score > previous.score) output.set(label, { element: target, score });
    }
    return [...output.entries()].map(([bucket, entry]) => ({ bucket, element: entry.element }));
  }

  async function fastBucketSweep() {
    if (validationState.fastSweepRunning) return;
    validationState.fastSweepRunning = true;
    validationState.bucketMode = true;
    try {
      const targets = visibleBucketTargets();
      emit("FAST_SWEEP_STARTED", { total: targets.length, capturedAt: new Date().toISOString() });
      for (let index = 0; index < targets.length; index += 1) {
        const { bucket, element } = targets[index];
        validationState.currentBucket = bucket;
        emit("BUCKET_CAPTURE_START", { bucket, position: index + 1, total: targets.length, capturedAt: new Date().toISOString() });
        try {
          element.scrollIntoView({ block: "nearest", inline: "nearest" });
          element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          element.click();
        } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 900));
        validationState.currentBucket = detectCurrentBucket() || bucket;
        const resourceIds = scanDOM(validationState.currentBucket);
        emit("BUCKET_CAPTURE_COMPLETE", {
          bucket: validationState.currentBucket,
          requestedBucket: bucket,
          resourceIds: [...new Set(resourceIds)],
          position: index + 1,
          total: targets.length,
          capturedAt: new Date().toISOString(),
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      scheduleValidation();
      emit("FAST_SWEEP_COMPLETE", { total: targets.length, candidates: validationState.candidates.size, capturedAt: new Date().toISOString() });
    } finally {
      validationState.fastSweepRunning = false;
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.direction !== "extension-to-page") return;
    if (message.command === "SCAN_RESOURCES") scanAllSources();
    if (message.command === "VALIDATE_RESOURCES") {
      scanAllSources();
      validateAllCandidates();
    }
    if (message.command === "FAST_BUCKET_SWEEP" && window === window.top) fastBucketSweep();
    if (message.command === "BUCKET_RESET") {
      validationState.candidates.clear();
      validationState.validated.clear();
      validationState.rejected.clear();
      validationState.generation += 1;
      validationState.running = false;
      validationState.bucketMode = true;
      validationState.currentBucket = detectCurrentBucket();
      scanCurrentBucketSources();
    }
    if (message.command === "CLEAR_MEMORY") {
      validationState.candidates.clear();
      validationState.validated.clear();
      validationState.rejected.clear();
      validationState.template = null;
      validationState.bucketMode = false;
      validationState.currentBucket = "";
      validationState.generation += 1;
      validationState.running = false;
    }
  });

  emit("HOOK_READY", {
    version: core.VERSION,
    capturedAt: new Date().toISOString(),
    frame: window === window.top ? "top" : "child",
    transports: { fetch: Boolean(nativeFetch), xhr: true, websocket: Boolean(NativeWebSocket), eventsource: Boolean(NativeEventSource) },
  });

  const scheduleScan = (delay) => setTimeout(scanAllSources, delay);
  scheduleScan(750);
  scheduleScan(3000);
  scheduleScan(8000);
  setInterval(scanAllSources, 15000);
  setInterval(emitBucketContext, 2500);
})();
