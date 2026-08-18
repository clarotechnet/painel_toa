(function bridgeTOADiscovery() {
  "use strict";

  const CHANNEL = "TOA_DISCOVERY_V1";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.direction !== "page-to-extension") return;
    chrome.runtime.sendMessage({
      scope: CHANNEL,
      type: message.type,
      payload: message.payload,
      page: {
        origin: location.origin,
        path: location.pathname,
        top: window === window.top,
      },
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.scope !== CHANNEL || !message.command) return;
    window.postMessage({
      channel: CHANNEL,
      direction: "extension-to-page",
      command: message.command,
    }, location.origin);
  });

  chrome.runtime.sendMessage({
    scope: CHANNEL,
    type: "BRIDGE_READY",
    payload: { capturedAt: new Date().toISOString(), top: window === window.top },
    page: { origin: location.origin, path: location.pathname, top: window === window.top },
  }).catch(() => {});

  // Quando uma sessao por bucket esta ativa, liga o filtro antes de o TOA
  // terminar de carregar. Assim apenas a rede desta carga alimenta a coleta.
  chrome.runtime.sendMessage({ scope: CHANNEL, type: "GET_STATE" }).then((response) => {
    if (!response || !response.ok || !response.state || !response.state.metadata || !response.state.metadata.bucketMode) return;
    window.postMessage({
      channel: CHANNEL,
      direction: "extension-to-page",
      command: "BUCKET_RESET",
    }, location.origin);
  }).catch(() => {});
})();
