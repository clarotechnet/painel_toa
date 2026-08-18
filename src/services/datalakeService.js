import {
  firebaseConfigured,
  loadFirebaseFeed,
  subscribeFirebaseFeed,
} from './firebaseService.js';

function feedEndpoint() {
  const configured = String(globalThis.DOMINIUM_CONFIG?.apiBaseUrl || '').trim();
  const base = configured.replace(/\/+$/, '');
  return `${base}/api/toa-datalake/feed`;
}

export async function loadDatalakeFeed() {
  if (firebaseConfigured()) return loadFirebaseFeed();
  const response = await fetch(feedEndpoint(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Datalake TOA indisponível (${response.status})`);
  const payload = await response.json();
  if (!payload?.ok) throw new Error(payload?.error || 'Resposta inválida do datalake TOA');
  return {
    files: Array.isArray(payload.files) ? payload.files : [],
    orders: Array.isArray(payload.orders) ? payload.orders : [],
    timelineActivities: Array.isArray(payload.timelineActivities) ? payload.timelineActivities : [],
    errors: Array.isArray(payload.errors) ? payload.errors : [],
    loadedAt: payload.loadedAt || new Date().toISOString(),
    source: 'toa_datalake',
    live: Boolean(payload.live),
    liveAgeSeconds: payload.liveAgeSeconds ?? null,
    lastRunSource: payload.lastRunSource || '',
  };
}

export function datalakeUsesRealtime() {
  return firebaseConfigured();
}

export async function subscribeDatalakeFeed(onData, onError) {
  if (!firebaseConfigured()) return () => {};
  return subscribeFirebaseFeed(onData, onError);
}
