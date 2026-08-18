import { createApp } from './app.js';
import { requireFirebaseAccess } from './services/firebaseService.js';

const root = document.querySelector('#app');

async function start() {
  if (!await requireFirebaseAccess(root)) return;
  await createApp(root);
}

start().catch((error) => {
  console.error(error);
  root.innerHTML = `<main style="padding:32px"><h1>Falha ao iniciar o monitor TOA</h1><pre>${String(error?.stack || error)}</pre></main>`;
});
