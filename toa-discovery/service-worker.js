"use strict";

const CHANNEL = "TOA_DISCOVERY_V1";
const STORAGE_KEY = "toaDiscoveryStateV1";
const VERSION = "0.4.0";
const LOCAL_INGEST_URL = "http://127.0.0.1:8765/api/toa-datalake/ingest";
const MAX_ITEMS = 5000;
const MAX_ENDPOINTS = 500;
const MAX_FIELDS = 3000;
const MAX_ERRORS = 500;

function emptyState() {
  const now = new Date().toISOString();
  return {
    metadata: {
      version: VERSION,
      source: "TOA Discovery document_start",
      sanitized: true,
      captureActive: false,
      startedAt: now,
      lastSeen: now,
      resourcesFound: 0,
      resourcesValidated: 0,
      resourcesRejected: 0,
      bucketMode: false,
      currentBucket: "",
      validationTemplateReady: false,
      hookFrames: 0,
      note: "Credenciais, headers de autenticação, payload bruto e dados pessoais não são persistidos.",
    },
    resources: [],
    activities: [],
    events: [],
    routes: [],
    endpoints: [],
    fields: [],
    errors: [],
    candidates: [],
    buckets: [],
    currentBucketResourceIds: [],
  };
}

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] || emptyState();
  state.metadata = { ...emptyState().metadata, ...(state.metadata || {}) };
  state.metadata.version = VERSION;
  state.buckets = Array.isArray(state.buckets) ? state.buckets : [];
  state.currentBucketResourceIds = Array.isArray(state.currentBucketResourceIds) ? state.currentBucketResourceIds : [];
  return state;
}

async function saveState(state) {
  state.metadata.lastSeen = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function mergeByKey(target, incoming, keyBuilder, limit) {
  const map = new Map(target.map((item) => [keyBuilder(item), item]));
  for (const item of incoming || []) {
    const key = keyBuilder(item);
    if (!key) continue;
    map.set(key, { ...(map.get(key) || {}), ...item });
    if (map.size >= limit) break;
  }
  return [...map.values()];
}

function mergeResources(target, incoming) {
  const map = new Map((target || []).map((item) => [String(item.resourceId || ""), item]));
  const rank = { observed_tree: 1, observed_payload: 2, hint_provider_no_login: 3, hint_provider: 4 };
  for (const item of incoming || []) {
    const key = String(item && item.resourceId || "");
    if (!key) continue;
    const previous = map.get(key) || {};
    const merged = { ...previous };
    for (const [field, value] of Object.entries(item)) {
      if (value !== "" && value !== null && value !== undefined) merged[field] = value;
      else if (!(field in merged)) merged[field] = value;
    }
    if ((rank[previous.validation] || 0) > (rank[item.validation] || 0)) merged.validation = previous.validation;
    map.set(key, merged);
    if (map.size >= MAX_ITEMS) break;
  }
  return [...map.values()];
}

function bucketName(value) {
  return String(value || "").replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 60);
}

function candidateResource(candidate) {
  if (!candidate || !candidate.resourceId || !candidate.name) return null;
  return {
    ...candidate,
    resourceId: String(candidate.resourceId),
    userId: String(candidate.userId || ""),
    login: String(candidate.login || ""),
    name: String(candidate.name || "").slice(0, 160),
    statusRota: String(candidate.statusRota || ""),
    resourceType: String(candidate.resourceType || ""),
    accountStatus: String(candidate.accountStatus || ""),
    availabilityStatus: String(candidate.availabilityStatus || ""),
    active: candidate.active ?? "",
    loginDisponivel: Boolean(candidate.login),
    situacaoCadastro: candidate.login ? "login_disponivel" : "aguardando_login",
    validation: candidate.validation || "observed_tree",
    capturedAt: candidate.capturedAt || new Date().toISOString(),
  };
}

function trackBucketResources(state, rawBucket, items) {
  const name = bucketName(rawBucket || state.metadata.currentBucket);
  if (!name || !state.metadata.bucketMode) return;
  const ids = (items || []).map((item) => String(item && item.resourceId || item || "")).filter(Boolean);
  state.currentBucketResourceIds = [...new Set([...(state.currentBucketResourceIds || []), ...ids])];
}

function hydrateBuckets(state, resource) {
  const id = String(resource && resource.resourceId || "");
  if (!id) return;
  for (const bucket of state.buckets || []) {
    if (!(bucket.resourceIds || []).map(String).includes(id)) continue;
    bucket.resources = mergeResources(bucket.resources || [], [{ ...resource, bucket: bucket.name }]);
    bucket.pendingDetails = Math.max(0, (bucket.resourceIds || []).length - bucket.resources.length);
  }
}

