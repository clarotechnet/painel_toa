// background.js — TOA TechNet Bridge
// Proxy HTTP para bridge local

const BOT_BRIDGE_PORT = 8787;
const BOT_BRIDGE_TOKEN = '';
const DEFAULT_CLOUD_BASE_URL = 'https://dominium-toa-bridge.dominium-toa-cloud-bridge.workers.dev';
const DEFAULT_COLLECTOR_ID = 'central-toa';
const CLOUD_CONFIG_KEYS = [
  'dominiumCloudEnabled',
  'dominiumCloudBaseUrl',
  'dominiumCollectorToken',
  'dominiumCollectorId',
];

const BRIDGE_HOSTS_CANDIDATES = [
  'localhost',
  '127.0.0.1',
];

let _resolvedHost = null;
let _lastProbeAt = 0;
const PROBE_TTL_MS = 60_000;
const ATLAS_TAB_PATTERN = 'https://www.atlas.netservicos.com.br/*';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

let _creatingOffscreenDocument = null;

async function hasOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [documentUrl],
    });
    return contexts.length > 0;
  }

  const matchedClients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  });
  return matchedClients.some((client) => client.url === documentUrl);
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (_creatingOffscreenDocument) return _creatingOffscreenDocument;

  _creatingOffscreenDocument = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['WORKERS'],
        justification: 'Relogio confiavel para acordar a fila Atlas em abas ocultas.',
      });
    } catch (error) {
      // Duas inicializacoes do worker podem disputar a criacao. So propagar se
      // realmente nao houver um documento offscreen depois da tentativa.
      if (!(await hasOffscreenDocument())) throw error;
    }
  })();

  try {
    await _creatingOffscreenDocument;
  } finally {
    _creatingOffscreenDocument = null;
  }
}

async function probeHost(host, timeout = 1500) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const resp = await fetch(
      `http://${host}:${BOT_BRIDGE_PORT}/toa/health`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

async function getHost() {
  const now = Date.now();
  if (_resolvedHost && (now - _lastProbeAt) < PROBE_TTL_MS) return _resolvedHost;

  for (const host of BRIDGE_HOSTS_CANDIDATES) {
    if (await probeHost(host)) {
      console.log(`[bridge] host resolvido: ${host}`);
      _resolvedHost = host;
      _lastProbeAt = now;
      return host;
    }
  }

  console.warn('[bridge] nenhum host respondeu — usando 127.0.0.1 como fallback');
  _resolvedHost = '127.0.0.1';
  _lastProbeAt = now;
  return _resolvedHost;
}

async function bridgeFetch(path, options = {}) {
  if (String(path || '').startsWith('/cloud/')) {
    return cloudFetch(String(path).slice('/cloud'.length), options);
  }
  const host = await getHost();
  const url = `http://${host}:${BOT_BRIDGE_PORT}${path}`;

  const headers = {
    'content-type': 'application/json',
    ...(BOT_BRIDGE_TOKEN ? { 'x-toa-token': BOT_BRIDGE_TOKEN } : {}),
    ...(options.headers || {})
  };

  try {
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });
    
    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    
    return { ok: resp.ok, data, status: resp.status };
  } catch (e) {
    _resolvedHost = null;
    throw e;
  }
}

// Ping periódico
// Timers de abas ocultas sao limitados pelo Chrome e podem levar cerca de um
// minuto para buscar uma consulta Atlas. O service worker envia um evento de
// extensao; o content script eleito como lider executa a fila imediatamente.
async function wakeAtlasTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ATLAS_TAB_PATTERN });
  } catch {
    return;
  }

  let delivered = 0;
  await Promise.all(tabs.map((tab) => new Promise((resolve) => {
    if (!Number.isInteger(tab?.id)) {
      resolve();
      return;
    }
    chrome.tabs.sendMessage(
      tab.id,
      { action: 'atlas_tick', sentAt: Date.now() },
      (response) => {
        // Ler lastError evita aviso quando a pagina ainda esta carregando.
        const error = chrome.runtime.lastError;
        if (!error && response?.ok === true) delivered += 1;
        resolve();
      }
    );
  })));

  // O health nao deve depender do MAIN terminar uma consulta paginada, mas
  // tambem nao pode fingir que o Atlas esta aberto. So pinga se pelo menos um
  // content script Atlas confirmou o recebimento do tick.
  if (delivered > 0) {
    try {
      await bridgeFetch('/atlas/ping', {
        method: 'POST',
        body: JSON.stringify({
          source: 'atlas-extension-bg',
          tabCount: delivered,
        }),
      });
    } catch {}
  }

  return delivered;
}

async function cloudConfig() {
  const stored = await chrome.storage.local.get(CLOUD_CONFIG_KEYS);
  const baseUrl = String(stored.dominiumCloudBaseUrl || DEFAULT_CLOUD_BASE_URL).trim().replace(/\/+$/, '');
  let parsed = null;
  try { parsed = baseUrl ? new URL(baseUrl) : null; } catch {}
  const allowed = parsed && parsed.protocol === 'https:' && parsed.hostname.endsWith('.workers.dev');
  return {
    enabled: stored.dominiumCloudEnabled === true,
    baseUrl: allowed ? baseUrl : '',
    token: String(stored.dominiumCollectorToken || '').trim(),
    collectorId: String(stored.dominiumCollectorId || DEFAULT_COLLECTOR_ID).trim() || DEFAULT_COLLECTOR_ID,
  };
}

async function ensureCloudDefaults() {
  const stored = await chrome.storage.local.get(CLOUD_CONFIG_KEYS);
  const defaults = {};
  if (!String(stored.dominiumCloudBaseUrl || '').trim()) {
    defaults.dominiumCloudBaseUrl = DEFAULT_CLOUD_BASE_URL;
  }
  if (!String(stored.dominiumCollectorId || '').trim()) {
    defaults.dominiumCollectorId = DEFAULT_COLLECTOR_ID;
  }
  if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
}

async function cloudFetch(path, options = {}) {
  const config = await cloudConfig();
  if (!config.enabled || !config.baseUrl || !config.token) {
    return { ok: false, status: 503, data: { ok: false, error: 'cloud_bridge_not_configured' } };
  }
  let requestPath = String(path || '/');
  if (requestPath === '/v1/collector/jobs/next') {
    requestPath += `?collector_id=${encodeURIComponent(config.collectorId)}`;
  }
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.token}`,
    ...(options.headers || {}),
  };
  const response = await fetch(`${config.baseUrl}${requestPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
}

wakeAtlasTabs().catch(() => {});
ensureOffscreenDocument().catch((error) => {
  console.warn('[atlas] falha ao criar documento offscreen:', error?.message || error);
});

chrome.runtime.onStartup.addListener(() => {
  ensureCloudDefaults().catch(() => {});
  ensureOffscreenDocument().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  ensureCloudDefaults().catch(() => {});
  ensureOffscreenDocument().catch(() => {});
});

// Message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'offscreen_atlas_tick') {
    wakeAtlasTabs()
      .then((delivered) => {
        sendResponse({ ok: true, delivered });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'bridge_fetch') {
    bridgeFetch(message.path, message.options || {})
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }

  if (message.action === 'cloud_bridge_status') {
    cloudConfig()
      .then(config => sendResponse({
        ok: true,
        enabled: config.enabled,
        configured: Boolean(config.baseUrl && config.token),
        baseUrl: config.baseUrl,
        collectorId: config.collectorId,
      }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'captureTab') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
      sendResponse({ dataUrl });
    });
    return true;
  }

  if (message.action === 'reinject') {
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['content-isolated.js'] });
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['content-main.js'] });
    return false;
  }
});
