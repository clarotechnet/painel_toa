import assert from 'node:assert/strict';
import { AlertService } from '../src/services/alertService.js';
import '../src/core/operations-monitor.js';

const storage = new Map();
const messages = [];
const notifications = [];
let availableVoices = [];
let cancelCount = 0;

globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.window = globalThis;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
  getVoices: () => availableVoices,
  cancel: () => { cancelCount += 1; },
  speak: (utterance) => {
    messages.push({ text: utterance.text, rate: utterance.rate });
    queueMicrotask(() => utterance.onend?.());
  },
};
globalThis.Notification = class {
  static permission = 'granted';
  constructor(title, options) { notifications.push({ title, options }); }
};

const service = new AlertService();
availableVoices = [
  { name: 'Google português do Brasil', lang: 'pt-BR' },
  { name: 'Microsoft Francisca Online (Natural) - Portuguese (Brazil)', lang: 'pt-BR' },
];
assert.match(service.preferredVoice().name, /Francisca/, 'Francisca Natural deve ser a voz pt-BR preferida');
service.voice = true;
service.setTvMode(true);
const deadline = new Date(Date.now() + 20 * 60000).toISOString();
const focus = {
  os: '2650766808',
  technician: 'GABRIEL DE MORAIS BRITO',
  tec1_kind: 'risk',
  tec1_minutes: 55,
  tec1_deadline: deadline,
};

service.syncTvFocus([focus]);
await new Promise((resolve) => setTimeout(resolve, 10));
service.syncTvFocus([focus]);
await new Promise((resolve) => setTimeout(resolve, 10));

assert.equal(messages.length, 1, 'A mesma prioridade visivel nao pode ser repetida');
assert.match(messages[0].text, /faltam 20 minutos/);
assert.equal(messages[0].rate, 1.18);

service.syncTvFocus([{ ...focus, tec1_minutes: 9, tec1_deadline: new Date(Date.now() + 9 * 60000).toISOString() }]);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(messages.length, 2, 'A mudanca para a faixa de 15 minutos deve ser anunciada');

const urgentDeadline = new Date(Date.now() - 45 * 60000).toISOString();
service.syncTvFocus([{ ...focus, contract: '408676249', tec1_kind: 'late', tec1_deadline: urgentDeadline, deadline_basis: 'official_window' }]);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.match(messages.at(-1).text, /Baixe imediatamente o contrato/);

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

// Teste da reproducao com Edge Neural TTS via Audio element
let playedAudios = [];
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
  createObjectURL: (blob) => `blob://test-audio-${blob?.size || 1}`,
  revokeObjectURL: () => {},
};
globalThis.fetch = async (url, options) => {
  if (url === '/api/v1/voice/speak') {
    const body = JSON.parse(options.body);
    if (body.text.includes('FAIL_EDGE')) {
      return { ok: false, status: 500 };
    }
    return {
      ok: true,
      headers: new Map([['content-type', 'audio/mpeg']]),
      blob: async () => ({ size: 42 }),
    };
  }
  return { ok: false, status: 404 };
};

const edgeService = new AlertService();
edgeService.voice = true;
edgeService.setEdgeVoice('pt-BR-AntonioNeural');
assert.equal(edgeService.edgeVoice, 'pt-BR-AntonioNeural');
assert.equal(storage.get('dominium-toa-edge-voice'), 'pt-BR-AntonioNeural');

edgeService.setTvMode(true);
edgeService.syncTvFocus([{ ...focus, os: '999111', tec1_deadline: new Date(Date.now() + 12 * 60000).toISOString() }]);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(playedAudios.length, 1, 'Audio element deve reproduzir o audio sintetizado via Edge TTS');

// Teste de fallback quando o endpoint falha
const fallbackMessages = [];
const originalSpeak = globalThis.speechSynthesis.speak;
globalThis.speechSynthesis.speak = (u) => {
  fallbackMessages.push(u.text);
  queueMicrotask(() => u.onend?.());
};
edgeService.syncTvFocus([{ ...focus, os: 'FAIL_EDGE_1', technician: 'FAIL_EDGE', tec1_deadline: new Date(Date.now() + 5 * 60000).toISOString() }]);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(fallbackMessages.length, 1, 'Deve realizar fallback para speechSynthesis caso Edge TTS falhe');
globalThis.speechSynthesis.speak = originalSpeak;

console.log('Voz do Modo TV: sincronizacao, deduplicacao, Edge Neural TTS e fallback validados.');

