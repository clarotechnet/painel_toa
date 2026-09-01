export function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function normalizeKey(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalize(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

export function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function localClock(value = new Date()) {
  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatPtBrDate(value) {
  const raw = text(value);
  if (!raw) return '-';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const br = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{2}|\d{4})/);
  if (br) return `${br[1]}-${br[2]}-${br[3].length === 2 ? `20${br[3]}` : br[3]}`;
  return raw;
}

export function formatPtBrDateTime(value) {
  const raw = text(value);
  if (!raw || raw === '-') return '-';
  const date = formatPtBrDate(raw);
  const clock = raw.match(/[T\s](\d{1,2}:\d{2})(?::\d{2})?/);
  return clock && date !== raw ? `${date} ${clock[1]}` : date;
}

export function formatPtBrSchedule(value) {
  const raw = text(value);
  if (!raw || raw === '-') return '-';
  const cleanInterval = raw.match(/^\s*(\d{1,2}(?::\d{2})?)\s*[-—–]\s*(\d{1,2}(?::\d{2})?)\s*$/);
  if (cleanInterval) {
    const s = cleanInterval[1].includes(':') ? cleanInterval[1].padStart(5, '0') : `${cleanInterval[1].padStart(2, '0')}:00`;
    const e = cleanInterval[2].includes(':') ? cleanInterval[2].padStart(5, '0') : `${cleanInterval[2].padStart(2, '0')}:00`;
    return `${s} - ${e}`;
  }
  const clocks = raw.match(/\b\d{1,2}:\d{2}\b/g);
  if (clocks && clocks.length >= 2) {
    return `${clocks[0]} - ${clocks[1]}`;
  }
  if (clocks && clocks.length === 1 && (/[-—–]\s*0\b|\b0\s*[-—–]/.test(raw) || !raw.includes('-'))) {
    return clocks[0];
  }
  return raw
    .replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3-$2-$1')
    .replace(/(\d{2})\/(\d{2})\/(\d{2})(?!\d)/g, '$1-$2-20$3')
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/g, '$1-$2-$3')
    .replace(/T(?=\d{1,2}:\d{2})/g, ' ');
}
