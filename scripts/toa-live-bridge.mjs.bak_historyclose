import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEBUG_ORIGIN = process.env.DOMINIUM_TOA_DEBUG_ORIGIN || 'http://127.0.0.1:9341';
const INGEST_URL = process.env.DOMINIUM_TOA_INGEST_URL || 'http://127.0.0.1:8765/api/toa-datalake/ingest';
const POLL_MS = Math.max(5000, Number(process.env.DOMINIUM_TOA_POLL_MS || 10000));
const HEARTBEAT_MS = 40000;
const previous = new Map();
let lastIngestAt = 0;
const LOCK_FILE = resolve('data/toa-live-bridge.pid');

async function acquireLock() {
  await mkdir(dirname(LOCK_FILE), { recursive: true });
  try {
    const existing = Number((await readFile(LOCK_FILE, 'utf8')).trim());
    if (Number.isInteger(existing) && existing > 0) {
      try {
        process.kill(existing, 0);
        process.stdout.write(`[TOA LIVE] Ponte ja esta ativa no processo ${existing}.\n`);
        return false;
      } catch {}
    }
  } catch {}
  await writeFile(LOCK_FILE, String(process.pid), 'utf8');
  const release = () => rm(LOCK_FILE, { force: true }).catch(() => {});
  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(0); });
  process.once('SIGTERM', () => { release(); process.exit(0); });
  return true;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const SNAPSHOT_SCRIPT = String.raw`(() => {
  const activities = [];
  const resourceName = new Map();
  const resourceLogin = new Map();
  for (const row of document.querySelectorAll('.toaGantt-provTree .toaGantt-tl[par_pid]')) {
    const pid = String(row.getAttribute('par_pid') || '').trim();
    const name = String(row.querySelector('.toaGantt-tb-name')?.innerText || '')
      .replace(/\s+/g, ' ').trim();
    const login = String(row.getAttribute('data-login') || row.dataset?.login || '').trim();
    if (pid && name) resourceName.set(pid, name);
    if (pid && login) resourceLogin.set(pid, login);
  }
  for (const element of document.querySelectorAll('.toaGantt-timeChart .toaGantt-tb[data-id^="a_"]')) {
    const pid = String(element.getAttribute('par_pid') || '').trim();
    const aid = String(element.getAttribute('aid') || element.dataset.id || '').replace(/\D/g, '');
    if (!aid) continue;
    activities.push({
      activity_id: aid,
      technician_id: pid,
      technician_name: resourceName.get(pid) || '',
      technician_login: resourceLogin.get(pid) || '',
      status: String(element.dataset.activityStatus || ''),
      scheduled_date: String(element.getAttribute('par_date') || ''),
      start_min: String(element.getAttribute('start') || ''),
      duration_min: String(element.getAttribute('dur') || ''),
      travel_min: String(element.getAttribute('travel_time') || element.dataset.travelTime || ''),
      route_position: String(element.getAttribute('route_position') || element.dataset.routePosition || ''),
      activity_type: String(element.dataset.activityType || ''),
      description: String(element.innerText || element.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ').trim(),
    });
  }
  const body = String(document.body?.innerText || '');
  const allBuckets = /\bALL_BUCKETS\b/i.test(body);
  const bucket = allBuckets ? '' : (body.match(/\b(?:PWM|NTL|FTZ|MRO|JCR)-DMV(?:_[A-Z0-9]+)?\b/) || [''])[0];
  return { activities, bucket, all_buckets: allBuckets, title: document.title, url: location.href };
})()`;

const HISTORY_HOOK_SCRIPT = String.raw`(() => {
  if (window.__dominiumHistoryHookInstalled) return true;
  window.__dominiumHistoryHookInstalled = true;
  window.__dominiumHistoryQueue = window.__dominiumHistoryQueue || [];
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__dominiumUrl = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const url = String(this.__dominiumUrl || '');
    if (/m=activity.*a=history/i.test(url)) {
      const requestBody = String(body || '');
      this.addEventListener('loadend', () => {
        try {
          if (this.status !== 200) return;
          const data = JSON.parse(String(this.responseText || '{}'));
          const rows = data?.activityHistory?.rows;
          const aid = new URLSearchParams(requestBody).get('aid') || '';
          if (aid && Array.isArray(rows)) window.__dominiumHistoryQueue.push({ activity_id: aid, rows });
        } catch {}
      }, { once: true });
    }
    return originalSend.call(this, body);
  };
  return true;
})()`;

