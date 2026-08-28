import { normalize } from '../utils/text.js';

const VOICE_KEYS = 'dominium-toa-tec1-voice-keys-v4';
const EDGE_VOICE_KEY = 'dominium-toa-edge-voice';
const EDGE_RATE_KEY = 'dominium-toa-edge-rate';

export class AlertService {
  constructor() {
    this.notifications = localStorage.getItem('dominium-toa-notifications') === '1';
    this.voice = localStorage.getItem('dominium-toa-voice') === '1';
    this.edgeVoice = localStorage.getItem(EDGE_VOICE_KEY) || 'pt-BR-FranciscaNeural';
    this.edgeRate = localStorage.getItem(EDGE_RATE_KEY) || '+10%';
    this.spoken = this.loadKeys();
    this.notificationKeys = new Set();
    this.speaking = false;
    this.queue = [];
    this.tvMode = false;
    this.currentVoiceKeys = [];
    this.voiceGeneration = 0;
    this.currentAudio = null;
  }

  loadKeys() {
    try { return new Set(JSON.parse(localStorage.getItem(VOICE_KEYS) || '[]').slice(-600)); }
    catch (_) { return new Set(); }
  }

  persist() {
    localStorage.setItem(VOICE_KEYS, JSON.stringify([...this.spoken].slice(-600)));
  }

  setEdgeVoice(voiceName) {
    if (!voiceName) return;
    this.edgeVoice = String(voiceName).trim();
    localStorage.setItem(EDGE_VOICE_KEY, this.edgeVoice);
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
    } else {
      this.cancelVoice();
      this.spoken.clear();
      this.persist();
    }
    return this.voice;
  }

  cancelVoice() {
    this.voiceGeneration += 1;
    this.queue = [];
    this.speaking = false;
    this.currentVoiceKeys = [];
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch (_) {}
      this.currentAudio = null;
    }
    try {
      window.speechSynthesis?.cancel?.();
    } catch (_) {}
  }

  setTvMode(enabled) {
    const next = Boolean(enabled);
    if (this.tvMode === next) return;
    this.tvMode = next;
    this.cancelVoice();
  }

  tvVoiceKey(item, value = new Date()) {
    const now = value instanceof Date ? value : new Date(value || Date.now());
    const deadline = new Date(item?.tec1_deadline || '');
    const diff = deadline.getTime() - now.getTime();
    const minutes = Number.isFinite(diff) ? Math.ceil(diff / 60000) : Number(item?.tec1_minutes);
    const lateMinutes = minutes < 0 ? Math.abs(minutes) : 0;
    const officialWindow = item?.deadline_basis === 'official_window';
    const phase = officialWindow && lateMinutes >= 60 ? 'urgent-60'
      : officialWindow && lateMinutes >= 45 ? 'urgent-45'
        : minutes < 0 ? 'late'
          : minutes <= 15 ? 'risk-15' : minutes <= 30 ? 'risk-30' : 'risk-60';
    return `tv:${item?.os || '-'}:${item?.tec1_deadline || '-'}:${phase}`;
  }

  syncTvFocus(items) {
    if (!this.tvMode || !this.voice) return;
    if (this.speaking) return;
    const now = new Date();
    const visible = (Array.isArray(items) ? items : [])
      .filter((item) => ['risk', 'late'].includes(item?.tec1_kind) && item?.tec1_deadline)
      .slice(0, 2)
      .map((item) => ({ ...item, voiceKey: this.tvVoiceKey(item, now) }));
    const pending = visible.filter((item) => !this.spoken.has(item.voiceKey));
    if (!pending.length) return;
    this.queue = [{ tv: true, alerts: pending, keys: pending.map((item) => item.voiceKey) }];
    this.processVoice();
  }

  notify(model) {
    if (!model || model.isDemo) return;
    const rows = model.views?.monitor?.rows || [];
    const riskAlerts = window.DominiumMonitor?.buildTec1ContractAlerts(rows) || [];
    const urgentAlerts = window.DominiumMonitor?.buildUrgentCloseAlerts(rows, new Date(model.generatedAt || Date.now())) || [];
    const alerts = [...urgentAlerts, ...riskAlerts];
    for (const alert of alerts) {
      if (this.notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted' && !this.notificationKeys.has(alert.key)) {
        this.notificationKeys.add(alert.key);
        const urgent = alert.kind === 'urgent-late';
        new Notification(urgent ? 'TOA - BAIXA URGENTE' : 'TOA - TEC1 em risco', {
          body: urgent
            ? `Contrato ${alert.contract || '-'} | ${alert.technician || 'Técnico'} | ${alert.label || ''}`
            : `${alert.technician || 'Técnico'} | Contrato ${alert.contract || '-'} | ${alert.label || ''}`,
          tag: `toa-tec1-${alert.key}`,
          icon: '/assets/brands/logo-novo.png',
          requireInteraction: urgent,
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

  isVoiceBusy() {
    return Boolean(this.voice && this.speaking);
  }

  async playEdgeAudio(spoken, generation, finish) {
    try {
      try { window.speechSynthesis?.cancel?.(); } catch (_) {}
      if (typeof fetch === 'undefined' || typeof Audio === 'undefined') {
        finish();
        return;
      }
      const response = await fetch('/api/v1/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spoken,
          voice: this.edgeVoice || 'pt-BR-FranciscaNeural',
          rate: this.edgeRate || '+10%',
        }),
      });
      if (!response.ok) {
        finish();
        return;
      }
      const blob = await response.blob();
      if (generation !== this.voiceGeneration) return;

      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.src = audioUrl;
      this.currentAudio = audio;
      const cleanup = () => {
        try { URL.revokeObjectURL(audioUrl); } catch (_) {}
        this.currentAudio = null;
        finish();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      await audio.play();
    } catch (_) {
      finish();
    }
  }

  processVoice() {
    if (!this.voice || this.speaking || !this.queue.length) return;
    this.speaking = true;
    const alert = this.queue.shift();
    const keys = alert.tv ? alert.keys : [alert.key];
    const message = alert.tv
      ? window.DominiumMonitor?.buildTvVoiceMessage(alert.alerts, new Date())
      : alert.message || window.DominiumMonitor?.buildTec1VoiceMessage(alert) || 'Alerta de TEC1.';
    if (!message) {
      this.speaking = false;
      return;
    }
    const spoken = window.DominiumMonitor?.speechPronunciationText(message) || message;
    keys.forEach((key) => this.spoken.add(key));
    this.persist();
    this.currentVoiceKeys = keys;
    const generation = ++this.voiceGeneration;
    const finish = () => {
      if (generation !== this.voiceGeneration) return;
      this.speaking = false;
      this.currentVoiceKeys = [];
      this.currentAudio = null;
      window.setTimeout(() => this.processVoice(), 120);
    };

    this.playEdgeAudio(spoken, generation, finish);
  }
}
