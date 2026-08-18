import assert from 'node:assert/strict';
import { AlertService } from '../src/services/alertService.js';
import '../src/core/operations-monitor.js';

const storage = new Map();
const messages = [];

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

const service = new AlertService();
service.voice = true;
service.setTvMode(true);
const deadline = new Date(Date.now() + 10 * 60000).toISOString();
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
assert.match(messages[0].text, /faltam 10 minutos/);
assert.equal(messages[0].rate, 1.18);

service.syncTvFocus([{ ...focus, tec1_minutes: 9 }]);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(messages.length, 2, 'A mudanca para a faixa de 15 minutos deve ser anunciada');

console.log('Voz do Modo TV: sincronizacao, deduplicacao e velocidade validadas.');
