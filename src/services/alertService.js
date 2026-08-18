import { normalize } from '../utils/text.js';

const VOICE_KEYS = 'dominium-toa-tec1-voice-keys-v2';

export class AlertService {
  constructor() {
    this.notifications = localStorage.getItem('dominium-toa-notifications') === '1';
    this.voice = localStorage.getItem('dominium-toa-voice') === '1';
    this.spoken = this.loadKeys();
    this.notificationKeys = new Set();
    this.speaking = false;
    this.queue = [];
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
      this.queue = [];
      window.speechSynthesis?.cancel?.();
    } else {
      this.queue.push({ key: `enabled-${Date.now()}`, message: 'Alertas de voz do téqui um ativados.' });
      this.processVoice();
    }
    return this.voice;
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
      if (this.voice && !this.spoken.has(alert.key) && this.queue.length < 12) {
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
    const message = alert.message || window.DominiumMonitor?.buildTec1VoiceMessage(alert) || 'Alerta de TEC1.';
    const spoken = window.DominiumMonitor?.speechPronunciationText(message) || message;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = this.preferredVoice();
    if (voice) utterance.voice = voice;
    this.speaking = true;
    const finish = () => {
      this.speaking = false;
      window.setTimeout(() => this.processVoice(), 350);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }
}
