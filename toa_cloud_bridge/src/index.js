import {
  BridgeInputError,
  jsonSize,
  normalizeContract,
  normalizeIdentifier,
  sanitizeOperationalSnapshot,
  sanitizeTelemetryBatch,
} from "./core.js";

const RESULT_TTL_SECONDS = 6 * 60 * 60;
const QUEUE_TTL_SECONDS = 30 * 60;
const LEASE_SECONDS = 45;
const MAX_RESULT_BYTES = 256 * 1024;

function nowIso(offsetSeconds = 0) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

async function bodyJson(request, maxBytes = MAX_RESULT_BYTES) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new BridgeInputError("body_too_large", "Corpo acima do limite");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new BridgeInputError("body_too_large", "Corpo acima do limite");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BridgeInputError("invalid_json", "JSON invalido");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeInputError("invalid_json", "O corpo deve ser um objeto JSON");
  }
  return value;
}

async function tokenMatches(supplied, expected) {
  if (!supplied || !expected) return false;
  const data = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", data.encode(supplied)),
    crypto.subtle.digest("SHA-256", data.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

async function requireRole(request, env, role) {
  const header = request.headers.get("authorization") || "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || "";
  const expected = role === "collector"
    ? env.DOMINIUM_COLLECTOR_TOKEN
    : role === "telemetry_collector"
      ? env.DOMINIUM_TELEMETRY_COLLECTOR_TOKEN
      : role === "mobile"
        ? env.DOMINIUM_MOBILE_TOKEN
        : env.DOMINIUM_PRIMARY_TOKEN;
  return tokenMatches(token, expected);
}

function publicJob(row, includeResult = false) {
  if (!row) return null;
  const job = {
    id: row.id,
    contract: row.contract,
    job_type: row.job_type,
    status: row.status,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    collector_id: row.collector_id || "",
    error_code: row.error_code || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || "",
    expires_at: row.expires_at,
  };
  if (includeResult && row.result_json) {
    try { job.result = JSON.parse(row.result_json); }
    catch { job.result = null; }
  }
  return job;
}

async function createLookup(request, env) {
  if (!await requireRole(request, env, "primary")) {
    return response({ ok: false, error: "unauthorized" }, 401);
  }
  const input = await bodyJson(request, 16 * 1024);
  const contract = normalizeContract(input.contract);
  const idempotencyKey = normalizeIdentifier(
    input.idempotency_key,
    `${contract}:${crypto.randomUUID()}`,
  );
  const requestedBy = normalizeIdentifier(input.requested_by, "dominium-primary");
  const createdAt = nowIso();
  const jobId = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO lookup_jobs (
      id, contract, job_type, status, idempotency_key, requested_by,
      attempts, max_attempts, created_at, updated_at, expires_at
    ) VALUES (?, ?, 'DOMINIUM_CONTRACT_LOOKUP', 'queued', ?, ?, 0, 6, ?, ?, ?)
  `).bind(
    jobId, contract, idempotencyKey, requestedBy,
    createdAt, createdAt, nowIso(QUEUE_TTL_SECONDS),
  ).run();

  const row = await env.DB.prepare(
    "SELECT * FROM lookup_jobs WHERE idempotency_key = ? LIMIT 1",
  ).bind(idempotencyKey).first();
  return response({ ok: true, job: publicJob(row, true) }, row?.id === jobId ? 201 : 200);
}

async function getLookup(request, env, jobId) {
  if (!await requireRole(request, env, "primary")) {
    return response({ ok: false, error: "unauthorized" }, 401);
  }
  normalizeIdentifier(jobId);
  const row = await env.DB.prepare(
    "SELECT * FROM lookup_jobs WHERE id = ? LIMIT 1",
  ).bind(jobId).first();
  if (!row) return response({ ok: false, error: "job_not_found" }, 404);
  return response({ ok: true, job: publicJob(row, true) });
}

async function leaseNext(request, env) {
  if (!await requireRole(request, env, "collector")) {
    return response({ ok: false, error: "unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const collectorId = normalizeIdentifier(url.searchParams.get("collector_id"), "central-toa");
  const current = nowIso();
  const leasedUntil = nowIso(LEASE_SECONDS);
  const row = await env.DB.prepare(`
    UPDATE lookup_jobs
       SET status = 'leased', collector_id = ?, attempts = attempts + 1,
           lease_expires_at = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM lookup_jobs
        WHERE expires_at > ?
          AND attempts < max_attempts
          AND (status = 'queued' OR (status = 'leased' AND lease_expires_at < ?))
        ORDER BY created_at ASC
        LIMIT 1
     )
    RETURNING *
  `).bind(collectorId, leasedUntil, current, current, current).first();

  return response({ ok: true, job: publicJob(row, false) });
}

async function completeLookup(request, env, jobId) {
  if (!await requireRole(request, env, "collector")) {
    return response({ ok: false, error: "unauthorized" }, 401);
  }
  normalizeIdentifier(jobId);
  const input = await bodyJson(request);
  const row = await env.DB.prepare(
    "SELECT * FROM lookup_jobs WHERE id = ? LIMIT 1",
  ).bind(jobId).first();
  if (!row) return response({ ok: false, error: "job_not_found" }, 404);
  if (row.status === "completed") {
    return response({ ok: true, job: publicJob(row, true), idempotent: true });
  }

  const completedAt = nowIso();
  if (input.ok === true) {
    const snapshot = sanitizeOperationalSnapshot(input.snapshot, row.contract);
    if (jsonSize(snapshot) > MAX_RESULT_BYTES) {
      throw new BridgeInputError("result_too_large", "Snapshot acima do limite");
    }
    await env.DB.prepare(`
      UPDATE lookup_jobs
         SET status = 'completed', result_json = ?, error_code = NULL,
             completed_at = ?, updated_at = ?, expires_at = ?, lease_expires_at = NULL
       WHERE id = ?
    `).bind(
      JSON.stringify(snapshot), completedAt, completedAt,
      nowIso(RESULT_TTL_SECONDS), jobId,
    ).run();
  } else {
    const errorCode = normalizeIdentifier(input.error_code ?? "toa_lookup_failed");
    const retryable = input.retryable === true && Number(row.attempts || 0) < Number(row.max_attempts || 0);
    await env.DB.prepare(`
      UPDATE lookup_jobs
         SET status = ?, error_code = ?, updated_at = ?,
             completed_at = ?, lease_expires_at = NULL
       WHERE id = ?
    `).bind(
      retryable ? "queued" : "failed", errorCode, completedAt,
      retryable ? null : completedAt, jobId,
    ).run();
  }

  const updated = await env.DB.prepare(
    "SELECT * FROM lookup_jobs WHERE id = ? LIMIT 1",
  ).bind(jobId).first();
  return response({ ok: true, job: publicJob(updated, true) });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicTelemetry(row, includePayload = false) {
  if (!row) return null;
  const item = {
    id: row.id,
    device_id: row.device_id,
    technician_key: row.technician_key,
    status: row.status,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
  if (includePayload) {
    try { item.payload = JSON.parse(row.payload_json || "null"); }
    catch { item.payload = null; }
  }
  return item;
}

async function enqueueTelemetry(request, env) {
  if (!await requireRole(request, env, "mobile")) return response({ ok: false, error: "unauthorized" }, 401);
  const input = await bodyJson(request, MAX_RESULT_BYTES);
  const payload = sanitizeTelemetryBatch(input);
  const encoded = JSON.stringify(payload);
  if (jsonSize(payload) > MAX_RESULT_BYTES) throw new BridgeInputError("body_too_large", "Lote de telemetria acima do limite");
  const resource = payload.resources[0];
  const fingerprint = payload.batch_id || encoded;
  const id = (await sha256Hex(fingerprint)).slice(0, 40);
  const now = nowIso();
  const expires = nowIso(3 * 24 * 60 * 60);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO telemetry_queue (
      id, device_id, technician_key, status, payload_json, attempts, max_attempts,
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, 'queued', ?, 0, 20, ?, ?, ?)
  `).bind(
    id, resource.device_id, resource.technician_login || resource.technician_id,
    encoded, now, now, expires,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM telemetry_queue WHERE id=? LIMIT 1").bind(id).first();
  return response({ ok: true, queued: true, telemetry: publicTelemetry(row, false) }, 202);
}

async function leaseTelemetry(request, env) {
  if (!await requireRole(request, env, "telemetry_collector")) return response({ ok: false, error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const collectorId = normalizeIdentifier(url.searchParams.get("collector_id"), "central-mobile");
  const current = nowIso();
  const leasedUntil = nowIso(5 * 60);
  const row = await env.DB.prepare(`
    UPDATE telemetry_queue
       SET status='leased', collector_id=?, attempts=attempts+1,
           lease_expires_at=?, updated_at=?
     WHERE id=(
       SELECT id FROM telemetry_queue
        WHERE expires_at>? AND attempts<max_attempts
          AND (status='queued' OR (status='leased' AND lease_expires_at<?))
        ORDER BY created_at ASC LIMIT 1
     )
    RETURNING *
  `).bind(collectorId, leasedUntil, current, current, current).first();
  return response({ ok: true, telemetry: publicTelemetry(row, true) });
}

async function ackTelemetry(request, env, telemetryId) {
  if (!await requireRole(request, env, "telemetry_collector")) return response({ ok: false, error: "unauthorized" }, 401);
  const input = await bodyJson(request, 16 * 1024);
  const row = await env.DB.prepare("SELECT * FROM telemetry_queue WHERE id=? LIMIT 1").bind(telemetryId).first();
  if (!row) return response({ ok: true, removed: true, idempotent: true });
  if (input.ok === true) {
    await env.DB.prepare("DELETE FROM telemetry_queue WHERE id=?").bind(telemetryId).run();
    return response({ ok: true, removed: true });
  }
  const retryable = input.retryable !== false && Number(row.attempts || 0) < Number(row.max_attempts || 0);
  const errorCode = normalizeIdentifier(input.error_code ?? "local_ingest_failed");
  await env.DB.prepare(`
    UPDATE telemetry_queue SET status=?, error_code=?, lease_expires_at=NULL, updated_at=? WHERE id=?
  `).bind(retryable ? "queued" : "failed", errorCode, nowIso(), telemetryId).run();
  return response({ ok: true, retryable });
}

async function cleanup(env) {
  const current = nowIso();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM lookup_jobs WHERE expires_at < ?").bind(current),
    env.DB.prepare("DELETE FROM telemetry_queue WHERE expires_at < ?").bind(current),
    env.DB.prepare(`
      UPDATE lookup_jobs
         SET status = 'failed', error_code = 'attempts_exhausted',
             completed_at = ?, updated_at = ?, lease_expires_at = NULL
       WHERE status IN ('queued', 'leased') AND attempts >= max_attempts
    `).bind(current, current),
  ]);
}

async function router(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === "GET" && url.pathname === "/health") {
    const probe = await env.DB.prepare("SELECT 1 AS ok").first();
    return response({ ok: probe?.ok === 1, service: "dominium-toa-bridge", version: 1 });
  }
  if (method === "POST" && url.pathname === "/v1/lookups") {
    return createLookup(request, env);
  }
  if (method === "POST" && url.pathname === "/v1/telemetry") {
    return enqueueTelemetry(request, env);
  }
  if (method === "GET" && url.pathname === "/v1/collector/telemetry/next") {
    return leaseTelemetry(request, env);
  }
  const telemetryAck = /^\/v1\/collector\/telemetry\/([a-f0-9]{40})\/ack$/.exec(url.pathname);
  if (method === "POST" && telemetryAck) {
    return ackTelemetry(request, env, telemetryAck[1]);
  }
  const lookupMatch = /^\/v1\/lookups\/([a-zA-Z0-9._:-]+)$/.exec(url.pathname);
  if (method === "GET" && lookupMatch) {
    return getLookup(request, env, lookupMatch[1]);
  }
  if (method === "GET" && url.pathname === "/v1/collector/jobs/next") {
    return leaseNext(request, env);
  }
  const resultMatch = /^\/v1\/collector\/jobs\/([a-zA-Z0-9._:-]+)\/result$/.exec(url.pathname);
  if (method === "POST" && resultMatch) {
    return completeLookup(request, env, resultMatch[1]);
  }
  return response({ ok: false, error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await router(request, env);
    } catch (error) {
      if (error instanceof BridgeInputError) {
        return response({ ok: false, error: error.code, message: error.message }, 400);
      }
      console.error("bridge_internal_error", error);
      return response({ ok: false, error: "internal_error" }, 500);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
};

