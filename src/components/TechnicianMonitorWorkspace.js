import {
  loadTechnicianLocationSummary,
  loadTechnicianLocationTrack,
  signInTechnicianHistory,
  splitGpsTrack,
} from '../services/technicianLocationService.js';
import { escapeHtml, formatPtBrDateTime, normalize } from '../utils/text.js';

let routeMap;
let routeLayer;
let leafletPromise;
let selectedProfiles = [];
let operationalRoster = [];
let currentSummaryItems = [];
let summarySearch = '';

const PROFILE_BY_BUCKET_PREFIX = {
  NTL: 'natal',
  PWM: 'natal',
  FTZ: 'fortaleza',
  MRO: 'mossoro',
  JCR: 'recife',
  REC: 'recife',
  JAB: 'recife',
  OLI: 'recife',
};

const PROFILE_LABELS = {
  natal: 'Natal / Parnamirim',
  fortaleza: 'Fortaleza',
  mossoro: 'Mossoró',
  recife: 'Recife',
};

export function technicianLocationProfile(item = {}) {
  const explicit = String(item.profile || '').trim().toLowerCase();
  if (explicit && explicit !== 'other') return explicit;
  const prefix = String(item.bucket || '').trim().toUpperCase().split('-', 1)[0];
  return PROFILE_BY_BUCKET_PREFIX[prefix] || 'other';
}

export function filterTechnicianLocationsByProfiles(items = [], profiles = []) {
  const selected = new Set(Array.isArray(profiles) ? profiles.filter(Boolean) : []);
  if (!selected.size) return [...items];
  return items.filter((item) => selected.has(technicianLocationProfile(item)));
}

export function mergeTechnicianLocationRoster(locationItems = [], roster = []) {
  const merged = new Map();
  const keyFor = (item) => String(item.technician_login || item.technician_id || item.technician_name || '').trim().toUpperCase();
  for (const item of locationItems) {
    const key = keyFor(item);
    if (key) merged.set(key, { ...item });
  }
  for (const technician of roster) {
    const key = keyFor(technician);
    if (!key) continue;
    const location = merged.get(key);
    if (location) {
      merged.set(key, {
        ...technician,
        ...location,
        bucket: location.bucket || technician.bucket || '',
        profile: location.profile && location.profile !== 'other'
          ? location.profile : technician.profile || location.profile || 'other',
      });
    } else {
      merged.set(key, {
        ...technician,
        distance_km: 0,
        point_count: 0,
        first_at: '',
        last_at: '',
        points: [],
      });
    }
  }
  return [...merged.values()].sort((left, right) => (
    Number(right.distance_km || 0) - Number(left.distance_km || 0)
    || String(left.technician_name || '').localeCompare(String(right.technician_name || ''), 'pt-BR')
  ));
}

function selectedProfilesLabel() {
  if (!selectedProfiles.length) return 'Todas as cidades';
  return selectedProfiles.map((profile) => PROFILE_LABELS[profile] || profile).join(' + ');
}

function leaflet() {
  if (!leafletPromise) {
    leafletPromise = import('https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js')
      .then((module) => module.default || module);
  }
  return leafletPromise;
}

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function clock(value) {
  return value ? formatPtBrDateTime(value) : '—';
}

function destroyMap() {
  if (routeMap) routeMap.remove();
  routeMap = null;
  routeLayer = null;
}

