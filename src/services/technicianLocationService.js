const FIREBASE_SDK_VERSION = '12.17.1';
const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
const HISTORY_ROOT = 'dominium/toa/history/technicianLocations';

let firebaseHistoryContextPromise;

function apiBase() {
  return String(globalThis.DOMINIUM_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');
}

function useLocalApi() {
  const host = String(globalThis.location?.hostname || '').toLowerCase();
  const port = String(globalThis.location?.port || '');
  const source = String(globalThis.DOMINIUM_CONFIG?.dataSource || 'auto').toLowerCase();
  const localHost = host === 'localhost' || host === '127.0.0.1';
  // O servidor Python oficial usa 8765. Em uma sessao Vite (5173), manter o
  // Firebase evita requisitar /api na origem errada e receber o index.html.
  return source === 'api' || (localHost && (port === '' || port === '8765'));
}

async function localJson(path) {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`API local de localização indisponível (${response.status})`);
  return response.json();
}

async function firebaseHistoryContext() {
  if (!firebaseHistoryContextPromise) {
    firebaseHistoryContextPromise = Promise.all([
      import(`${SDK_BASE}/firebase-app.js`),
      import(`${SDK_BASE}/firebase-auth.js`),
      import(`${SDK_BASE}/firebase-database.js`),
    ]).then(([appSdk, authSdk, databaseSdk]) => {
      const config = globalThis.DOMINIUM_CONFIG?.firebase || {};
      const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
      if (!required.every((key) => String(config[key] || '').trim())) {
        throw new Error('Firebase incompleto em public/config.js');
      }
      const options = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value || '').trim()]));
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(options);
      return {
        app,
        auth: authSdk.getAuth(app),
        database: databaseSdk.getDatabase(app),
        authSdk,
        databaseSdk,
      };
    });
  }
  return firebaseHistoryContextPromise;
}

async function settledUser() {
  const { auth, authSdk } = await firebaseHistoryContext();
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    const unsubscribe = authSdk.onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, reject);
  });
}

async function authorizedUser({ interactive = false } = {}) {
  const context = await firebaseHistoryContext();
  let user = await settledUser();
  if (!user && interactive) {
    const provider = new context.authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    user = (await context.authSdk.signInWithPopup(context.auth, provider)).user;
  }
  if (!user) return { user: null, authorized: false };
  const access = await context.databaseSdk.get(
    context.databaseSdk.ref(context.database, `authorizedUsers/${user.uid}`),
  );
  return { user, authorized: access.val() === true };
}

