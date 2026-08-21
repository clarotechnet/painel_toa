import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { detailReplayExpression, normalizeOracleDetail } from './toa-detail-reader.mjs';

const DEBUG_ORIGIN = process.env.DOMINIUM_TOA_DEBUG_ORIGIN || 'http://127.0.0.1:9341';
const API_ORIGIN = process.env.DOMINIUM_API_ORIGIN || 'http://127.0.0.1:8765';
const CYCLE_MS = Math.max(60_000, Number(process.env.DOMINIUM_TOA_CYCLE_MS || 60_000));
const BETWEEN_BUCKETS_MS = Math.max(1_000, Number(process.env.DOMINIUM_TOA_BUCKET_DELAY_MS || 1_000));
const DETAILS_PER_CYCLE = Math.max(1, Math.min(24, Number(process.env.DOMINIUM_TOA_DETAILS_PER_CYCLE || 12)));
const BETWEEN_DETAILS_MS = Math.max(250, Number(process.env.DOMINIUM_TOA_DETAIL_DELAY_MS || 350));
const DETAIL_TIMEOUT_MS = Math.max(3_000, Math.min(15_000, Number(process.env.DOMINIUM_TOA_DETAIL_TIMEOUT_MS || 8_000)));
const DETAIL_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.DOMINIUM_TOA_DETAIL_CONCURRENCY || 3)));
const LOCK_FILE = resolve('data/toa-monitor-collector.pid');
const BUSINESS_BUCKET = /^(?:FTZ|JCR|MRO|NPA|NTL|PWM|REC)-DMV(?:_[A-Z0-9]+)*$/i;
const AUXILIARY_TYPES = new Set([20, 23, 24, 25, 82, 111]);
const requestById = new Map();
const buckets = new Map();
const providerBuckets = new Map();
let requestTemplate = null;
let lastNetworkAt = 0;
let rpcId = 0;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const clean = (value, limit = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const isTimeGet = (url) => /[?&]m=Time(?:&|$)/i.test(url) && /[?&]a=get(?:&|$)/i.test(url);

const TIME_HOOK_SCRIPT = String.raw`(() => {
  if (window.__dominiumTimeHookInstalled) return true;
  window.__dominiumTimeHookInstalled = true;
  window.__dominiumTimeQueue = window.__dominiumTimeQueue || [];
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__dominiumMethod = String(method || 'GET');
    this.__dominiumUrl = String(url || '');
    this.__dominiumHeaders = {};
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    this.__dominiumHeaders[String(name || '')] = String(value || '');
    return setHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (/[?&]m=Time(?:&|$)/i.test(this.__dominiumUrl || '') && /[?&]a=get(?:&|$)/i.test(this.__dominiumUrl || '')) {
      const entry = { url: this.__dominiumUrl, method: this.__dominiumMethod,
        headers: this.__dominiumHeaders || {}, postData: String(body || '') };
      this.addEventListener('loadend', () => {
        entry.status = this.status;
        entry.responseText = String(this.responseText || '');
        window.__dominiumTimeQueue.push(entry);
      }, { once: true });
    }
    return send.call(this, body);
  };
  return true;
})()`;

const DRAIN_TIME_SCRIPT = String.raw`(() => Array.isArray(window.__dominiumTimeQueue)
  ? window.__dominiumTimeQueue.splice(0) : [])()`;

const CLICK_ALL_BUCKETS_SCRIPT = String.raw`(() => {
  const selectedGroup = document.querySelector('.resource-groups-item[data-group-id] .edt-row.edt-selected')
    ?.closest('.resource-groups-item[data-group-id]')?.getAttribute('data-group-id') || '';
  const elements = [...document.querySelectorAll('.resource-groups-item[data-group-id]')].filter((element) =>
    /^ALL_BUCKETS$/i.test(String(element.querySelector('.edt-group-name')?.innerText || '').trim()));
  const target = elements.find((element) => element.getAttribute('data-group-id') === selectedGroup)
    || elements[0];
  if (!target) return false;
  (target.querySelector('.edt-group-name') || target.querySelector('.edt-row') || target).click();
  return true;
})()`;

const CLICK_TRIGGER_BUCKET_SCRIPT = String.raw`(() => {
  const selected = document.querySelector('.resource-groups-item[data-group-id] .edt-row.edt-selected')
    ?.closest('.resource-groups-item[data-group-id]');
  const target = selected?.querySelector('button[data-label-pid]')
    || document.querySelector('button[data-label-pid]');
  if (!target) return false;
  target.click();
  return true;
})()`;

const DOM_BUCKET_MAP_SCRIPT = String.raw`(() => {
  const result = [];
  const group = [...document.querySelectorAll('.resource-groups-item[data-group-id]')].find((element) =>
    /^ALL_BUCKETS$/i.test(String(element.querySelector('.edt-group-name')?.innerText || '').trim()));
  if (!group) return result;
  for (const root of group.querySelectorAll('.edt-root > .edt-item[data-id]')) {
    const bucket = String(root.querySelector(':scope > .edt-row button[data-label-pid] .rtl-prov-name')?.innerText || '').trim();
    if (!/^(?:FTZ|JCR|MRO|NPA|NTL|PWM|REC)-DMV(?:_[A-Z0-9]+)*$/i.test(bucket)) continue;
    for (const item of root.querySelectorAll('.edt-item[data-id]')) {
      const providerId = String(item.getAttribute('data-id') || '').trim();
      const row = item.querySelector(':scope > .edt-row');
      const icon = row?.querySelector('.edt-icon[res-type]');
      if (providerId && String(icon?.getAttribute('res-type') || '') === '5') result.push([providerId, bucket]);
    }
  }
  return result;
})()`;

const ALL_BUCKETS_GROUP_SCRIPT = String.raw`(() => {
  const candidates = [...document.querySelectorAll('.resource-groups-item[data-group-id]')].filter((element) =>
    /^ALL_BUCKETS$/i.test(String(element.querySelector('.edt-group-name')?.innerText || '').trim()));
  const target = candidates.find((element) => element.querySelector('.edt-row.edt-selected')) || candidates[0];
  return String(target?.getAttribute('data-group-id') || '');
})()`;

const DOM_BUSINESS_BUCKETS_SCRIPT = String.raw`(() => {
  const result = new Map();
  const groups = [...document.querySelectorAll('.resource-groups-item[data-group-id]')].filter((element) =>
    /^ALL_BUCKETS$/i.test(String(element.querySelector('.edt-group-name')?.innerText || '').trim()));
  for (const group of groups) {
    for (const button of group.querySelectorAll('button[data-label-pid]')) {
      const name = String(button.innerText || '').trim();
      if (!/^(?:FTZ|JCR|MRO|NPA|NTL|PWM|REC)-DMV(?:_[A-Z0-9]+)*$/i.test(name)) continue;
      const providerId = String(button.getAttribute('data-label-pid')
        || button.closest('.edt-item[data-id]')?.getAttribute('data-id') || '').trim();
      if (providerId) result.set(providerId, name);
    }
  }
  return [...result];
})()`;

async function acquireLock() {
  await mkdir(dirname(LOCK_FILE), { recursive: true });
  try {
    const existing = Number((await readFile(LOCK_FILE, 'utf8')).trim());
    if (existing > 0) {
      try { process.kill(existing, 0); return false; } catch {}
    }
  } catch {}
  await writeFile(LOCK_FILE, String(process.pid), 'utf8');
  const release = () => rm(LOCK_FILE, { force: true }).catch(() => {});
  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(0); });
  process.once('SIGTERM', () => { release(); process.exit(0); });
  return true;
}

