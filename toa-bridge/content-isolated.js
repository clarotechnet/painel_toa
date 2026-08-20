// content-isolated.js - Roda no world: ISOLATED
// Tem acesso ao chrome.runtime, comunica com content-main via postMessage

const BOT_BRIDGE_HOST = '127.0.0.1';
const BOT_BRIDGE_PORT = 8787;
const BOT_BRIDGE_TOKEN = '';

// Proxy para o bridge via background.js
async function bridgeFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('chrome.runtime indisponível'));
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: 'bridge_fetch',
        path,
        options: { 
          method: options.method || 'GET', 
          body: options.body || undefined,
          headers: options.headers || {}
        },
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.ok !== undefined) {
          resolve(resp);
        } else {
          reject(new Error(resp?.error || 'Bridge error'));
        }
      }
    );
  });
}

// Escuta mensagens do content-main.js
window.addEventListener('message', async (event) => {
  // Só aceita mensagens da mesma página
  if (event.source !== window) return;
  
  const { type, id, path, options, action } = event.data || {};
  
  if (type === 'TOA_BRIDGE_REQUEST') {
    console.log('[ISOLATED] Recebido request:', path);
    try {
      const result = await bridgeFetch(path, options);
      // Responde para o content-main
      window.postMessage({
        type: 'TOA_BRIDGE_RESPONSE',
        id,
        success: true,
        result
      }, '*');
    } catch (error) {
      window.postMessage({
        type: 'TOA_BRIDGE_RESPONSE',
        id,
        success: false,
        error: error.message
      }, '*');
    }
  }
});

// Mensagem do background nao sofre a limitacao de timers de abas ocultas.
// Repassa ao script MAIN, que possui o lider unico e a logica da fila Atlas.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.action !== 'atlas_tick' ||
    location.hostname !== 'www.atlas.netservicos.com.br'
  ) return false;

  window.postMessage({
    type: 'TN_ATLAS_BACKGROUND_TICK',
    sentAt: Number(message.sentAt || Date.now())
  }, '*');
  sendResponse({ ok: true, atlasTick: true });
  return false;
});

// Notifica que está pronto
console.log('[TOA-ISOLATED] Content script isolado ativo - pronto para proxy de bridge');
