// Configuracao carregada em tempo de execucao.
// Vazio usa a mesma origem (modo local ou container web com proxy /api).
// Na hospedagem estatica, use por exemplo: https://api.seudominio.com.br
window.DOMINIUM_CONFIG = Object.freeze({
  apiBaseUrl: '',
  // "auto" usa Firebase quando os campos abaixo estiverem preenchidos e,
  // caso contrario, preserva a API local atual.
  dataSource: 'api',
  // Painel publicado sem login. A regra do Realtime Database deve permitir
  // leitura publica e continuar bloqueando escritas feitas pelo navegador.
  firebasePublicRead: true,
  firebasePath: 'dominium/toa/current',
  firebase: Object.freeze({
    apiKey: 'AIzaSyDtX92ZrIWi94T4_Zp9iqlHGJN2rfCBUxU',
    authDomain: 'dominium-toa.firebaseapp.com',
    databaseURL: 'https://dominium-toa-default-rtdb.firebaseio.com',
    projectId: 'dominium-toa',
    appId: '1:850294894743:web:d9aad5d9deccc64807b9d2',
  }),
});