async function apiPost(path, payload) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`API local respondeu ${response.status}`);
  return response.json();
}

async function apiGet(path) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) throw new Error(`API local respondeu ${response.status}`);
  return response.json();
}

async function heartbeat(state, { error = '', records = 0, bucket = '', details = {} } = {}) {
  try {
    await apiPost('/api/v1/collector/heartbeat', {
      collector: 'toa-time-get', state, source: 'oracle-console-time-get', bucket,
      records, error: clean(error, 500), details, observed_at: new Date().toISOString(),
    });
  } catch {}
}

async function pageTarget() {
  const response = await fetch(`${DEBUG_ORIGIN}/json/list`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Chrome respondeu ${response.status}`);
  const targets = await response.json();
  return targets.find((target) => target.type === 'page'
    && String(target.url || '').includes('clarobrasil.etadirect.com'));
}

function parseBucketTree(data) {
  const parent = data?.p;
  if (parent && BUSINESS_BUCKET.test(clean(parent.n, 120))) {
    buckets.set(String(parent.z || data.pid || ''), clean(parent.n, 120));
  }
  for (const tree of Array.isArray(data?.trees) ? data.trees : []) {
    const updates = tree?.tree_updates;
    if (!updates || typeof updates !== 'object') continue;
    for (const [providerId, value] of Object.entries(updates)) {
      const name = clean(value?.n, 120);
      if (Number(value?.t) === 2 && BUSINESS_BUCKET.test(name)) buckets.set(providerId, name);
    }
    for (const [providerId, value] of Object.entries(updates)) {
      const parentId = String(value?.p || '');
      if (Number(value?.t) === 5 && buckets.has(parentId)) providerBuckets.set(providerId, buckets.get(parentId));
    }
  }
}

function normalizeTimeResponse(data, forcedBucket = '') {
  if (!data || typeof data !== 'object') throw new Error('Resposta Time/get invalida');
  if (data.errorNo === 'SESSION_DESTROYED' || data.error === 'SESSION_DESTROYED') {
    throw new Error('Sessao TOA expirada');
  }
  parseBucketTree(data);
  const delta = data.delta && typeof data.delta === 'object' ? data.delta : {};
  const providers = delta.providers && typeof delta.providers === 'object' ? delta.providers : {};
  const activities = delta.activities && typeof delta.activities === 'object' ? delta.activities : {};
  const bucket = clean(forcedBucket || data?.p?.n, 120);
  const isConsolidated = /^ALL_BUCKETS$/i.test(bucket);
  const date = clean(data?.p?.D || data?.paging_time, 20);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const rows = [];
  const timeline = [];
  for (const [activityId, raw] of Object.entries(activities)) {
    if (!raw || typeof raw !== 'object') continue;
    const aid = digits(activityId);
    const technician = providers[String(raw.p)] || {};
    if (!aid || !technician || typeof technician !== 'object' || !Object.keys(technician).length) continue;
    const description = clean(raw.L, 600).replace(/^[^\p{L}\p{N}]+/u, '').split(',', 1)[0];
    const row = {
      activity_id: aid, activity_type: clean(raw.t, 40), description,
      status: clean(raw.s || 'pending', 40).toLowerCase(), scheduled_date: isoDate,
      start_min: clean(raw.S, 20), duration_min: clean(raw.d, 20),
      travel_min: clean(raw.G, 20), route_position: clean(raw.i, 20),
      technician_id: clean(raw.p, 80), technician_name: clean(technician.n, 180),
      technician_login: clean(technician.U || technician.e, 80),
      // ALL_BUCKETS e um agrupador, nao a base real do tecnico. Se a arvore
      // delta nao trouxer o parentesco nesta rodada, enviamos vazio para o
      // banco preservar a classificacao real aprendida em leituras anteriores.
      bucket: providerBuckets.get(String(raw.p)) || (isConsolidated ? '' : bucket),
    };
    (AUXILIARY_TYPES.has(Number(raw.t)) ? timeline : rows).push(row);
  }
  return { rows, timeline, bucket, date: isoDate };
}

class CDPClient {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    socket.addEventListener('message', (event) => this.onMessage(event));
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data || '{}'));
    if (message.id && this.pending.has(message.id)) {
      const { resolve: resolveCall, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message || 'Falha CDP'));
      else resolveCall(message.result || {});
      return;
    }
    if (message.method === 'Network.requestWillBeSent') {
      const request = message.params?.request || {};
      if (isTimeGet(request.url || '')) {
        requestById.set(message.params.requestId, request);
        requestTemplate = {
          url: request.url, postData: request.postData || '',
          headers: Object.fromEntries(Object.entries(request.headers || {}).filter(([name]) =>
            ['content-type', 'x-requested-with', 'x-oa', 'x-platform', 'x-ofs-csrf-secure'].includes(name.toLowerCase()))),
        };
      }
    }
    if (message.method === 'Network.responseReceived') {
      const response = message.params?.response || {};
      if (isTimeGet(response.url || '') && Number(response.status) === 200) {
        this.captureResponse(message.params.requestId).catch(() => {});
      }
    }
  }

  call(method, params = {}, timeoutMs = 20_000) {
    const id = ++rpcId;
    return new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout CDP: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async captureResponse(requestId) {
    const result = await this.call('Network.getResponseBody', { requestId });
    const data = JSON.parse(result.body || '{}');
    parseBucketTree(data);
    lastNetworkAt = Date.now();
  }

  async evaluate(expression, timeoutMs = 60_000) {
    const result = await this.call('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, timeoutMs);
    if (result.exceptionDetails) throw new Error('Falha executando leitura dentro do TOA');
    return result.result?.value;
  }
}

async function connect() {
  const target = await pageTarget();
  if (!target?.webSocketDebuggerUrl) throw new Error('Aba TOA nao encontrada');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout conectando ao Chrome')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const client = new CDPClient(socket);
  await client.call('Network.enable');
  await client.call('Page.enable');
  await client.call('Page.addScriptToEvaluateOnNewDocument', { source: TIME_HOOK_SCRIPT });
  await client.evaluate(TIME_HOOK_SCRIPT);
  return { client, socket };
}

function replayExpression(providerId, selectedGroup = '') {
  const safe = {
    url: requestTemplate.url,
    headers: requestTemplate.headers,
    providerId: String(providerId),
    selectedGroup: String(selectedGroup),
    postData: requestTemplate.postData || '',
    date: new Date().toISOString().slice(0, 10),
  };
  return `(() => { const c=${JSON.stringify(safe)}; const body=new URLSearchParams(c.postData);`
    + `if(c.selectedGroup){body.set('parent','0');body.set('selectedGroup',c.selectedGroup);}`
    + `else if(c.providerId){body.set('parent',c.providerId);body.set('selectedGroup','0');}`
    + `body.set('qdate',c.date);`
    + `if(body.has('date'))body.set('date',c.date);if(body.has('dates[]'))body.set('dates[]',c.date);`
    + `return fetch(c.url,{method:'POST',credentials:'include',headers:c.headers,body:body.toString()})`
    + `.then(async r=>({status:r.status,text:await r.text()})); })()`;
}

function acceptHookEntry(entry) {
  if (!entry || Number(entry.status) !== 200 || !isTimeGet(entry.url || '')) return null;
  const data = JSON.parse(entry.responseText || '{}');
  parseBucketTree(data);
  const requestParams = new URLSearchParams(entry.postData || '');
  const selectedGroup = requestParams.get('selectedGroup') || '';
  requestTemplate = {
    url: new URL(entry.url, 'https://clarobrasil.etadirect.com/').href,
    postData: entry.postData || '',
    headers: Object.fromEntries(Object.entries(entry.headers || {}).filter(([name]) =>
      ['content-type', 'x-requested-with', 'x-oa', 'x-platform', 'x-ofs-csrf-secure'].includes(name.toLowerCase()))),
    consolidated: /^ALL_BUCKETS$/i.test(clean(data?.p?.n, 120)) || (selectedGroup && selectedGroup !== '0'),
  };
  return data;
}

async function waitForTemplate(client) {
  if (requestTemplate) return;
  await client.evaluate(TIME_HOOK_SCRIPT);
  // Primeiro aguardamos uma leitura natural emitida pelo Oracle. Isso mantem
  // a grade completamente parada na TV. A troca visual de bucket fica apenas
  // como fallback de descoberta quando a pagina nao emitir Time/get sozinha.
  const start = Date.now();
  while (!requestTemplate && Date.now() - start < 30_000) {
    for (const entry of await client.evaluate(DRAIN_TIME_SCRIPT) || []) acceptHookEntry(entry);
    await sleep(500);
  }
  if (requestTemplate) return;
  process.stdout.write('[TOA API] Sem leitura natural; ativando descoberta visual unica.\n');
  await client.evaluate(CLICK_TRIGGER_BUCKET_SCRIPT);
  await sleep(2_000);
  await client.evaluate(CLICK_ALL_BUCKETS_SCRIPT);
  const deadline = Date.now() + 45_000;
  while (!requestTemplate && Date.now() < deadline) {
    for (const entry of await client.evaluate(DRAIN_TIME_SCRIPT) || []) acceptHookEntry(entry);
    await sleep(1_000);
  }
  if (!requestTemplate) throw new Error('Aguardando o TOA emitir a leitura Time/get; nenhuma recarga foi executada');
}

async function collectCycle(client) {
  await waitForTemplate(client);
  // Depois de um relogin o Time/get inicial costuma ser apenas um delta. A
  // arvore renderizada, entretanto, ja contem os IDs oficiais dos buckets.
  // Descobri-los aqui permite reconstruir cada base e impede um delta parcial
  // de encolher a fotografia consolidada da TV.
  for (const pair of await client.evaluate(DOM_BUSINESS_BUCKETS_SCRIPT) || []) {
    if (Array.isArray(pair) && pair.length === 2) buckets.set(String(pair[0]), clean(pair[1], 120));
  }
  for (const pair of await client.evaluate(DOM_BUCKET_MAP_SCRIPT) || []) {
    if (Array.isArray(pair) && pair.length === 2) providerBuckets.set(String(pair[0]), clean(pair[1], 120));
  }
  const allBucketsGroup = await client.evaluate(ALL_BUCKETS_GROUP_SCRIPT);
  // O agrupador pode devolver apenas um delta dos recursos carregados na
  // grade. Quando a arvore oficial ja revelou os buckets, consultamos cada
  // bucket diretamente para obter base e fotografia completas.
  if ((requestTemplate.consolidated || allBucketsGroup) && !buckets.size) {
    const response = await client.evaluate(replayExpression('', allBucketsGroup));
    if (Number(response?.status) === 401 || Number(response?.status) === 403) throw new Error('Sessao TOA expirada');
    if (Number(response?.status) !== 200) throw new Error(`Time/get consolidado respondeu ${response?.status || 'sem status'}`);
    const parsed = normalizeTimeResponse(JSON.parse(response.text || '{}'), 'ALL_BUCKETS');
    const all = [...parsed.rows, ...parsed.timeline];
    if (!all.length) throw new Error('ALL_BUCKETS nao retornou atividades');
    await apiPost('/api/v1/ingest/snapshot', {
      source: 'toa-live-all-buckets', collector: 'toa-time-get', observed_at: new Date().toISOString(),
      // Sem a arvore de buckets, a resposta consolidada pode ser somente um
      // delta inicial apos relogin. Complementa o banco, mas jamais substitui
      // a ultima fotografia integral.
      activities: all, snapshot_complete: false,
      active_activity_ids: all.map((row) => row.activity_id),
      collector_details: { mode: 'ALL_BUCKETS', group: allBucketsGroup || 'captured', buckets: buckets.size, auxiliary: parsed.timeline.length },
    });
    await heartbeat('online', { records: all.length,
      details: { mode: 'ALL_BUCKETS', group: allBucketsGroup || 'captured', buckets: buckets.size,
        auxiliary: parsed.timeline.length, snapshot_ready: true } });
    process.stdout.write(`[TOA API] ${all.length} atividades · ALL_BUCKETS consolidado\n`);
    const detailResult = await enrichPriorityDetails(client, all);
    await heartbeat('online', { records: all.length,
      details: { mode: 'ALL_BUCKETS', group: allBucketsGroup || 'captured', buckets: buckets.size,
        auxiliary: parsed.timeline.length, enriched: detailResult.enriched, detail_failures: detailResult.failures, snapshot_ready: true } });
    return;
  }
  if (!buckets.size) throw new Error('Nenhum bucket DMV foi descoberto na arvore do TOA');
  const all = [];
  const seen = new Set();
  let auxiliary = 0;
  const failures = [];
  for (const [providerId, bucketName] of [...buckets].sort((a, b) => a[1].localeCompare(b[1]))) {
    try {
      const response = await client.evaluate(replayExpression(providerId));
      if (Number(response?.status) === 401 || Number(response?.status) === 403) throw new Error('Sessao TOA expirada');
      if (Number(response?.status) !== 200) throw new Error(`Time/get respondeu ${response?.status || 'sem status'}`);
      const parsed = normalizeTimeResponse(JSON.parse(response.text || '{}'), bucketName);
      auxiliary += parsed.timeline.length;
      for (const row of [...parsed.rows, ...parsed.timeline]) {
        const key = row.activity_id;
        if (seen.has(key)) continue;
        seen.add(key); all.push(row);
      }
    } catch (error) {
      failures.push(`${bucketName}: ${clean(error.message, 180)}`);
    }
    await sleep(BETWEEN_BUCKETS_MS);
  }
  if (!all.length) throw new Error(failures[0] || 'Time/get nao retornou atividades');
  await apiPost('/api/v1/ingest/snapshot', {
    source: 'toa-live-all-buckets', collector: 'toa-time-get', observed_at: new Date().toISOString(),
    // Uma rodada parcial nunca substitui a ultima fotografia integral.
    activities: all, snapshot_complete: failures.length === 0, active_activity_ids: [...seen],
    collector_details: { buckets: buckets.size, failed_buckets: failures.length, auxiliary },
  });
  await heartbeat(failures.length ? 'degraded' : 'online', {
    records: all.length, details: { buckets: buckets.size, failed_buckets: failures.length, auxiliary, snapshot_ready: true },
    error: failures.join(' | '),
  });
  process.stdout.write(`[TOA API] ${all.length} atividades · ${buckets.size} buckets · ${failures.length} falhas\n`);
  const detailResult = await enrichPriorityDetails(client, all);
  await heartbeat(failures.length ? 'degraded' : 'online', {
    records: all.length, details: { buckets: buckets.size, failed_buckets: failures.length, auxiliary,
      enriched: detailResult.enriched, detail_failures: detailResult.failures, snapshot_ready: true },
    error: failures.join(' | '),
  });
}

async function enrichPriorityDetails(client, activities) {
  let queue;
  try {
    queue = await apiGet('/api/toa-datalake/detail-queue?limit=1000');
  } catch (error) {
    return { enriched: 0, failures: 1, error: clean(error.message, 180) };
  }
  const activityById = new Map(activities.map((row) => [digits(row.activity_id), row]));
  // A fila do banco ja ordena iniciadas/em rota pela janela mais urgente.
  // Preservar essa ordem garante que um TEC1 potencial seja validado antes
  // de atividades comuns, em vez de ordenar pela agenda estimada da rota.
  const priority = (queue?.items || [])
    .map((item) => activityById.get(digits(item.activity_id)))
    .filter(Boolean)
    .slice(0, DETAILS_PER_CYCLE);
  let enriched = 0;
  let failures = 0;
  let cursor = 0;
  let sessionExpired = false;
  const worker = async () => {
    while (!sessionExpired) {
      const index = cursor;
      cursor += 1;
      if (index >= priority.length) return;
      const row = priority[index];
      try {
        const response = await client.evaluate(detailReplayExpression(row), DETAIL_TIMEOUT_MS);
        if (Number(response?.status) === 401 || Number(response?.status) === 403) throw new Error('Sessao TOA expirada');
        if (Number(response?.status) !== 200) throw new Error(`Detalhe TOA respondeu ${response?.status || 'sem status'}`);
        const detail = normalizeOracleDetail(JSON.parse(response.text || '{}'), row.activity_id);
        await apiPost('/api/v1/ingest/snapshot', {
          // O detalhe complementa contrato/OS/janela, mas nao e uma rodada do
          // coletor principal e nao deve zerar seu contador na telemetria.
          source: 'toa-live-detail-readonly', observed_at: new Date().toISOString(),
          details: [detail], snapshot_complete: false,
        });
        enriched += 1;
      } catch (error) {
        failures += 1;
        process.stderr.write(`[TOA DETAIL] ${row.activity_id}: ${clean(error.message, 220)}\n`);
        if (/sessao/i.test(error.message)) sessionExpired = true;
      }
      await sleep(BETWEEN_DETAILS_MS);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, priority.length) },
    () => worker(),
  ));
  if (priority.length) process.stdout.write(`[TOA DETAIL] ${enriched}/${priority.length} atividades enriquecidas\n`);
  return { enriched, failures };
}

async function main() {
  if (!await acquireLock()) return;
  process.stdout.write('[TOA API] Coletor Time/get iniciado em modo somente leitura.\n');
  for (;;) {
    let connection;
    try {
      await heartbeat('starting');
      connection = await connect();
      for (;;) {
        const cycleStartedAt = Date.now();
        await collectCycle(connection.client);
        // CYCLE_MS representa o intervalo entre inicios de rodada. Descontar o
        // tempo gasto na coleta evita transformar "a cada 1 min" em 2 min.
        await sleep(Math.max(5_000, CYCLE_MS - (Date.now() - cycleStartedAt)));
      }
    } catch (error) {
      await heartbeat(/sessao/i.test(error.message) ? 'authenticating' : 'error', { error: error.message });
      process.stderr.write(`[TOA API] ${clean(error.message, 500)}\n`);
      try { connection?.socket?.close(); } catch {}
      requestTemplate = null; buckets.clear(); providerBuckets.clear();
      await sleep(10_000);
    }
  }
}

main();
