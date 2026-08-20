// Documento offscreen persistente. Um Web Worker fornece o relogio porque
// timers do service worker MV3 deixam de rodar quando ele e suspenso.
const atlasClockWorker = new Worker(chrome.runtime.getURL('offscreen-worker.js'));

function wakeExtensionWorker(sentAt) {
  chrome.runtime.sendMessage(
    { action: 'offscreen_atlas_tick', sentAt: Number(sentAt || Date.now()) },
    () => {
      // O service worker pode reiniciar entre o envio e a resposta.
      void chrome.runtime.lastError;
    }
  );
}

atlasClockWorker.addEventListener('message', (event) => {
  if (event.data?.type !== 'atlas_clock_tick') return;
  wakeExtensionWorker(event.data.sentAt);
});

atlasClockWorker.addEventListener('error', (event) => {
  console.error('[offscreen] relogio Atlas falhou:', event.message || event);
});