const HISTORY_DRAIN_SCRIPT = String.raw`(() => {
  return Array.isArray(window.__dominiumHistoryQueue)
    ? window.__dominiumHistoryQueue.splice(0) : [];
})()`;

function compact(value, limit = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function service(value) {
  return compact(value, 600).replace(/^🏢/, '').replace(/\s+activity$/i, '')
    .split(',', 1)[0].trim().slice(0, 180);
}

function normalize(raw, bucket) {
  const activityId = String(raw.activity_id || '').replace(/\D/g, '');
  if (!/^\d{5,18}$/.test(activityId)) return null;
  return {
    activity_id: activityId,
    technician_id: compact(raw.technician_id, 80),
    technician_name: compact(raw.technician_name, 180),
    technician_login: compact(raw.technician_login, 80),
    status: compact(raw.status || 'pending', 40).toLowerCase(),
    scheduled_date: compact(raw.scheduled_date, 10),
    start_min: compact(raw.start_min, 20),
    duration_min: compact(raw.duration_min, 20),
    travel_min: compact(raw.travel_min, 20),
    route_position: compact(raw.route_position, 20),
    activity_type: compact(raw.activity_type, 80),
    description: service(raw.description),
    bucket: compact(bucket, 120),
  };
}

async function pageTarget() {
  const response = await fetch(`${DEBUG_ORIGIN}/json/list`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Chrome respondeu ${response.status}`);
  const targets = await response.json();
  return targets.find((target) => target.type === 'page'
    && String(target.url || '').includes('clarobrasil.etadirect.com'));
}

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout lendo a Console')), 8000);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data || '{}'));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.error || message.result?.exceptionDetails) reject(new Error('Falha lendo o DOM da Console'));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  socket.close();
  return result;
}

async function post(activities, visibleIds) {
  const response = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      // O DOM do Oracle e virtualizado e contem somente as linhas visiveis.
      // Ele complementa dados/historico, mas nao pode substituir o retrato
      // completo coletado pelo Time/get.
      source: 'toa-dom-fallback',
      observed_at: new Date().toISOString(),
      activities,
      snapshot_complete: false,
      collector: 'toa-dom',
      collector_details: { visible_rows: visibleIds.length },
    }),
  });
  if (!response.ok) throw new Error(`DOMINIUM local respondeu ${response.status}`);
  const result = await response.json();
  if (!result?.ok) throw new Error(result?.error || 'Falha de ingestão local');
  lastIngestAt = Date.now();
}

async function postHistory(history) {
  const response = await fetch(INGEST_URL.replace(/\/ingest$/, '/ingest-history'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...history, observed_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Historico local respondeu ${response.status}`);
}

async function collect() {
  const target = await pageTarget();
  if (!target) throw new Error('Console de Alocação não encontrada');
  await evaluate(target, HISTORY_HOOK_SCRIPT);
  const snapshot = await evaluate(target, SNAPSHOT_SCRIPT);
  const histories = await evaluate(target, HISTORY_DRAIN_SCRIPT);
  for (const history of histories || []) await postHistory(history);
  const rows = (snapshot?.activities || []).map((row) => normalize(row, snapshot.bucket)).filter(Boolean);
  if (!rows.length) throw new Error('Console aberta, mas nenhuma atividade foi encontrada');

  const changed = [];
  for (const row of rows) {
    const fingerprint = JSON.stringify(row);
    if (previous.get(row.activity_id) !== fingerprint) changed.push(row);
    previous.set(row.activity_id, fingerprint);
  }
  const heartbeatDue = Date.now() - lastIngestAt >= HEARTBEAT_MS;
  const outgoing = changed.length ? changed : heartbeatDue ? rows.slice(0, 1) : [];
  if (outgoing.length) await post(outgoing, rows.map((row) => row.activity_id));
  return { total: rows.length, changed: changed.length, histories: (histories || []).length,
    allBuckets: Boolean(snapshot.all_buckets) };
}

async function main() {
  if (!await acquireLock()) return;
  process.stdout.write('[TOA LIVE] Ponte DOM iniciada; nenhuma extensão é necessária.\n');
  for (;;) {
    try {
      const result = await collect();
      process.stdout.write(`[TOA LIVE] ${result.total} visíveis · ${result.changed} alteradas · ${result.histories} históricos · ${result.allBuckets ? 'ALL_BUCKETS' : 'bucket atual'}\n`);
    } catch (error) {
      process.stderr.write(`[TOA LIVE] ${error.message}\n`);
    }
    await delay(POLL_MS);
  }
}

main();
