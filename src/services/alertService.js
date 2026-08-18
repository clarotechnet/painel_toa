import { normalize } from '../utils/text.js';

const VOICE_KEYS = 'dominium-toa-tec1-voice-keys-v3';

export class AlertService {
  constructor() {
    this.notifications = localStorage.getItem('dominium-toa-notifications') === '1';
    this.voice = localStorage.getItem('dominium-toa-voice') === '1';
    this.spoken = this.loadKeys();
    this.notificationKeys = new Set();
    this.speaking = false;
    this.queue = [];
    this.tvMode = false;
    this.currentVoiceKeys = [];
    this.voiceGeneration = 0;
  }

  loadKeys() {
    try { return new Set(JSON.parse(localStorage.getItem(VOICE_KEYS) || '[]').slice(-600)); }
    catch (_) { return new Set(); }
  }

  persist() {
    localStorage.setItem(VOICE_KEYS, JSON.stringify([...this.spoken].slice(-600)));
  }

  async toggleNotifications() {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }
    this.notifications = !this.notifications;
    localStorage.setItem('dominium-toa-notifications', this.notifications ? '1' : '0');
    return this.notifications;
  }

  toggleVoice() {
    this.voice = !this.voice;
    localStorage.setItem('dominium-toa-voice', this.voice ? '1' : '0');
    if (!this.voice) {
      this.cancelVoice();
    }
    return this.voice;
  }

  cancelVoice() {
    this.voiceGeneration += 1;
    this.queue = [];
    this.speaking = false;
    this.currentVoiceKeys = [];
    window.speechSynthesis?.cancel?.();
  }

  setTvMode(enabled) {
    const next = Boolean(enabled);
    if (this.tvMode === next) return;
    this.tvMode = next;
    this.cancelVoice();
  }

  tvVoiceKey(item) {
    const minutes = Number(item?.tec1_minutes);
    const phase = item?.tec1_kind === 'late' || minutes < 0 ? 'late'
      : minutes <= 15 ? 'risk-15' : minutes <= 30 ? 'risk-30' : 'risk-60';
    return `tv:${item?.os || '-'}:${item?.tec1_deadline || '-'}:${phase}`;
  }

  syncTvFocus(items) {
    if (!this.tvMode || !this.voice) return;
    const visible = (Array.isArray(items) ? items : [])
      .filter((item) => ['risk', 'late'].includes(item?.tec1_kind) && item?.tec1_deadline)
      .slice(0, 2)
      .map((item) => ({ ...item, voiceKey: this.tvVoiceKey(item) }));
    const visibleKeys = new Set(visible.map((item) => item.voiceKey));
    if (this.speaking && this.currentVoiceKeys.some((key) => !visibleKeys.has(key))) {
      this.cancelVoice();
    }
    const pending = visible.filter((item) => !this.spoken.has(item.voiceKey));
    this.queue = pending.length ? [{ tv: true, alerts: pending, keys: pending.map((item) => item.voiceKey) }] : [];
    this.processVoice();
  }

  notify(model) {
    if (!model || model.isDemo) return;
    const alerts = window.DominiumMonitor?.buildTec1ContractAlerts(model.views?.monitor?.rows || []) || [];
    for (const alert of alerts) {
      if (this.notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted' && !this.notificationKeys.has(alert.key)) {
        this.notificationKeys.add(alert.key);
        new Notification(alert.kind === 'late' ? 'TOA - TEC1 estourada' : 'TOA - TEC1 em risco', {
          body: `${alert.technician || 'Técnico'} | Contrato ${alert.contract || '-'} | ${alert.label || ''}`,
          tag: `toa-tec1-${alert.key}`,
        });
      }
      if (!this.tvMode && this.voice && !this.spoken.has(alert.key) && this.queue.length < 4) {
        this.spoken.add(alert.key);
        this.queue.push(alert);
      }
    }
    this.persist();
    this.processVoice();
  }

  preferredVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const pt = voices.filter((voice) => /^pt(?:-|_)/i.test(voice.lang || ''));
    const score = (voice) => {
      const name = normalize(voice.name);
      return (name.includes('NATURAL') ? 100 : 0) + (name.includes('GOOGLE') ? 80 : 0)
        + (name.includes('FRANCISCA') ? 70 : 0) + (name.includes('ANTONIO') ? 65 : 0)
        + (name.includes('MICROSOFT') ? 50 : 0) + (/^pt-BR$/i.test(voice.lang || '') ? 30 : 0);
    };
    return pt.sort((a, b) => score(b) - score(a))[0] || null;
  }

  processVoice() {
    if (!this.voice || this.speaking || !this.queue.length || !('speechSynthesis' in window)) return;
    const alert = this.queue.shift();
    const keys = alert.tv ? alert.keys : [alert.key];
    const message = alert.tv
      ? window.DominiumMonitor?.buildTvVoiceMessage(alert.alerts, new Date())
      : alert.message || window.DominiumMonitor?.buildTec1VoiceMessage(alert) || 'Alerta de TEC1.';
    if (!message) return;
    const spoken = window.DominiumMonitor?.speechPronunciationText(message) || message;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.18;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    const voice = this.preferredVoice();
    if (voice) utterance.voice = voice;
    keys.forEach((key) => this.spoken.add(key));
    this.persist();
    this.speaking = true;
    this.currentVoiceKeys = keys;
    const generation = ++this.voiceGeneration;
    const finish = () => {
      if (generation !== this.voiceGeneration) return;
      this.speaking = false;
      this.currentVoiceKeys = [];
      window.setTimeout(() => this.processVoice(), 120);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }
}
