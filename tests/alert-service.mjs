import assert from 'node:assert/strict';
import { AlertService } from '../src/services/alertService.js';
import '../src/core/operations-monitor.js';

const storage = new Map();
const messages = [];
const notifications = [];

globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.window = globalThis;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
  getVoices: () => [],
  cancel: () => {},
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

console.log('Voz do Modo TV: sincronizacao, deduplicacao e velocidade validadas.');