function saveBucketFromIds(state, rawName, resourceIds, detectedBucket) {
  const name = bucketName(rawName);
  if (!name) return { error: "Informe o nome do bucket." };
  const ids = [...new Set((resourceIds || []).map(String).filter(Boolean))];
  const resources = (state.resources || []).filter((resource) => ids.includes(String(resource.resourceId || "")));
  let bucket = (state.buckets || []).find((item) => String(item.name || "").toLowerCase() === name.toLowerCase());
  if (!bucket) {
    bucket = { name, savedAt: new Date().toISOString(), resourceIds: [], resources: [] };
    state.buckets.push(bucket);
  }
  const before = (bucket.resources || []).length;
  bucket.resourceIds = [...new Set([...(bucket.resourceIds || []).map(String), ...ids])];
  bucket.resources = mergeResources(bucket.resources || [], resources.map((resource) => ({ ...resource, bucket: name })));
  bucket.savedAt = new Date().toISOString();
  bucket.detectedBucket = bucketName(detectedBucket || name);
  bucket.pendingDetails = Math.max(0, bucket.resourceIds.length - bucket.resources.length);
  state.metadata.currentBucket = name;
  state.metadata.lastBucketSavedAt = bucket.savedAt;
  state.metadata.bucketMode = true;
  return { name, added: Math.max(0, bucket.resources.length - before), total: bucket.resources.length, candidates: bucket.resourceIds.length, pendingDetails: bucket.pendingDetails };
}

function mergeEndpoint(state, endpoint) {
  if (!endpoint || !endpoint.method || !endpoint.endpoint) return;
  const key = `${endpoint.method} ${endpoint.endpoint}`;
  const existing = state.endpoints.find((item) => `${item.method} ${item.endpoint}` === key);
  if (existing) {
    existing.calls = Number(existing.calls || 1) + 1;
    existing.responseBytes = Number(existing.responseBytes || 0) + Number(endpoint.responseBytes || 0);
    existing.lastSeen = endpoint.lastSeen || new Date().toISOString();
    existing.statuses = [...new Set([...(existing.statuses || []), endpoint.status].filter((value) => value !== undefined))];
    existing.parameters = [...new Set([...(existing.parameters || []), ...(endpoint.parameters || [])])].sort();
    existing.schema = [...new Set([...(existing.schema || []), ...(endpoint.schema || [])])].slice(0, 500).sort();
    if (existing.category === "unknown" && endpoint.category !== "unknown") existing.category = endpoint.category;
    return;
  }
  if (state.endpoints.length >= MAX_ENDPOINTS) return;
  state.endpoints.push({ ...endpoint, calls: 1, statuses: endpoint.status ? [endpoint.status] : [] });
}

function appendError(state, error) {
  const safe = {
    at: String(error.at || new Date().toISOString()),
    stage: String(error.stage || "capture").slice(0, 120),
    message: String(error.message || error.reason || "erro não identificado").slice(0, 300),
    resourceId: String(error.resourceId || "").slice(0, 20),
    source: String(error.source || "").slice(0, 120),
  };
  state.errors.push(safe);
  if (state.errors.length > MAX_ERRORS) state.errors.splice(0, state.errors.length - MAX_ERRORS);
}

function mergeSummary(state, summary) {
  mergeEndpoint(state, summary.endpoint);
  const incoming = (summary.resources || []).filter((item) => item && item.resourceId);
  const candidates = incoming.map((item) => ({ ...item, source: item.source || `NETWORK:${summary.endpoint?.endpoint || "unknown"}` }));
  state.candidates = mergeByKey(state.candidates, candidates, (item) => String(item.resourceId || ""), MAX_ITEMS);
  const resources = incoming.map(candidateResource).filter(Boolean);
  state.resources = mergeResources(state.resources, resources);
  trackBucketResources(state, summary.bucket, incoming);
  resources.forEach((resource) => hydrateBuckets(state, resource));
  state.metadata.resourcesFound = Math.max(Number(state.metadata.resourcesFound || 0), state.candidates.length, state.resources.length);
  state.activities = mergeByKey(state.activities, summary.activities, (item) => String(item.activityId || ""), MAX_ITEMS);
  state.events = mergeByKey(state.events, summary.events, (item) => [item.activityId, item.timestamp, item.kind, item.resourceId].join("|"), MAX_ITEMS);
  state.routes = mergeByKey(state.routes, summary.routes, (item) => [item.resourceId, item.activityId, item.routePosition].join("|"), MAX_ITEMS);
  state.fields = mergeByKey(state.fields, summary.fields, (item) => [item.canonical, item.type, item.path].join("|"), MAX_FIELDS);
}

