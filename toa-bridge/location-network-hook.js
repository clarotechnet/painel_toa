// Captura antecipada e somente leitura das respostas de mapa do TOA.
// O content-main carrega depois e consome este buffer para normalizar os pontos.
(function () {
  'use strict';

  if (window.__TN_LOCATION_NETWORK_HOOK__) return;
  window.__TN_LOCATION_NETWORK_HOOK__ = true;

  const EVENT_NAME = 'TN_TOA_LOCATION_NETWORK_PAYLOAD';
  const BUFFER_KEY = '__TN_TOA_LOCATION_EARLY_PAYLOADS__';
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const SAFE_REPLAY_HEADERS = new Set([
    'accept',
    'content-type',
    'x-requested-with',
    'x-oa',
    'x-platform',
    'x-ofs-csrf-secure',
  ]);
  const traceProbe = {
    template: null,
    capturedAt: null,
    running: false,
    lastRunAt: null,
    lastStatus: null,
    lastError: '',
    lastSummary: null,
  };
  const technicianSweep = {
    running: false,
    cancelRequested: false,
    startedAt: null,
    completedAt: null,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentPid: '',
    lastPid: '',
    lastStatus: null,
    lastError: '',
    errors: [],
  };

  window[BUFFER_KEY] = Array.isArray(window[BUFFER_KEY]) ? window[BUFFER_KEY] : [];

  function looksRelevant(url, text) {
    return /(?:gps|location|position|track|route|map|history|trace|movement)/i.test(String(url || ''))
      || /"(?:lat|lng|latitude|longitude|coordinatex|coordinatey|coordinate_x|coordinate_y|coordinates|position)"\s*:/i.test(text);
  }

  function publishPayload(url, payload, metadata = {}) {
    if (!payload || typeof payload !== 'object') return;
    const record = {
      url: String(url || ''),
      payload,
      capturedAt: Date.now(),
      providerId: String(metadata.providerId || '').trim(),
    };
    const buffer = window[BUFFER_KEY];
    buffer.push(record);
    if (buffer.length > 24) buffer.splice(0, buffer.length - 24);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: record }));
  }

  function publish(url, text, metadata = {}) {
    if (!text || !looksRelevant(url, text)) return;
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    publishPayload(url, payload, metadata);
  }

  function providerIdFromBody(body) {
    const params = bodyToSearchParams(body);
    if (!params) return '';
    return String(
      params.get('resourceTreeSelection[selectedPid]')
      || params.get('sel_pid')
      || params.get('parent')
      || '',
    ).trim();
  }

  function isMapGetUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      return url.origin === location.origin
        && String(url.searchParams.get('m') || '').toLowerCase() === 'map'
        && String(url.searchParams.get('a') || '').toLowerCase() === 'get';
    } catch {
      return false;
    }
  }

  function bodyToSearchParams(body) {
    if (typeof body === 'string') return new URLSearchParams(body);
    if (body instanceof URLSearchParams) return new URLSearchParams(body.toString());
    if (body instanceof FormData) {
      const params = new URLSearchParams();
      for (const [key, value] of body.entries()) {
        if (typeof value === 'string') params.append(key, value);
      }
      return params;
    }
    return null;
  }

  function rememberMapTemplate(method, url, body, headers = {}) {
    if (String(method || 'GET').toUpperCase() !== 'POST' || !isMapGetUrl(url)) return;
    const params = bodyToSearchParams(body);
    if (!params) return;
    const safeHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
      const normalized = String(name || '').toLowerCase();
      if (SAFE_REPLAY_HEADERS.has(normalized) && String(value || '')) {
        safeHeaders[normalized] = String(value);
      }
    }
    traceProbe.template = {
      method: 'POST',
      url: new URL(String(url || ''), location.href).href,
      body: params.toString(),
      headers: safeHeaders,
    };
    traceProbe.capturedAt = new Date().toISOString();
  }

  function timestampFromObject(value) {
    if (!value || typeof value !== 'object') return '';
    const names = [
      'timestamp', 'time', 'datetime', 'dateTime', 'observed_at', 'observedAt',
      'gps_time', 'gpsTime', 'position_time', 'positionTime', 'created_at', 'createdAt',
    ];
    for (const name of names) {
      const candidate = value[name];
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).slice(0, 80);
      }
    }
    return '';
  }

  function coordinateFromObject(value) {
    if (!value || typeof value !== 'object') return null;
    const pairs = [
      ['lat', 'lng'], ['latitude', 'longitude'], ['coordinateY', 'coordinateX'],
      ['coordinate_y', 'coordinate_x'], ['y', 'x'],
    ];
    for (const [latKey, lngKey] of pairs) {
      const lat = Number(value[latKey]);
      const lng = Number(value[lngKey]);
      if (Number.isFinite(lat) && Number.isFinite(lng)
          && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
          && !(lat === 0 && lng === 0)) {
        return { lat, lng, latKey, lngKey };
      }
    }
    return null;
  }

  function summarizeTracePayload(payload) {
    const queue = [{ value: payload, path: '$' }];
    const traceKeys = new Set();
    const samples = [];
    let objectsVisited = 0;
    let coordinateObjects = 0;
    let timestampedCoordinateObjects = 0;

    while (queue.length && objectsVisited < 6000) {
      const current = queue.shift();
      const value = current.value;
      if (!value || typeof value !== 'object') continue;
      objectsVisited += 1;

      for (const key of Object.keys(value)) {
        if (/(?:trace|track|history|position|movement|breadcrumb|gps)/i.test(key)) {
          traceKeys.add(key);
        }
      }

      const coordinate = coordinateFromObject(value);
      const timestamp = timestampFromObject(value);
      if (coordinate) {
        coordinateObjects += 1;
        if (timestamp) timestampedCoordinateObjects += 1;
        if (samples.length < 12) {
          samples.push({
            path: current.path.slice(0, 240),
            latitude: coordinate.lat,
            longitude: coordinate.lng,
            timestamp: timestamp || null,
            coordinateFields: `${coordinate.latKey}/${coordinate.lngKey}`,
          });
        }
      }

      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object' && queue.length < 12000) {
          queue.push({ value: child, path: `${current.path}.${String(key).slice(0, 80)}` });
        }
      }
    }

    return {
      topLevelType: Array.isArray(payload) ? 'array' : typeof payload,
      topLevelKeys: payload && !Array.isArray(payload) && typeof payload === 'object'
        ? Object.keys(payload).slice(0, 80)
        : [],
      topLevelLength: Array.isArray(payload) ? payload.length : null,
      objectsVisited,
      coordinateObjects,
      timestampedCoordinateObjects,
      traceLikeKeys: Array.from(traceKeys).slice(0, 80),
      samples,
      hasRealTraceCandidate: timestampedCoordinateObjects > 1,
    };
  }

  function todayIsoSaoPaulo() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeProviderIds(providerIds) {
    const values = Array.isArray(providerIds) ? providerIds : [];
    return Array.from(new Set(values
      .map((value) => String(value ?? '').trim())
      .filter((value) => /^\d+$/.test(value))))
      .slice(0, 400);
  }

  function paramsForProvider(providerId) {
    const params = new URLSearchParams(traceProbe.template.body);
    const date = todayIsoSaoPaulo();
    params.set('parent', providerId);
    params.set('sel_pid', providerId);
    params.set('resourceTreeSelection[selectedPid]', providerId);
    params.set('filter[show_tech_trace]', '1');
    params.set('filter[show_tech_position]', '1');
    params.set('qdate', date);
    params.set('trees[main][tree_date]', date);
    params.delete('dates[]');
    params.append('dates[]', date);
    params.set('requestId', `top_map_${Date.now()}`);
    return params;
  }

  async function fetchProviderMap(providerId, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { ...traceProbe.template.headers };
      if (!headers['content-type']) {
        headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }
      const response = await originalFetch(traceProbe.template.url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: paramsForProvider(providerId).toString(),
        signal: controller.signal,
      });
      technicianSweep.lastStatus = response.status;
      const text = await response.text();
      if (response.status === 401 || response.status === 403
        || /(?:login de usu[aá]rio|password|challenge_url)/i.test(text.slice(0, 4000))) {
        throw new Error('toa_sem_sessao');
      }
      if (!response.ok) throw new Error(`toa_map_http_${response.status}`);
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error('toa_map_json_invalido'); }
      const responseProviderId = String(
        payload?.pid ?? payload?.track?.pid ?? payload?.provider_id ?? payload?.providerId ?? '',
      ).trim();
      if (responseProviderId && responseProviderId !== String(providerId)) {
        throw new Error(`toa_map_pid_mismatch_${providerId}_${responseProviderId}`);
      }
      // O replay e silencioso: a selecao visivel da arvore nao muda. Anexar o
      // PID solicitado impede que a resposta seja atribuida ao tecnico que
      // permaneceu selecionado na tela.
      publishPayload(traceProbe.template.url, payload, { providerId });
      return summarizeTracePayload(payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  window.__TN_TOA_SYNC_TECHNICIANS__ = async function (providerIds, options = {}) {
    if (technicianSweep.running) throw new Error('tn_technician_sweep_in_progress');
    if (!traceProbe.template) throw new Error('tn_map_template_unavailable');
    const ids = normalizeProviderIds(providerIds);
    if (!ids.length) throw new Error('tn_technician_sweep_empty');

    const delayMs = Math.max(1000, Math.min(Number(options.delayMs) || 1200, 10000));
    const timeoutMs = Math.max(5000, Math.min(Number(options.timeoutMs) || 20000, 60000));
    Object.assign(technicianSweep, {
      running: true,
      cancelRequested: false,
      startedAt: new Date().toISOString(),
      completedAt: null,
      total: ids.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      currentPid: '',
      lastPid: '',
      lastStatus: null,
      lastError: '',
      errors: [],
    });

    try {
      for (const providerId of ids) {
        if (technicianSweep.cancelRequested) break;
        technicianSweep.currentPid = providerId;
        try {
          let attempt = 0;
          while (true) {
            try {
              await fetchProviderMap(providerId, timeoutMs);
              break;
            } catch (error) {
              const message = String(error?.message || error || '');
              if (!message.startsWith('toa_map_pid_mismatch_') || attempt >= 1) throw error;
              attempt += 1;
              await wait(Math.max(1000, delayMs));
            }
          }
          technicianSweep.succeeded += 1;
        } catch (error) {
          const message = error?.name === 'AbortError'
            ? 'toa_map_timeout'
            : String(error?.message || error || 'toa_map_failed');
          technicianSweep.failed += 1;
          technicianSweep.lastError = message;
          technicianSweep.errors.push({ pid: providerId, error: message });
          if (technicianSweep.errors.length > 20) technicianSweep.errors.shift();
          if (message === 'toa_sem_sessao') throw error;
        } finally {
          technicianSweep.processed += 1;
          technicianSweep.lastPid = providerId;
          technicianSweep.currentPid = '';
        }
        if (!technicianSweep.cancelRequested && technicianSweep.processed < ids.length) {
          await wait(delayMs);
        }
      }
    } finally {
      technicianSweep.running = false;
      technicianSweep.currentPid = '';
      technicianSweep.completedAt = new Date().toISOString();
    }
    return window.__TN_TOA_TECH_TRACE_STATUS__();
  };

  window.__TN_TOA_CANCEL_TECHNICIAN_SYNC__ = function () {
    technicianSweep.cancelRequested = true;
    return true;
  };

  window.__TN_TOA_TEST_TECH_TRACE__ = async function () {
    if (traceProbe.running) throw new Error('tn_trace_probe_in_progress');
    if (!traceProbe.template) throw new Error('tn_map_template_unavailable');

    traceProbe.running = true;
    traceProbe.lastError = '';
    traceProbe.lastRunAt = new Date().toISOString();
    try {
      const params = new URLSearchParams(traceProbe.template.body);
      params.set('filter[show_tech_trace]', '1');
      const headers = { ...traceProbe.template.headers };
      if (!headers['content-type']) {
        headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }
      const response = await originalFetch(traceProbe.template.url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: params.toString(),
      });
      traceProbe.lastStatus = response.status;
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error('tn_trace_probe_invalid_json'); }
      const summary = summarizeTracePayload(payload);
      traceProbe.lastSummary = {
        ...summary,
        ok: response.ok,
        status: response.status,
        testedAt: traceProbe.lastRunAt,
        changedField: 'filter[show_tech_trace]=1',
      };
      return traceProbe.lastSummary;
    } catch (error) {
      traceProbe.lastError = String(error?.message || error || 'tn_trace_probe_failed');
      throw error;
    } finally {
      traceProbe.running = false;
    }
  };

  window.__TN_TOA_TECH_TRACE_STATUS__ = function () {
    return {
      templateAvailable: Boolean(traceProbe.template),
      templateCapturedAt: traceProbe.capturedAt,
      running: traceProbe.running,
      lastRunAt: traceProbe.lastRunAt,
      lastStatus: traceProbe.lastStatus,
      lastError: traceProbe.lastError,
      lastSummary: traceProbe.lastSummary,
      sweep: {
        running: technicianSweep.running,
        cancelRequested: technicianSweep.cancelRequested,
        startedAt: technicianSweep.startedAt,
        completedAt: technicianSweep.completedAt,
        total: technicianSweep.total,
        processed: technicianSweep.processed,
        succeeded: technicianSweep.succeeded,
        failed: technicianSweep.failed,
        currentPid: technicianSweep.currentPid,
        lastPid: technicianSweep.lastPid,
        lastStatus: technicianSweep.lastStatus,
        lastError: technicianSweep.lastError,
        errors: technicianSweep.errors.slice(),
      },
    };
  };

  window.fetch = async function () {
    const url = typeof arguments[0] === 'string' ? arguments[0] : String(arguments[0]?.url || '');
    const method = String(arguments[1]?.method || arguments[0]?.method || 'GET');
    const headers = {};
    try {
      const requestHeaders = new Headers(arguments[1]?.headers || arguments[0]?.headers || {});
      for (const [name, value] of requestHeaders.entries()) headers[name] = value;
    } catch {}
    const requestBody = arguments[1]?.body;
    const requestedProviderId = isMapGetUrl(url) ? providerIdFromBody(requestBody) : '';
    rememberMapTemplate(method, url, requestBody, headers);
    const response = await originalFetch.apply(this, arguments);
    response.clone().text().then((text) => publish(url, text, {
      providerId: requestedProviderId,
    })).catch(() => {});
    return response;
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tn_location_method = String(method || 'GET');
    this.__tn_location_url = String(url || '');
    this.__tn_location_headers = {};
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const normalized = String(name || '').toLowerCase();
    if (SAFE_REPLAY_HEADERS.has(normalized)) {
      this.__tn_location_headers = this.__tn_location_headers || {};
      this.__tn_location_headers[normalized] = String(value || '');
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const requestedProviderId = isMapGetUrl(this.__tn_location_url)
      ? providerIdFromBody(body)
      : '';
    rememberMapTemplate(
      this.__tn_location_method,
      this.__tn_location_url,
      body,
      this.__tn_location_headers,
    );
    this.addEventListener('load', function () {
      try {
        publish(this.__tn_location_url, this.responseText, {
          providerId: requestedProviderId,
        });
      } catch {}
    });
    return originalSend.apply(this, arguments);
  };
})();
