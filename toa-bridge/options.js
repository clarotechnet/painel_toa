const DEFAULT_CLOUD_BASE_URL = 'https://dominium-toa-bridge.dominium-toa-cloud-bridge.workers.dev';
const DEFAULT_COLLECTOR_ID = 'central-toa';

const fields = {
  enabled: document.querySelector('#enabled'),
  baseUrl: document.querySelector('#baseUrl'),
  token: document.querySelector('#token'),
  collectorId: document.querySelector('#collectorId'),
  status: document.querySelector('#status'),
  toaApiEnabled: document.querySelector('#toaApiEnabled'),
  toaApiBaseUrl: document.querySelector('#toaApiBaseUrl'),
  toaApiToken: document.querySelector('#toaApiToken'),
  toaApiStatus: document.querySelector('#toaApiStatus'),
};

async function load() {
  const value = await chrome.storage.local.get([
    'dominiumCloudEnabled', 'dominiumCloudBaseUrl',
    'dominiumCollectorToken', 'dominiumCollectorId',
    'toaCoreApiEnabled', 'toaCoreApiBaseUrl', 'toaCoreApiToken',
  ]);
  fields.enabled.checked = value.dominiumCloudEnabled === true;
  fields.baseUrl.value = value.dominiumCloudBaseUrl || DEFAULT_CLOUD_BASE_URL;
  fields.token.value = value.dominiumCollectorToken || '';
  fields.collectorId.value = value.dominiumCollectorId || DEFAULT_COLLECTOR_ID;
  fields.toaApiEnabled.checked = value.toaCoreApiEnabled === true;
  fields.toaApiBaseUrl.value = value.toaCoreApiBaseUrl || '';
  fields.toaApiToken.value = value.toaCoreApiToken || '';
}

document.querySelector('#save').addEventListener('click', async () => {
  fields.status.textContent = 'Salvando…';
  const baseUrl = fields.baseUrl.value.trim().replace(/\/+$/, '');
  if (fields.enabled.checked && !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/i.test(baseUrl)) {
    fields.status.textContent = 'Use o endereço HTTPS workers.dev publicado.';
    return;
  }
  await chrome.storage.local.set({
    dominiumCloudEnabled: fields.enabled.checked,
    dominiumCloudBaseUrl: baseUrl,
    dominiumCollectorToken: fields.token.value.trim(),
    dominiumCollectorId: fields.collectorId.value.trim() || DEFAULT_COLLECTOR_ID,
  });
  const response = await chrome.runtime.sendMessage({ action: 'cloud_bridge_status' });
  if (!response?.configured) {
    fields.status.textContent = 'Salvo, mas falta endereço ou chave.';
    return;
  }
  try {
    const health = await chrome.runtime.sendMessage({
      action: 'bridge_fetch', path: '/cloud/health', options: {},
    });
    fields.status.textContent = health?.ok && health?.data?.ok
      ? 'Ponte online. Mantenha o TOA aberto.'
      : 'Configuração salva; ponte ainda não respondeu.';
  } catch {
    fields.status.textContent = 'Configuração salva; ponte ainda não respondeu.';
  }
});

document.querySelector('#saveToaApi').addEventListener('click', async () => {
  fields.toaApiStatus.textContent = 'Salvando…';
  const baseUrl = fields.toaApiBaseUrl.value.trim().replace(/\/+$/, '');
  if (fields.toaApiEnabled.checked && !/^https:\/\/[a-z0-9.-]+\.fs\.ocs\.oraclecloud\.com$/i.test(baseUrl)) {
    fields.toaApiStatus.textContent = 'Use a URL HTTPS da instância fs.ocs.oraclecloud.com.';
    return;
  }
  await chrome.storage.local.set({
    toaCoreApiEnabled: fields.toaApiEnabled.checked,
    toaCoreApiBaseUrl: baseUrl,
    toaCoreApiToken: fields.toaApiToken.value.trim(),
  });
  const response = await chrome.runtime.sendMessage({ action: 'toa_core_api_status' });
  fields.toaApiStatus.textContent = response?.configured
    ? 'API TOA configurada. O coletor fará sincronização periódica.'
    : 'Salvo, mas falta URL ou token OAuth.';
});

load();
