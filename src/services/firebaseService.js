const FIREBASE_SDK_VERSION = '12.16.0';
const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let sdkPromise;
let contextPromise;

function config() {
  return globalThis.DOMINIUM_CONFIG?.firebase || {};
}

function publicReadEnabled() {
  return globalThis.DOMINIUM_CONFIG?.firebasePublicRead === true;
}

export function firebaseConfigured() {
  const selected = String(globalThis.DOMINIUM_CONFIG?.dataSource || 'auto').toLowerCase();
  if (selected === 'api') return false;
  const firebase = config();
  const complete = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId']
    .every((key) => String(firebase[key] || '').trim());
  if (selected === 'firebase' && !complete) {
    throw new Error('Fonte Firebase selecionada, mas public/config.js está incompleto');
  }
  return complete;
}

function firebasePath() {
  return String(globalThis.DOMINIUM_CONFIG?.firebasePath || 'dominium/toa/current')
    .replace(/^\/+|\/+$/g, '');
}

async function loadSdk() {
  if (!sdkPromise) {
    const authModule = publicReadEnabled()
      ? Promise.resolve(null)
      : import(`${SDK_BASE}/firebase-auth.js`);
    sdkPromise = Promise.all([
      import(`${SDK_BASE}/firebase-app.js`),
      authModule,
      import(`${SDK_BASE}/firebase-database.js`),
    ]).then(([app, auth, database]) => ({ app, auth, database }));
  }
  return sdkPromise;
}

async function context() {
  if (!firebaseConfigured()) throw new Error('Firebase não configurado em public/config.js');
  if (!contextPromise) {
    contextPromise = loadSdk().then((sdk) => {
      const options = Object.fromEntries(
        Object.entries(config()).map(([key, value]) => [key, String(value || '').trim()]),
      );
      const app = sdk.app.getApps().length ? sdk.app.getApp() : sdk.app.initializeApp(options);
      return {
        sdk,
        app,
        auth: sdk.auth ? sdk.auth.getAuth(app) : null,
        database: sdk.database.getDatabase(app),
      };
    });
  }
  return contextPromise;
}

export async function currentFirebaseUser() {
  const { auth, sdk } = await context();
  if (!auth || !sdk.auth) return null;
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    const unsubscribe = sdk.auth.onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, reject);
  });
}

export async function signInFirebase() {
  const { auth, sdk } = await context();
  if (!auth || !sdk.auth) throw new Error('Login desativado no modo de leitura pública');
  const provider = new sdk.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await sdk.auth.signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutFirebase() {
  const { auth, sdk } = await context();
  if (!auth || !sdk.auth) return;
  await sdk.auth.signOut(auth);
}

export async function firebaseUserIsAuthorized(user) {
  if (!user?.uid) return false;
  const { database, sdk } = await context();
  const access = await sdk.database.get(
    sdk.database.ref(database, `authorizedUsers/${user.uid}`),
  );
  return access.val() === true;
}

function feedFromValue(value) {
  if (!value || typeof value !== 'object') throw new Error('Firebase ainda não possui um snapshot do TOA');
  const feed = value.feed && typeof value.feed === 'object' ? value.feed : value;
  const collection = (items) => {
    if (Array.isArray(items)) return items.filter(Boolean);
    if (items && typeof items === 'object') return Object.values(items).filter(Boolean);
    return [];
  };
  return {
    files: collection(feed.files),
    orders: collection(feed.orders),
    timelineActivities: collection(feed.timelineActivities),
    errors: collection(feed.errors),
    loadedAt: feed.loadedAt || value.publishedAt || value.receivedAt || new Date().toISOString(),
    source: 'firebase_realtime',
    live: Boolean(feed.live),
    liveAgeSeconds: feed.liveAgeSeconds ?? null,
    lastRunSource: feed.lastRunSource || '',
  };
}

export async function loadFirebaseFeed() {
  const { database, sdk } = await context();
  const snapshot = await sdk.database.get(sdk.database.ref(database, firebasePath()));
  return feedFromValue(snapshot.val());
}

export async function subscribeFirebaseFeed(onData, onError) {
  const { database, sdk } = await context();
  const reference = sdk.database.ref(database, firebasePath());
  return sdk.database.onValue(reference, (snapshot) => {
    try {
      onData(feedFromValue(snapshot.val()));
    } catch (error) {
      onError?.(error);
    }
  }, onError);
}

function accessGateMarkup(user) {
  const signedIn = Boolean(user);
  return `<main class="firebase-access-gate">
    <section class="firebase-access-card">
      <img src="/assets/brands/technet-symbol.png" alt="Technet">
      <p class="firebase-access-eyebrow">DOMINIUM TOA</p>
      <h1>${signedIn ? 'Acesso ainda não autorizado' : 'Entrar no painel operacional'}</h1>
      <p>${signedIn
    ? 'Este usuário entrou corretamente, mas ainda precisa ser liberado no Firebase.'
    : 'Use a conta Google autorizada para acessar os dados do TOA em tempo real.'}</p>
      ${signedIn ? `<dl><div><dt>Conta</dt><dd>${user.email || '-'}</dd></div><div><dt>UID para liberar</dt><dd id="firebaseUserUid">${user.uid}</dd></div></dl>` : ''}
      <div class="firebase-access-actions">
        ${signedIn ? '<button id="firebaseRetryAccess" type="button">Verificar novamente</button><button id="firebaseSignOut" class="secondary" type="button">Trocar conta</button>'
    : '<button id="firebaseSignIn" type="button">Entrar com Google</button>'}
      </div>
      <p id="firebaseAccessError" class="firebase-access-error" role="alert"></p>
    </section>
  </main>`;
}

export async function requireFirebaseAccess(root) {
  if (!firebaseConfigured()) return true;
  if (publicReadEnabled()) return true;

  const waitForAction = async () => {
    let user = await currentFirebaseUser();
    if (user) {
      try {
        if (await firebaseUserIsAuthorized(user)) return true;
      } catch (error) {
        console.error('Falha ao verificar autorização no Firebase', error);
      }
    }

    root.innerHTML = accessGateMarkup(user);
    return new Promise((resolve) => {
      const showError = (error) => {
        const target = root.querySelector('#firebaseAccessError');
        if (target) target.textContent = error?.message || String(error);
      };
      root.querySelector('#firebaseSignIn')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          user = await signInFirebase();
          resolve(await waitForAction());
        } catch (error) {
          button.disabled = false;
          showError(error);
        }
      });
      root.querySelector('#firebaseRetryAccess')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          resolve(await waitForAction());
        } catch (error) {
          button.disabled = false;
          showError(error);
        }
      });
      root.querySelector('#firebaseSignOut')?.addEventListener('click', async () => {
        try {
          await signOutFirebase();
          resolve(await waitForAction());
        } catch (error) {
          showError(error);
        }
      });
    });
  };

  return waitForAction();
}