function liveIngestPayload(snapshot) {
  const providerMap = new Map((snapshot.providers || []).map((item) => [String(item.technician_id || ""), item]));
  return {
    source: "toa-live-all-buckets",
    observed_at: snapshot.observed_at || new Date().toISOString(),
    activities: (snapshot.activities || []).map((activity) => {
      const provider = providerMap.get(String(activity.technician_id || "")) || {};
      return {
        ...activity,
        technician_login: provider.technician_login || "",
        technician_name: provider.technician_name || "",
        scheduled_date: snapshot.scheduled_date || "",
      };
    }),
  };
}

async function postLiveSnapshot(snapshot) {
  const payload = liveIngestPayload(snapshot);
  if (!payload.activities.length) return { ok: true, skipped: true };
  const response = await fetch(LOCAL_INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`DOMINIUM local respondeu ${response.status}`);
  return response.json();
}

let writeQueue = Promise.resolve();

function enqueueMutation(mutator) {
  writeQueue = writeQueue.then(async () => {
    const state = await loadState();
    await mutator(state);
    state.metadata.resourcesValidated = state.resources.length;
    await saveState(state);
    return state;
  });
  return writeQueue;
}

async function forwardCommand(command) {
  let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  tabs = tabs.filter((tab) => /^https:\/\/clarobrasil\.etadirect\.com\//i.test(tab.url || ""));
  if (!tabs.length) tabs = await chrome.tabs.query({ url: "https://clarobrasil.etadirect.com/*" });
  let delivered = 0;
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { scope: CHANNEL, command });
      delivered += 1;
    } catch (_) {}
  }
  return delivered;
}