function collection(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

function haversineMeters(left, right) {
  const radians = (value) => Number(value) * Math.PI / 180;
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(right.longitude) - radians(left.longitude);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function splitGpsTrack(points = []) {
  const ordered = [...points].filter((point) => {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    const accuracy = Number(point?.accuracy_m || 0);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -34 && latitude <= 6 && longitude >= -74 && longitude <= -28
      && (!accuracy || accuracy <= 250);
  }).sort((left, right) => String(left.observed_at || '').localeCompare(String(right.observed_at || '')));
  const segments = [];
  let current = [];
  for (const point of ordered) {
    if (!current.length) {
      current = [point];
      segments.push(current);
      continue;
    }
    const previous = current.at(-1);
    const elapsed = (new Date(point.observed_at) - new Date(previous.observed_at)) / 1000;
    if (!Number.isFinite(elapsed) || elapsed <= 0) continue;
    if (elapsed > 1800) {
      current = [point];
      segments.push(current);
      continue;
    }
    const distance = haversineMeters(previous, point);
    const speed = (distance / elapsed) * 3.6;
    // Saltos impossiveis sao drift: descarte o ponto e nao crie uma reta ate ele.
    if (!Number.isFinite(distance) || distance > 15000 || speed > 140) continue;
    current.push(point);
  }
  return segments.filter((segment) => segment.length);
}

function trackDistance(points) {
  let meters = 0;
  for (const segment of splitGpsTrack(points)) {
    for (let index = 1; index < segment.length; index += 1) {
      const previous = segment[index - 1];
      const current = segment[index];
      const distance = haversineMeters(previous, current);
      const accuracy = Math.max(Number(previous.accuracy_m || 0), Number(current.accuracy_m || 0));
      if (distance > Math.max(8, accuracy * 0.35)) meters += distance;
    }
  }
  return Math.round(meters) / 1000;
}

function removeInferredPlannedRoute(plannedRoute, visits) {
  if (!plannedRoute.length || !visits.length) return plannedRoute;
  const signature = (point) => `${String(point.activity_id || '')}|${Number(point.latitude).toFixed(6)}|${Number(point.longitude).toFixed(6)}`;
  const stops = new Set(visits.map(signature));
  return plannedRoute.every((point) => stops.has(signature(point))) ? [] : plannedRoute;
}

function normalizeTechnician(value, fallbackKey = '') {
  const points = collection(value?.gpsReal ?? value?.points).sort((left, right) => String(left.observed_at || '').localeCompare(String(right.observed_at || '')));
  const visits = collection(value?.serviceStops ?? value?.visits).sort((left, right) => (
    String(left.scheduled_at || '').localeCompare(String(right.scheduled_at || ''))
    || String(left.marker_label || '').localeCompare(String(right.marker_label || ''))
  ));
  const plannedRoute = removeInferredPlannedRoute(collection(value?.plannedRoute ?? value?.planned_route), visits).sort((left, right) => (
    String(left.scheduled_at || '').localeCompare(String(right.scheduled_at || ''))
    || String(left.marker_label || '').localeCompare(String(right.marker_label || ''))
  ));
  return {
    technician_id: String(value?.technician_id || value?.id || fallbackKey),
    technician_login: String(value?.technician_login || value?.login || fallbackKey),
    technician_name: String(value?.technician_name || value?.name || value?.login || fallbackKey),
    bucket: String(value?.bucket || ''),
    profile: String(value?.profile || ''),
    distance_km: value?.distance_km === undefined ? trackDistance(points) : Number(value.distance_km || 0),
    point_count: Number(value?.point_count ?? points.length),
    first_at: value?.first_at || points[0]?.observed_at || '',
    last_at: value?.last_at || points.at(-1)?.observed_at || '',
    points,
    visit_count: Number(value?.visit_count ?? visits.length),
    visits,
    planned_route: plannedRoute,
  };
}

async function firebaseDay(date, { interactive = false } = {}) {
  const access = await authorizedUser({ interactive });
  if (!access.user) return { ok: false, requiresAuth: true, date, items: [] };
  if (!access.authorized) return {
    ok: false,
    unauthorized: true,
    uid: access.user.uid,
    email: access.user.email || '',
    date,
    items: [],
  };
  const context = await firebaseHistoryContext();
  const snapshot = await context.databaseSdk.get(
    context.databaseSdk.ref(context.database, `${HISTORY_ROOT}/${date}/technicians`),
  );
  const raw = snapshot.val() || {};
  const items = Object.entries(raw).map(([key, value]) => normalizeTechnician(value, key));
  items.sort((left, right) => right.distance_km - left.distance_km || left.technician_name.localeCompare(right.technician_name));
  return {
    ok: true,
    provider: 'firebase',
    date,
    technician_count: items.length,
    point_count: items.reduce((total, item) => total + item.point_count, 0),
    items,
  };
}

export async function loadTechnicianLocationSummary(date, options = {}) {
  if (useLocalApi()) {
    const payload = await localJson(`/api/v1/technician-monitor/summary?date=${encodeURIComponent(date)}`);
    return { ...payload, provider: 'local-api' };
  }
  return firebaseDay(date, options);
}

export async function loadTechnicianLocationTrack(identifier, date, options = {}) {
  if (useLocalApi()) {
    const payload = await localJson(`/api/v1/technician-monitor/track/${encodeURIComponent(identifier)}?date=${encodeURIComponent(date)}`);
    return { ...payload, provider: 'local-api' };
  }
  const day = await firebaseDay(date, options);
  if (!day.ok) return day;
  const selected = day.items.find((item) => item.technician_login === identifier || item.technician_id === identifier);
  return {
    ok: true,
    provider: 'firebase',
    date,
    technician: selected ? {
      id: selected.technician_id,
      login: selected.technician_login,
      name: selected.technician_name,
      bucket: selected.bucket,
    } : { id: identifier, login: identifier, name: identifier, bucket: '' },
    point_count: selected?.point_count || 0,
    distance_km: selected?.distance_km || 0,
    points: selected?.points || [],
    visit_count: selected?.visit_count || 0,
    visits: selected?.visits || [],
    planned_route: selected?.planned_route || [],
  };
}

export async function signInTechnicianHistory() {
  return authorizedUser({ interactive: true });
}
