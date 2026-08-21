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

  window[BUFFER_KEY] = Array.isArray(window[BUFFER_KEY]) ? window[BUFFER_KEY] : [];

  function looksRelevant(url, text) {
    return /(?:gps|location|position|track|route|map|history|trace|movement)/i.test(String(url || ''))
      || /"(?:lat|lng|latitude|longitude|coordinatex|coordinatey|coordinate_x|coordinate_y|coordinates|position)"\s*:/i.test(text);
  }

  function publish(url, text) {
    if (!text || !looksRelevant(url, text)) return;
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (!payload || typeof payload !== 'object') return;
    const record = { url: String(url || ''), payload, capturedAt: Date.now() };
    const buffer = window[BUFFER_KEY];
    buffer.push(record);
    if (buffer.length > 24) buffer.splice(0, buffer.length - 24);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: record }));
  }

  window.fetch = async function () {
    const url = typeof arguments[0] === 'string' ? arguments[0] : String(arguments[0]?.url || '');
    const response = await originalFetch.apply(this, arguments);
    response.clone().text().then((text) => publish(url, text)).catch(() => {});
    return response;
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tn_location_url = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try { publish(this.__tn_location_url, this.responseText); } catch {}
    });
    return originalSend.apply(this, arguments);
  };
})();