async function reloadToaTabs() {
  const tabs = await chrome.tabs.query({ url: "https://clarobrasil.etadirect.com/*" });
  let reloaded = 0;
  for (const tab of tabs) {
    try {
      await chrome.tabs.reload(tab.id);
      reloaded += 1;
    } catch (_) {}
  }
  return reloaded;
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) await saveState(emptyState());
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.scope !== CHANNEL) return false;

  if (message.type === "GET_STATE") {
    loadState().then((state) => sendResponse({ ok: true, state })).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === "CLEAR_STATE") {
    Promise.all([saveState(emptyState()), forwardCommand("CLEAR_MEMORY")])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === "START_BUCKET_COLLECTION") {
    loadState().then(async (previous) => {
      const state = emptyState();
      state.metadata.captureActive = Boolean(previous.metadata && previous.metadata.captureActive);
      state.metadata.bridgeReady = Boolean(previous.metadata && previous.metadata.bridgeReady);
      state.metadata.bucketMode = true;
      state.metadata.currentBucket = String(message.bucket || previous.metadata && previous.metadata.currentBucket || "").slice(0, 60);
      await saveState(state);
      const delivered = await forwardCommand("BUCKET_RESET");
      const reloaded = await reloadToaTabs();
      sendResponse({ ok: delivered > 0 || reloaded > 0, delivered, reloaded, state });
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === "SAVE_BUCKET") {
    enqueueMutation(async (state) => {
      const name = bucketName(message.bucket || state.metadata.currentBucket);
      if (!name) {
        state.__bucketSaveResult = { error: "Informe o nome do bucket." };
        return;
      }
      let ids = [...(state.currentBucketResourceIds || [])];
      if (!ids.length) {
        const assigned = new Set((state.buckets || []).flatMap((bucket) => (bucket.resourceIds || (bucket.resources || []).map((resource) => resource.resourceId)).map(String)));
        ids = (state.resources || []).map((resource) => String(resource.resourceId || "")).filter((id) => id && !assigned.has(id));
      }
      state.__bucketSaveResult = saveBucketFromIds(state, name, ids, state.metadata.currentBucket);
    }).then((state) => {
      const result = state.__bucketSaveResult || {};
      delete state.__bucketSaveResult;
      saveState(state).then(() => sendResponse(result.error
        ? { ok: false, error: result.error }
        : { ok: true, ...result, buckets: state.buckets.length }));
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === "COMMAND") {
    forwardCommand(String(message.command || ""))
      .then((delivered) => sendResponse({ ok: delivered > 0, delivered }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  enqueueMutation(async (state) => {
    const type = String(message.type || "");
    const payload = message.payload || {};
    if (message.page) state.metadata.captureActive = true;
    if (type === "HOOK_READY") {
      state.metadata.captureActive = true;
      state.metadata.hookFrames = Number(state.metadata.hookFrames || 0) + 1;
      state.metadata.transports = payload.transports || state.metadata.transports || {};
    } else if (type === "BRIDGE_READY") {
      state.metadata.bridgeReady = true;
    } else if (type === "EXCHANGE") {
      mergeSummary(state, payload);
    } else if (type === "LIVE_SNAPSHOT") {
      state.metadata.liveBridgeLastSeen = payload.observed_at || new Date().toISOString();
      state.metadata.liveBridgeActivities = Number((payload.activities || []).length);
      state.metadata.liveBridgeGroup = String(payload.group_name || "").slice(0, 120);
      postLiveSnapshot(payload).then((result) => enqueueMutation(async (nextState) => {
        nextState.metadata.liveBridgeOnline = Boolean(result && result.ok);
        nextState.metadata.liveBridgeLastIngest = new Date().toISOString();
        nextState.metadata.liveBridgeError = "";
      })).catch((error) => enqueueMutation(async (nextState) => {
        nextState.metadata.liveBridgeOnline = false;
        nextState.metadata.liveBridgeError = String(error && error.message || error).slice(0, 240);
      }));
    } else if (type === "MODEL_ENTITIES") {
      mergeSummary(state, payload);
    } else if (type === "BUCKET_CONTEXT") {
      const nextBucket = bucketName(payload.bucket);
      if (nextBucket && nextBucket.toLowerCase() !== String(state.metadata.currentBucket || "").toLowerCase()) state.currentBucketResourceIds = [];
      state.metadata.currentBucket = nextBucket;
    } else if (type === "RESOURCE_CANDIDATES") {
      state.candidates = mergeByKey(state.candidates, payload.candidates, (item) => String(item.resourceId || ""), MAX_ITEMS);
      const observed = (payload.candidates || []).map(candidateResource).filter(Boolean);
      state.resources = mergeResources(state.resources, observed);
      trackBucketResources(state, payload.bucket, payload.candidates);
      observed.forEach((resource) => hydrateBuckets(state, resource));
      state.metadata.resourcesFound = Math.max(Number(payload.total || 0), state.candidates.length);
    } else if (type === "RESOURCE_VALIDATED") {
      const resource = { ...payload.resource, validation: payload.resource && payload.resource.login ? "hint_provider" : "hint_provider_no_login" };
      state.resources = mergeResources(state.resources, [resource]);
      for (const bucket of payload.buckets || []) trackBucketResources(state, bucket, [resource]);
      hydrateBuckets(state, resource);
    } else if (type === "RESOURCE_REJECTED") {
      const key = String(payload.resourceId || "");
      const existing = state.errors.some((item) => item.stage === "resource_validation" && item.resourceId === key);
      if (!existing) appendError(state, { ...payload, stage: "resource_validation", message: payload.reason, at: new Date().toISOString() });
      state.metadata.resourcesRejected = state.errors.filter((item) => item.stage === "resource_validation").length;
    } else if (type === "VALIDATION_TEMPLATE_READY") {
      state.metadata.validationTemplateReady = true;
      state.metadata.validationTemplateObservedAt = payload.observedAt || new Date().toISOString();
    } else if (type === "VALIDATION_COMPLETE") {
      state.metadata.resourcesFound = Number(payload.candidates || state.metadata.resourcesFound || 0);
      state.metadata.resourcesValidated = Number(payload.validated || state.resources.length);
      state.metadata.resourcesRejected = Number(payload.rejected || state.metadata.resourcesRejected || 0);
      state.metadata.lastValidationAt = payload.capturedAt || new Date().toISOString();
    } else if (type === "SCAN_COMPLETE") {
      state.metadata.resourcesFound = Math.max(Number(payload.candidateCount || 0), state.metadata.resourcesFound || 0);
      state.metadata.lastScanAt = payload.capturedAt || new Date().toISOString();
    } else if (type === "BUCKET_CAPTURE_START") {
      state.metadata.currentBucket = bucketName(payload.bucket);
      state.currentBucketResourceIds = [];
      state.metadata.fastSweepPosition = Number(payload.position || 0);
      state.metadata.fastSweepTotal = Number(payload.total || 0);
    } else if (type === "BUCKET_CAPTURE_COMPLETE") {
      const ids = [...new Set([...(state.currentBucketResourceIds || []), ...(payload.resourceIds || []).map(String)])];
      const result = saveBucketFromIds(state, payload.requestedBucket || payload.bucket, ids, payload.bucket);
      if (!result.error) state.metadata.lastFastBucket = result.name;
    } else if (type === "FAST_SWEEP_STARTED") {
      state.metadata.fastSweepRunning = true;
      state.metadata.fastSweepTotal = Number(payload.total || 0);
      state.metadata.fastSweepPosition = 0;
    } else if (type === "FAST_SWEEP_COMPLETE") {
      state.metadata.fastSweepRunning = false;
      state.metadata.lastFastSweepAt = payload.capturedAt || new Date().toISOString();
      state.metadata.fastSweepCandidates = Number(payload.candidates || 0);
    } else if (type === "CAPTURE_ERROR") {
      appendError(state, payload);
    }
  }).then(() => sendResponse && sendResponse({ ok: true })).catch(() => sendResponse && sendResponse({ ok: false }));
  return Boolean(sendResponse);
});