async function drawTrack(points, visits = [], plannedRoute = []) {
  const root = document.querySelector('#technicianRouteMap');
  if (!root) return;
  const L = await leaflet();
  destroyMap();
  routeMap = L.map(root, { zoomControl: true, preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(routeMap);
  const gpsSegments = splitGpsTrack(points || []);
  const routePoints = gpsSegments.flat().map((point) => ({
      point,
      coordinate: [Number(point.latitude), Number(point.longitude)],
    }));
  const coordinates = routePoints.map(({ coordinate }) => coordinate);
  const plannedCoordinates = (plannedRoute || [])
    .map((point) => [Number(point.latitude), Number(point.longitude)])
    .filter(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude));
  const visitPoints = (visits || [])
    .map((visit, index) => {
      const encodedLabel = String(visit.marker_label || String.fromCharCode(65 + Math.min(index, 25)));
      return {
        visit,
        warning: encodedLabel.startsWith('!:'),
        label: encodedLabel.replace(/^!:/, '').slice(0, 2),
        coordinate: [Number(visit.latitude), Number(visit.longitude)],
      };
    })
    .filter(({ coordinate: [latitude, longitude] }) => Number.isFinite(latitude) && Number.isFinite(longitude));
  if (!routePoints.length && !visitPoints.length) {
    routeMap.setView([-5.5, -37.5], 6);
    return;
  }
  routeLayer = L.featureGroup().addTo(routeMap);
  // A linha planejada só existe quando a fonte fornece a geometria real. Nunca
  // ligamos as paradas das OS para inventar uma rota. A trilha tracejada abaixo
  // conecta exclusivamente amostras GPS reais e não entra como rota planejada.
  if (plannedCoordinates.length > 1) {
    L.polyline(plannedCoordinates, { color: '#1746d1', weight: 5, opacity: 0.9 }).addTo(routeLayer);
  }
  gpsSegments.filter((segment) => segment.length > 1).forEach((segment) => {
    L.polyline(segment.map((point) => [Number(point.latitude), Number(point.longitude)]), {
      color: '#36a9ff', weight: 3, opacity: 0.86,
    }).addTo(routeLayer);
  });
  routePoints.forEach(({ point, coordinate }, index) => {
    L.circleMarker(coordinate, {
      radius: index === 0 || index === coordinates.length - 1 ? 6 : 3,
      color: index === 0 ? '#26c281' : index === coordinates.length - 1 ? '#ff334d' : '#56a8ff',
      fillOpacity: 0.95,
      weight: 2,
    }).bindTooltip(`${index + 1}. ${clock(point.observed_at)}<br>${coordinate[0].toFixed(5)}, ${coordinate[1].toFixed(5)}`)
      .addTo(routeLayer);
  });
  visitPoints.forEach(({ visit, warning, label, coordinate }) => {
    const square = label === '■' || String(visit.activity_id || '').startsWith('map-special:');
    const marker = L.marker(coordinate, {
      icon: L.divIcon({
        className: `technician-service-marker-shell${warning ? ' is-warning' : ''}${square ? ' is-square' : ''}`,
        html: `<span class="technician-service-marker"><b>${escapeHtml(label)}</b></span>`,
        iconSize: [28, 36],
        iconAnchor: [14, 34],
        popupAnchor: [0, -32],
      }),
      zIndexOffset: 500,
    });
    const facts = [
      ['Status', visit.status],
      ['Serviço', visit.service],
      ['Contrato', visit.contract],
      ['OS', visit.os_number],
      ['Janela', visit.service_window],
      ['Horário', visit.scheduled_at ? clock(visit.scheduled_at) : ''],
      ['Atividade', visit.activity_id],
    ].filter(([, value]) => String(value || '').trim());
    marker.bindPopup(`<div class="technician-service-popup"><strong><i>${escapeHtml(label)}</i> Atendimento TOA</strong>${facts.map(([name, value]) => `<span><b>${escapeHtml(name)}</b>${escapeHtml(value)}</span>`).join('')}</div>`);
    marker.addTo(routeLayer);
  });
  routeMap.fitBounds(routeLayer.getBounds(), { padding: [24, 24], maxZoom: 17 });
}

function setStatus(message, kind = '') {
  const target = document.querySelector('#technicianMonitorStatus');
  if (!target) return;
  target.className = `technician-monitor-status ${kind}`;
  target.textContent = message;
}

function renderTable(items) {
  const body = document.querySelector('#technicianSummaryRows');
  if (!body) return;
  body.innerHTML = items.length ? items.map((item) => `
    <tr data-technician-key="${escapeHtml(item.technician_login || item.technician_id)}">
      <td><strong>${escapeHtml(item.technician_name || 'Técnico não identificado')}</strong><small>${escapeHtml(item.technician_login || item.technician_id || '—')}</small></td>
      <td>${escapeHtml(item.bucket || '—')}</td>
      <td>${Number(item.distance_km || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km</td>
      <td>${Number(item.point_count || 0).toLocaleString('pt-BR')}</td>
      <td>${Number(item.visit_count || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(clock(item.first_at))}</td>
      <td>${escapeHtml(clock(item.last_at))}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty-table">Nenhum técnico encontrado nesta data e seleção.</td></tr>';
}

function filteredSummaryItems() {
  const query = normalize(summarySearch);
  if (!query) return currentSummaryItems;
  return currentSummaryItems.filter((item) => normalize([
    item.technician_name,
    item.technician_login,
    item.technician_id,
    item.bucket,
  ].filter(Boolean).join(' ')).includes(query));
}

function renderFilteredSummary() {
  const items = filteredSummaryItems();
  renderTable(items);
  const count = document.querySelector('#technicianSummaryCount');
  if (count) count.textContent = summarySearch
    ? `${items.length} de ${currentSummaryItems.length}`
    : `${currentSummaryItems.length} técnicos`;
}

async function selectTechnician(identifier, date) {
  if (!identifier) {
    await drawTrack([]);
    return;
  }
  setStatus('Carregando trajeto do técnico…');
  const track = await loadTechnicianLocationTrack(identifier, date);
  document.querySelector('#routeDistance').textContent = `${Number(track.distance_km || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  document.querySelector('#routePoints').textContent = Number(track.point_count || 0).toLocaleString('pt-BR');
  document.querySelector('#routeTechnician').textContent = track.technician?.name || identifier;
  await drawTrack(track.points || [], track.visits || [], track.planned_route || []);
  if (track.point_count) {
    setStatus(`Trajeto carregado · ${track.provider === 'firebase' ? 'Firebase histórico' : 'API local'}`, 'online');
  } else {
    setStatus('O técnico ainda não possui pontos nesta data.', 'warning');
  }
}

async function loadDay({ interactive = false } = {}) {
  const date = document.querySelector('#technicianMonitorDate')?.value || today();
  setStatus('Consultando histórico de localização…');
  const summary = await loadTechnicianLocationSummary(date, { interactive });
  const access = document.querySelector('#technicianHistoryAccess');
  if (!summary.ok && summary.requiresAuth) {
    access?.classList.remove('hidden');
    setStatus('Entre com uma conta Google autorizada para consultar o histórico publicado.', 'warning');
    renderTable([]);
    await drawTrack([]);
    return;
  }
  if (!summary.ok && summary.unauthorized) {
    access?.classList.remove('hidden');
    access.innerHTML = `<strong>Conta ainda não autorizada.</strong><span>Cadastre este UID no Firebase: ${escapeHtml(summary.uid || '')}</span>`;
    setStatus(`Acesso negado para ${summary.email || 'esta conta'}.`, 'error');
    return;
  }
  access?.classList.add('hidden');
  const allItems = mergeTechnicianLocationRoster(summary.items || [], operationalRoster);
  const items = filterTechnicianLocationsByProfiles(allItems, selectedProfiles);
  const techniciansWithGps = items.filter((item) => Number(item.point_count || 0) > 0).length;
  currentSummaryItems = items;
  renderFilteredSummary();
  document.querySelector('#dayTechnicians').textContent = Number(items.length).toLocaleString('pt-BR');
  document.querySelector('#dayPoints').textContent = Number(items.reduce((total, item) => total + Number(item.point_count || 0), 0)).toLocaleString('pt-BR');
  document.querySelector('#dayDistance').textContent = `${items.reduce((total, item) => total + Number(item.distance_km || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  const select = document.querySelector('#technicianMonitorSelect');
  select.innerHTML = '<option value="">Selecione um técnico</option>' + items.map((item) => `<option value="${escapeHtml(item.technician_login || item.technician_id)}">${escapeHtml(item.technician_name)} · ${escapeHtml(item.bucket || 'sem bucket')}</option>`).join('');
  await drawTrack([]);
  if (items.length) {
    const hidden = Math.max(0, allItems.length - items.length);
    setStatus(`${items.length} técnicos em ${selectedProfilesLabel()} · ${techniciansWithGps} com GPS capturado${hidden ? ` · ${hidden} fora do filtro` : ''}. Selecione um para ver o mapa.`, techniciansWithGps ? 'online' : 'warning');
  } else if (allItems.length && selectedProfiles.length) {
    setStatus(`Há ${allItems.length} técnicos no histórico, mas nenhum pertence a ${selectedProfilesLabel()}.`, 'warning');
  } else {
    setStatus('O Bridge ainda não capturou pontos nesta data.', 'warning');
  }
}

export function TechnicianMonitorWorkspace() {
  return `<section class="workspace technician-monitor-workspace">
    <header class="workspace-heading technician-monitor-heading">
      <div><p class="eyebrow">MONITORAMENTO DE CAMPO</p><h2>Monitoramento Técnico</h2><p>Quilometragem diária e deslocamento ponto a ponto capturados pelo TOA.</p></div>
      <div class="technician-monitor-controls">
        <label>Data<input id="technicianMonitorDate" type="date" value="${today()}" max="${today()}"></label>
        <button id="technicianMonitorRefresh" type="button"><i data-lucide="refresh-cw"></i> Atualizar</button>
      </div>
    </header>
    <div id="technicianHistoryAccess" class="technician-history-access hidden"><strong>Histórico protegido</strong><span>A localização dos técnicos exige uma conta autorizada.</span><button id="technicianHistorySignIn" type="button">Entrar com Google</button></div>
    <p id="technicianMonitorStatus" class="technician-monitor-status">Preparando consulta…</p>
    <div class="technician-monitor-kpis">
      <article><span>Técnicos no dia</span><strong id="dayTechnicians">0</strong></article>
      <article><span>Distância total</span><strong id="dayDistance">0,00 km</strong></article>
      <article><span>Pontos recebidos</span><strong id="dayPoints">0</strong></article>
      <article><span>Técnico selecionado</span><strong id="routeTechnician">—</strong></article>
      <article><span>KM selecionado</span><strong id="routeDistance">0,00 km</strong></article>
      <article><span>Pontos no trajeto</span><strong id="routePoints">0</strong></article>
    </div>
    <section class="technician-route-card">
      <div class="technician-route-toolbar"><div><h3>Mapa de deslocamento</h3><p>Cada ponto mostra o horário registrado pelo TOA.</p><p class="technician-map-legend"><span>● GPS real</span><span>Ⓐ Parada de OS</span><span>━ Rota planejada (somente quando fornecida pelo TOA)</span></p></div><select id="technicianMonitorSelect" aria-label="Selecionar técnico"><option value="">Selecione um técnico</option></select></div>
      <div id="technicianRouteMap" class="technician-route-map" aria-label="Mapa do deslocamento do técnico"></div>
    </section>
    <section class="technician-summary-card"><div class="technician-summary-heading"><div><h3>Resumo por técnico</h3><p>Selecione uma linha para abrir o trajeto e os atendimentos no mapa.</p></div><label class="technician-summary-search"><span id="technicianSummaryCount">0 técnicos</span><input id="technicianSummarySearch" type="search" value="${escapeHtml(summarySearch)}" placeholder="Filtrar por nome, login ou bucket" autocomplete="off"></label></div><div class="table-scroll"><table><thead><tr><th>Técnico</th><th>Bucket</th><th>KM</th><th>Pontos</th><th>Atendimentos</th><th>Primeiro ponto</th><th>Último ponto</th></tr></thead><tbody id="technicianSummaryRows"></tbody></table></div></section>
  </section>`;
}

export async function mountTechnicianMonitor({ profiles = [], roster = [] } = {}) {
  selectedProfiles = Array.isArray(profiles) ? [...profiles] : [];
  operationalRoster = Array.isArray(roster) ? [...roster] : [];
  document.querySelector('#technicianMonitorRefresh')?.addEventListener('click', () => loadDay().catch((error) => setStatus(error.message, 'error')));
  document.querySelector('#technicianMonitorDate')?.addEventListener('change', () => loadDay().catch((error) => setStatus(error.message, 'error')));
  document.querySelector('#technicianMonitorSelect')?.addEventListener('change', (event) => selectTechnician(event.target.value, document.querySelector('#technicianMonitorDate').value).catch((error) => setStatus(error.message, 'error')));
  document.querySelector('#technicianSummarySearch')?.addEventListener('input', (event) => {
    summarySearch = event.target.value;
    renderFilteredSummary();
  });
  document.querySelector('#technicianHistorySignIn')?.addEventListener('click', async () => {
    try {
      await signInTechnicianHistory();
      await loadDay({ interactive: false });
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  document.querySelector('#technicianSummaryRows')?.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-technician-key]');
    if (!row) return;
    const select = document.querySelector('#technicianMonitorSelect');
    select.value = row.dataset.technicianKey;
    select.dispatchEvent(new Event('change'));
  });
  await loadDay();
}
