import assert from 'node:assert/strict';
import { AlertService } from '../src/services/alertService.js';
import '../src/core/operations-monitor.js';

const storage = new Map();
const playedAudios = [];
const notifications = [];
let cancelCount = 0;

globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.window = globalThis;
globalThis.speechSynthesis = {
  cancel: () => { cancelCount += 1; },
};
globalThis.Audio = class {
  constructor(src) {
    this.src = src;
    this.paused = false;
  }
  async play() {
    playedAudios.push(this.src);
    queueMicrotask(() => this.onended?.());
  }
  pause() {
    this.paused = true;
  }
};
globalThis.URL = {
  createObjectURL: (blob) => `blob://test-audio-${blob?.text || 'sample'}`,
  revokeObjectURL: () => {},
};
globalThis.fetch = async (url, options) => {
  if (url === '/api/v1/voice/speak') {
    const body = JSON.parse(options.body);
    return {
      ok: true,
      headers: new Map([['content-type', 'audio/mpeg']]),
      blob: async () => ({ size: 42, text: body.text }),
    };
  }
  return { ok: false, status: 404 };
};
globalThis.Notification = class {
  static permission = 'granted';
  constructor(title, options) { notifications.push({ title, options }); }
};

const service = new AlertService();
service.setEdgeVoice('pt-BR-FranciscaNeural');
assert.equal(service.edgeVoice, 'pt-BR-FranciscaNeural');
service.voice = true;
service.setTvMode(true);
const deadline = new Date(Date.now() + 20 * 60000).toISOString();
const focus = {
  os: '2650766808',
  contract: '408676249',
  technician: 'GABRIEL DE MORAIS BRITO',
  tec1_kind: 'risk',
  tec1_minutes: 55,
  tec1_deadline: deadline,
};

service.syncTvFocus([focus]);
await new Promise((resolve) => setTimeout(resolve, 20));
service.syncTvFocus([focus]);
await new Promise((resolve) => setTimeout(resolve, 20));

assert.equal(playedAudios.length, 1, 'A mesma prioridade visivel nao pode ser repetida');
assert.match(playedAudios[0], /faltam 20 minutos/);

service.syncTvFocus([{ ...focus, tec1_minutes: 9, tec1_deadline: new Date(Date.now() + 9 * 60000).toISOString() }]);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(playedAudios.length, 2, 'A mudanca para a faixa de 15 minutos deve ser anunciada');

const urgentDeadline = new Date(Date.now() - 45 * 60000).toISOString();
service.syncTvFocus([{ ...focus, contract: '408676249', tec1_kind: 'late', tec1_deadline: urgentDeadline, deadline_basis: 'official_window' }]);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.match(playedAudios.at(-1), /Baixe imediatamente o contrato/);

const cancellationsBeforeFocusChange = cancelCount;
service.speaking = true;
service.currentVoiceKeys = ['prioridade-anterior'];
service.syncTvFocus([{ ...focus, os: '2650009999', tec1_deadline: new Date(Date.now() + 8 * 60000).toISOString() }]);
assert.equal(cancelCount, cancellationsBeforeFocusChange, 'Trocar a prioridade visual nao pode cortar a fala');
assert.equal(service.isVoiceBusy(), true, 'A rotacao deve reconhecer uma locucao em andamento');
service.speaking = false;
service.currentVoiceKeys = [];

const notificationService = new AlertService();
notificationService.notifications = true;
notificationService.notify({
  generatedAt: new Date().toISOString(),
  isDemo: false,
  views: { monitor: { rows: [{
    os: '2650000045', contract: '408676249', technician: 'EDSON CASEMIRO',
    technician_login: 'Z641921', bucket: 'JCR-DMV', status: 'INICIADA', status_kind: 'field',
    tec1_kind: 'late', tec1_deadline: urgentDeadline, window_start: '08:00', window_end: '11:00',
  }] } },
});
assert.equal(notifications.length, 1);
assert.equal(notifications[0].title, 'TOA - BAIXA URGENTE');
assert.match(notifications[0].options.body, /Contrato 408676249/);

console.log('Voz do Modo TV: sincronizacao, deduplicacao e Edge Neural TTS validados.');

