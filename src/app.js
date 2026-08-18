import { Shell } from './components/Shell.js';
import { MonitorWorkspace } from './components/MonitorWorkspace.js';
import { DashboardWorkspace } from './components/DashboardWorkspace.js';
import { OrdersWorkspace } from './components/OrdersWorkspace.js';
import { ImportWorkspace } from './components/ImportWorkspace.js';
import { TechniciansWorkspace } from './components/TechniciansWorkspace.js';
import { loadToaFiles } from './services/csvService.js';
import {
  datalakeUsesRealtime,
  loadDatalakeFeed,
  subscribeDatalakeFeed,
} from './services/datalakeService.js';
import { loadTechnicianDirectory, applyTechnicianNames } from './services/technicianService.js';
import { AlertService } from './services/alertService.js';
import { createStore } from './state/store.js';
import { escapeHtml, normalize, localClock } from './utils/text.js';

const PROFILE_DEFS = [
  { key: 'natal', label: 'NATAL / PARNAMIRIM', cities: ['NATAL', 'PARNAMIRIM'], bucketPrefixes: ['NTL', 'PWM'] },
  { key: 'fortaleza', label: 'FORTALEZA', cities: ['FORTALEZA', 'MARACANAU', 'CAUCAIA'], bucketPrefixes: ['FTZ'] },
  { key: 'mossoro', label: 'MOSSORÓ', cities: ['MOSSORO', 'MOSSORÓ'], bucketPrefixes: ['MRO'] },
  { key: 'recife', label: 'RECIFE', cities: ['RECIFE', 'OLINDA', 'JABOATAO DOS GUARARAPES', 'JABOATÃO DOS GUARARAPES'], bucketPrefixes: ['JCR', 'REC', 'JAB', 'OLI'] },
];

function toast(message, kind = 'info') {
  const stack = document.querySelector('#toastStack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.innerHTML = `<span>${escapeHtml(message)}</span>`;
  stack.append(item);
  setTimeout(() => item.remove(), 5000);
}

export function orderProfile(order) {
  const city = normalize(order.city || '');
  const bucket = normalize(order.bucket || '');
  return PROFILE_DEFS.find((profile) => profile.cities.some((value) => city.includes(normalize(value)))
    || profile.bucketPrefixes.some((prefix) => bucket.startsWith(prefix)))?.key || 'other';
}

function selectedSnapshot(state) {
  if (state.demo) {
    const orders = state.demoOrders || window.DominiumMonitor.buildMeetingExamples(new Date());
    return { files: [], orders, timelineActivities: [], errors: [], loadedAt: new Date().toISOString(), demo: true };
  }
  if (state.city === 'all') return state.snapshot;
  const orders = state.snapshot.orders.filter((order) => orderProfile(order) === state.city);
  const loginSet = new Set(orders.map((order) => normalize(order.technician_login || order.technician)));
  const timelineActivities = state.snapshot.timelineActivities.filter((item) => {
    const login = normalize(item.technician_login || item.technician);
    return loginSet.has(login) || orderProfile(item) === state.city;
  });
  return { ...state.snapshot, orders, timelineActivities };
}

function buildModel(state) {
  const snap = selectedSnapshot(state);
  return window.DominiumMonitor.buildMonitorModel(snap.orders, {
    now: new Date(),
    timelineActivities: snap.timelineActivities,
  });
}

function renderProfileTabs(store) {
  const state = store.get();
  const root = document.querySelector('#profileTabs');
  if (!root) return;
  const counts = Object.fromEntries(PROFILE_DEFS.map((profile) => [profile.key, 0]));
  state.snapshot.orders.forEach((order) => {
    const profile = orderProfile(order);
    if (profile in counts) counts[profile] += 1;
  });
  const visibleProfiles = PROFILE_DEFS.filter((profile) => counts[profile.key] > 0 || !state.snapshot.orders.length);
  root.innerHTML = visibleProfiles.map((profile) => `<button type="button" data-profile="${profile.key}" class="profile-tab ${state.city === profile.key ? 'active' : ''}">${escapeHtml(profile.label)}${counts[profile.key] ? `<small>${counts[profile.key]}</small>` : ''}</button>`).join('');
  root.querySelectorAll('[data-profile]').forEach((button) => button.addEventListener('click', () => {
    store.set({ city: button.dataset.profile });
    renderProfileTabs(store);
    renderActiveModule(store);
  }));
}

function filterRows(rows, state) {
  const term = normalize(state.search);
  return rows.filter((row) => {
    if (state.bucket !== 'all' && row.bucket !== state.bucket) return false;
    if (state.status !== 'all' && row.status_kind !== state.status && row.route_state !== state.status) return false;
    if (!term) return true;
    return normalize([row.os, row.contract, row.service, row.city, row.bucket, row.technician, row.status, row.observation].join(' ')).includes(term);
  });
}

function renderRouteDetail(activity) {
  if (!activity) return '<div class="route-console-empty">Selecione uma atividade.</div>';
  const alert = activity.alert ? `<div class="route-detail-alert ${escapeHtml(activity.alert.severity)}"><i data-lucide="triangle-alert"></i><div><strong>${escapeHtml(activity.alert.label)}</strong><span>${escapeHtml(activity.alert.detail)}</span></div></div>` : '';
  const facts = activity.is_auxiliary ? [
    ['Técnico', activity.technician], ['Bucket', activity.bucket], ['Início / fim', `${activity.actual_start} - ${activity.actual_end}`], ['Duração', activity.duration], ['Tipo', 'Pausa operacional do TOA'],
  ] : [
    ['Técnico', activity.technician], ['Bucket', activity.bucket], ['Contrato', activity.contract], ['Janela de serviço', `${activity.window_start} - ${activity.window_end}`], ['Início / fim', `${activity.actual_start} - ${activity.actual_end}`], ['Duração', activity.duration], ['Deslocamento', activity.travel_time], ['Cidade / node', `${activity.city} / ${activity.node}`], ['Área', activity.work_area], ['Código de baixa', activity.close_code], ['ID da atividade', activity.activity_id],
  ];
  return `<header class="route-detail-head"><div><span class="route-detail-eyebrow">ATIVIDADE SELECIONADA</span><h4>${activity.is_auxiliary ? 'REFEIÇÃO' : `OS ${escapeHtml(activity.os)}`}</h4><p>${escapeHtml(activity.service)}</p></div><span class="route-detail-status ${escapeHtml(activity.route_state)}">${escapeHtml(activity.route_state_label)}</span></header>${alert}<dl class="route-detail-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '-')}</dd></div>`).join('')}</dl><p class="route-detail-note">Leitura operacional baseada no CSV do TOA. O monitor funciona em modo somente leitura.</p>`;
}

function renderRouteConsole(consoleModel, state) {
  const root = document.querySelector('#monitorRouteConsole');
  const term = normalize(state.search);
  const techs = (consoleModel?.technicians || []).map((technician) => ({
    ...technician,
    activities: technician.activities.filter((activity) => {
      if (state.bucket !== 'all' && activity.bucket !== state.bucket) return false;
      if (state.status !== 'all' && activity.route_state !== state.status && activity.status_kind !== state.status) return false;
      if (!term) return true;
      return normalize([activity.os, activity.contract, activity.technician, activity.bucket, activity.service, activity.status, activity.city].join(' ')).includes(term);
    }),
  })).filter((technician) => technician.activities.length);
  const activities = techs.flatMap((technician) => technician.activities);
  if (!activities.length) {
    root.innerHTML = '<div class="route-console-empty">Nenhuma atividade corresponde aos filtros atuais.</div>';
    return;
  }
  const startHour = Number(consoleModel.startHour || 6);
  const endHour = Number(consoleModel.endHour || 22);
  const totalMinutes = Math.max(60, (endHour - startHour) * 60);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const now = new Date();
  const nowLeft = (((now.getHours() * 60 + now.getMinutes()) - startHour * 60) / totalMinutes) * 100;
  const activityMap = [];
  const rows = techs.map((technician) => {
    const blocks = technician.activities.map((activity) => {
      const index = activityMap.length;
      activityMap.push(activity);
      const rawStart = activity.start_minutes;
      const rawEnd = activity.end_minutes;
      const left = rawStart == null ? 1 : Math.max(0, Math.min(98, ((rawStart - startHour * 60) / totalMinutes) * 100));
      const width = rawStart == null || rawEnd == null ? 9 : Math.max(2.8, Math.min(100 - left, ((rawEnd - rawStart) / totalMinutes) * 100));
      const alertMark = activity.alert ? '<span class="route-activity-alert" aria-hidden="true">!</span>' : '';
      return `<button class="route-activity ${escapeHtml(activity.route_state)}${activity.alert ? ` has-alert ${escapeHtml(activity.alert.severity)}` : ''}" type="button" data-route-activity="${index}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%">${alertMark}<strong>${escapeHtml(activity.timeline_start || '--:--')}</strong><span>${escapeHtml(activity.service)}</span></button>`;
    }).join('');
    const initials = technician.technician.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('');
    return `<div class="route-technician-row"><div class="route-technician"><span class="route-technician-avatar">${escapeHtml(initials)}</span><div><strong>${escapeHtml(technician.technician)}</strong><small>${technician.activities.length} atividade${technician.activities.length === 1 ? '' : 's'}</small></div></div><div class="route-lane">${nowLeft >= 0 && nowLeft <= 100 ? `<span class="route-now-line" style="left:${nowLeft.toFixed(3)}%"><i></i></span>` : ''}${blocks}</div></div>`;
  }).join('');
  const visibleAlerts = activities.filter((activity) => activity.alert);
  const alertCards = visibleAlerts.length ? `<div class="route-smart-alerts">${visibleAlerts.slice(0, 5).map((activity) => `<button type="button" data-alert-os="${escapeHtml(activity.os)}" class="route-smart-alert ${escapeHtml(activity.alert.severity)}"><i data-lucide="triangle-alert"></i><span><strong>${escapeHtml(activity.alert.label)}</strong><small>OS ${escapeHtml(activity.os)} | ${escapeHtml(activity.technician)} | ${escapeHtml(activity.alert.detail)}</small></span><i data-lucide="chevron-right"></i></button>`).join('')}</div>` : '<div class="route-smart-clear"><i data-lucide="circle-check"></i><span>Nenhuma janela em risco na visão atual.</span></div>';
  root.innerHTML = `<div class="route-console-topbar"><div class="route-legend"><span><i class="completed"></i>Concluída</span><span><i class="started"></i>Iniciada</span><span><i class="pending"></i>Pendente / em rota</span><span><i class="suspended"></i>Suspensa / realocada</span><span><i class="auxiliary"></i>Refeição</span></div><span class="route-live-chip"><i></i>${state.snapshot.live ? 'TOA conectado · status atualizado automaticamente' : 'Leitura local · aguardando captura ao vivo do TOA'}</span></div>${alertCards}<div class="route-console-layout"><div class="route-timeline-card"><div class="route-timeline-scroll"><div class="route-timeline" style="--route-hours:${endHour - startHour}"><div class="route-hours-row"><div class="route-resource-title">RECURSOS</div><div class="route-hours">${hours.map((hour) => `<span style="left:${(((hour - startHour) / (endHour - startHour)) * 100).toFixed(3)}%">${String(hour).padStart(2, '0')}</span>`).join('')}</div></div>${rows}</div></div></div><aside class="route-detail" id="monitorRouteDetail">${renderRouteDetail(visibleAlerts[0] || activities.find((item) => item.route_state === 'started') || activities[0])}</aside></div>`;
  root.querySelectorAll('[data-route-activity]').forEach((button) => button.addEventListener('click', () => {
    const activity = activityMap[Number(button.dataset.routeActivity)];
    const detail = root.querySelector('#monitorRouteDetail');
    if (detail && activity) detail.innerHTML = renderRouteDetail(activity);
    root.querySelectorAll('.route-activity.selected').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
    window.lucide?.createIcons();
  }));
  root.querySelectorAll('[data-alert-os]').forEach((button) => button.addEventListener('click', () => {
    const activity = activities.find((item) => item.os === button.dataset.alertOs);
    const detail = root.querySelector('#monitorRouteDetail');
    if (detail && activity) detail.innerHTML = renderRouteDetail(activity);
    window.lucide?.createIcons();
  }));
}

function renderAttention(model) {
  const root = document.querySelector('#monitorAttentionStage');
  const alerts = model.views.routes?.console?.alerts || [];
  if (!alerts.length) {
    root.className = 'monitor-attention-stage hidden';
    root.innerHTML = '';
    return;
  }
  const alert = alerts[0];
  const critical = alert.severity === 'late';
  root.className = `monitor-attention-stage ${critical ? 'critical' : 'risk'}`;
  root.innerHTML = `<div class="monitor-attention-glow"></div><div class="monitor-attention-icon"><i data-lucide="triangle-alert"></i></div><div class="monitor-attention-copy"><div class="monitor-attention-kicker"><span class="monitor-attention-pulse"></span>${critical ? 'ATENÇÃO CRÍTICA' : 'JANELA EM RISCO'}</div><h3>${escapeHtml(alert.label)}</h3><p>OS ${escapeHtml(alert.os)} · ${escapeHtml(alert.technician)} · ${escapeHtml(alert.detail)}</p><div class="monitor-attention-meta"><span>${alerts.length} alerta${alerts.length === 1 ? '' : 's'} na operação</span></div></div><div class="monitor-attention-side"><span class="monitor-attention-count"><strong>${alerts.length}</strong></span><button class="monitor-attention-action" id="attentionRoutes" type="button">Abrir Console</button></div>`;
  root.querySelector('#attentionRoutes')?.addEventListener('click', () => {
    document.querySelector('[data-view="routes"]')?.click();
    document.querySelector('#monitorTabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderMonitor(store, alertService) {
  const state = store.get();
  const snap = selectedSnapshot(state);
  const model = buildModel(state);
  document.querySelector('#monitorTotal').textContent = model.kpis.total;
  document.querySelector('#monitorField').textContent = model.kpis.field;
  document.querySelector('#monitorCompleted').textContent = model.kpis.completed;
  document.querySelector('#monitorPending').textContent = model.kpis.pending;
  document.querySelector('#monitorRevisits').textContent = model.kpis.revisits;
  document.querySelector('#monitorClosedWithCode').textContent = model.kpis.closedWithCode;
  document.querySelector('#monitorRouteAlerts').textContent = model.kpis.routeAlerts;

  const freshness = document.querySelector('#monitorFreshness');
  const isFirebase = snap.source === 'firebase_realtime';
  const isDatalake = snap.source === 'toa_datalake' || isFirebase;
  freshness.classList.toggle('csv', Boolean(snap.orders.length) && !state.demo);
  freshness.textContent = state.demo ? 'Cenários de apresentação ativos; dados reais permanecem preservados.'
    : snap.orders.length ? `${isFirebase ? 'Firebase TOA em tempo real' : isDatalake ? 'Datalake TOA automático' : 'CSV do TOA ativo'}. ${snap.orders.length} OS · atualizado às ${localClock(new Date(snap.loadedAt || Date.now()))}.`
      : state.datalakeOnline ? 'Datalake conectado; aguardando atividades do coletor.' : 'Carregue um CSV do TOA para iniciar.';

  const source = document.querySelector('#monitorCsvSource');
  source.classList.toggle('hidden', !state.snapshot.orders.length || state.demo);
  if (state.snapshot.orders.length) {
    document.querySelector('#monitorCsvSourceTitle').textContent = state.snapshot.files.map((file) => file.filename).join(' + ');
    document.querySelector('#monitorCsvSourceDetail').textContent = `${state.snapshot.orders.length} OS · ${state.snapshot.timelineActivities.length} pausas/refeições · ${state.snapshot.files.reduce((sum, file) => sum + Number(file.sourceRows || 0), 0)} atividades do TOA · ${isDatalake ? 'sincronização incremental' : 'processamento local no navegador'}.`;
  }
  document.querySelector('#monitorDemoBanner').classList.toggle('hidden', !state.demo);
  document.querySelector('#monitorDemo').classList.toggle('active', state.demo);
  document.querySelector('#monitorDemo').setAttribute('aria-pressed', state.demo ? 'true' : 'false');
  document.querySelector('#monitorNotify').classList.toggle('active', alertService.notifications);
  document.querySelector('#monitorVoice').classList.toggle('active', alertService.voice);
  document.querySelector('#monitorVoice').setAttribute('aria-pressed', alertService.voice ? 'true' : 'false');

  const bucketSelect = document.querySelector('#monitorBucket');
  const currentBucket = state.bucket;
  bucketSelect.innerHTML = '<option value="all">Todos os buckets</option>' + model.buckets.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} (${item.count})</option>`).join('');
  if ([...bucketSelect.options].some((option) => option.value === currentBucket)) bucketSelect.value = currentBucket;
  else { bucketSelect.value = 'all'; store.set({ bucket: 'all' }); }

  const tabs = document.querySelector('#monitorTabs');
  tabs.innerHTML = model.definitions.map((definition) => {
    const count = definition.key === 'routes' ? model.views.routes?.console?.totalActivities || 0 : model.views[definition.key]?.rows?.length || 0;
    return `<button type="button" data-view="${definition.key}" class="${state.view === definition.key ? 'active' : ''}">${escapeHtml(definition.label)} <span>${count}</span></button>`;
  }).join('');
  tabs.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    store.set({ view: button.dataset.view });
    renderMonitor(store, alertService);
  }));

  const view = model.views[state.view] || model.views.monitor;
  document.querySelector('#monitorViewTitle').textContent = view.title;
  document.querySelector('#monitorViewSubtitle').textContent = view.subtitle || '';
  const routeRoot = document.querySelector('#monitorRouteConsole');
  const tableWrap = document.querySelector('#monitorTableWrap');
  if (state.view === 'routes') {
    routeRoot.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    renderRouteConsole(model.views.routes.console, state);
  } else {
    routeRoot.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    const rows = filterRows(view.rows || [], state);
    document.querySelector('#monitorTableHead').innerHTML = `<tr>${(view.columns || []).map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>`;
    document.querySelector('#monitorTableBody').innerHTML = rows.length ? rows.map((row) => `<tr>${view.columns.map((column) => `<td>${escapeHtml(row[column.key] ?? '-')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${Math.max(1, view.columns.length)}">${escapeHtml(view.note || 'Nenhum registro encontrado.')}</td></tr>`;
  }
  renderAttention(model);
  alertService.notify(model);
  window.lucide?.createIcons();
}

function renderDashboard(store) {
  const state = store.get();
  const model = buildModel(state);
  const rows = model.views.monitor.rows;
  document.querySelector('#dashboardUpdated').textContent = rows.length ? `Atualizado ${localClock(new Date())}` : 'Sem CSV carregado';
  document.querySelector('#dashboardOpenCount').textContent = model.kpis.total;
  document.querySelector('#dashboardFieldCount').textContent = model.kpis.field;
  document.querySelector('#dashboardCompletedCount').textContent = model.kpis.completed;
  document.querySelector('#dashboardFailureCount').textContent = model.kpis.routeAlerts;
  document.querySelector('#dashboardTotalLabel').textContent = `${model.kpis.total} OS`;
  const dist = [['Em campo', model.kpis.field, ''], ['Pendentes', model.kpis.pending, 'selected-bar'], ['Concluídas', model.kpis.completed, 'completed-bar'], ['Alertas', model.kpis.routeAlerts, 'failure-bar']];
  document.querySelector('#dashboardDistribution').innerHTML = dist.map(([label, value, cls]) => `<div><span>${label}</span><div class="distribution-track"><i class="${cls}" style="width:${model.kpis.total ? Math.min(100, (value / model.kpis.total) * 100) : 0}%"></i></div><strong>${value}</strong></div>`).join('');
  const cityCounts = new Map();
  rows.forEach((row) => cityCounts.set(row.city || 'NÃO INFORMADA', (cityCounts.get(row.city || 'NÃO INFORMADA') || 0) + 1));
  const maxCity = Math.max(1, ...cityCounts.values());
  document.querySelector('#dashboardCityBars').innerHTML = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city, count]) => `<div><span>${escapeHtml(city)}</span><div><i style="width:${(count / maxCity) * 100}%"></i></div><strong>${count}</strong></div>`).join('') || '<p class="muted-cell">Carregue um CSV do TOA.</p>';
  const alerts = model.views.routes.console.alerts || [];
  document.querySelector('#dashboardAttentionCount').textContent = `${alerts.length} alerta${alerts.length === 1 ? '' : 's'}`;
  document.querySelector('#dashboardAttentionList').innerHTML = alerts.slice(0, 5).map((alert) => `<article><i data-lucide="triangle-alert"></i><div><strong>${escapeHtml(alert.label)}</strong><small>OS ${escapeHtml(alert.os)} · ${escapeHtml(alert.technician)}</small></div></article>`).join('') || '<p class="muted-cell">Nenhum alerta de rota na leitura atual.</p>';
  document.querySelector('#dashboardRecentBody').innerHTML = rows.slice(0, 8).map((row) => `<tr><td>${escapeHtml(row.os)}</td><td>${escapeHtml(row.contract)}</td><td>${escapeHtml(row.service)}</td><td>${escapeHtml(row.city)}</td><td>${escapeHtml(row.technician)}</td><td>${escapeHtml(row.status)}</td></tr>`).join('');
  document.querySelector('#dashboardOpenOrders')?.addEventListener('click', () => switchModule(store, 'orders'));
  window.lucide?.createIcons();
}

function renderOrders(store) {
  const state = store.get();
  const model = buildModel(state);
  const search = normalize(document.querySelector('#ordersSearch')?.value || '');
  const status = document.querySelector('#ordersStatus')?.value || 'all';
  const rows = model.views.monitor.rows.filter((row) => (status === 'all' || row.status_kind === status) && (!search || normalize([row.os, row.contract, row.service, row.technician, row.city, row.bucket].join(' ')).includes(search)));
  const body = document.querySelector('#ordersBody');
  body.innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.os)}</td><td>${escapeHtml(row.contract)}</td><td>${escapeHtml(row.service)}</td><td>${escapeHtml(row.city)}</td><td>${escapeHtml(row.bucket)}</td><td>${escapeHtml(row.technician)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.schedule)}</td></tr>`).join('');
  document.querySelector('#ordersEmpty').classList.toggle('hidden', rows.length > 0);
}

function renderImports(store) {
  const snapshot = store.get().snapshot;
  document.querySelector('#importsCount').textContent = `${snapshot.files.length} arquivo${snapshot.files.length === 1 ? '' : 's'}`;
  document.querySelector('#importsList').innerHTML = snapshot.files.length ? snapshot.files.map((file) => `<article><i data-lucide="file-check-2"></i><div><strong>${escapeHtml(file.filename)}</strong><small>${file.sourceRows} linhas · bucket ${escapeHtml(file.bucket)}</small></div></article>`).join('') : '<p class="muted-cell">Nenhum CSV carregado.</p>';
  const errorsPanel = document.querySelector('#importsErrorsPanel');
  errorsPanel.classList.toggle('hidden', !snapshot.errors.length);
  document.querySelector('#importsErrors').innerHTML = snapshot.errors.map((error) => `<article class="error"><i data-lucide="triangle-alert"></i><div><strong>${escapeHtml(error.filename)}</strong><small>${escapeHtml(error.message)}</small></div></article>`).join('');
  window.lucide?.createIcons();
}

function renderTechnicians(store, directory) {
  const snapshot = selectedSnapshot(store.get());
  const counts = new Map();
  snapshot.orders.forEach((order) => {
    const login = normalize(order.technician_login || order.technician);
    if (!login) return;
    const item = counts.get(login) || { count: 0, bucket: new Set() };
    item.count += 1;
    if (order.bucket) item.bucket.add(order.bucket);
    counts.set(login, item);
  });
  document.querySelector('#techDirectoryCount').textContent = directory.payload.technicians?.length || 0;
  document.querySelector('#techActiveCount').textContent = counts.size;
  const unknown = [...counts.keys()].filter((login) => !directory.byLogin.has(login)).length;
  document.querySelector('#techUnknownCount').textContent = unknown;
  const term = normalize(document.querySelector('#techSearch')?.value || '');
  const rows = [...counts.entries()].map(([login, usage]) => {
    const item = directory.byLogin.get(login) || { login, name: login, teams: [] };
    return { ...item, bucket: [...usage.bucket].join(' / ') || '-', count: usage.count };
  }).filter((item) => !term || normalize([item.name, item.login, (item.teams || []).join(' '), item.bucket].join(' ')).includes(term)).sort((a, b) => a.name.localeCompare(b.name));
  document.querySelector('#techBody').innerHTML = rows.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.login)}</td><td>${escapeHtml((item.teams || []).join(' / ') || '-')}</td><td>${escapeHtml(item.bucket)}</td><td>${item.count}</td></tr>`).join('');
  document.querySelector('#techEmpty').classList.toggle('hidden', rows.length > 0);
}

function monitorTvCountdown(deadline, now = new Date()) {
  if (!deadline) return { text: '--:--:--', kind: 'unknown' };
  const target = new Date(deadline);
  if (Number.isNaN(target.getTime())) return { text: '--:--:--', kind: 'unknown' };
  const diff = target.getTime() - now.getTime();
  const sign = diff < 0 ? '-' : '';
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const seconds = Math.floor((abs % 60000) / 1000);
  return { text: `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`, kind: diff < 0 ? 'late' : diff <= 3600000 ? 'risk' : 'safe' };
}

const TV_TECHNICIANS_PER_PAGE = 4;
const TV_FOCUS_PER_PAGE = 2;

export function pageTvFocusRows(items, pageIndex, pageSize = TV_FOCUS_PER_PAGE) {
  const source = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || TV_FOCUS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(source.length / size));
  const normalizedPage = source.length
    ? ((Number(pageIndex) || 0) % pageCount + pageCount) % pageCount : 0;
  const offset = normalizedPage * size;
  return {
    items: source.slice(offset, offset + size),
    pageIndex: normalizedPage,
    pageCount,
    total: source.length,
    start: source.length ? offset + 1 : 0,
    end: Math.min(offset + size, source.length),
  };
}

export function pageTvTechnicians(items, pageIndex, pageSize = TV_TECHNICIANS_PER_PAGE) {
  const source = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || TV_TECHNICIANS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(source.length / size));
  const normalizedPage = source.length
    ? ((Number(pageIndex) || 0) % pageCount + pageCount) % pageCount : 0;
  const offset = normalizedPage * size;
  return {
    items: source.slice(offset, offset + size),
    pageIndex: normalizedPage,
    pageCount,
    total: source.length,
    start: source.length ? offset + 1 : 0,
    end: Math.min(offset + size, source.length),
  };
}

export function groupTvFocusFacts(facts) {
  const source = Array.from(facts || []);
  return {
    primary: [1, 2, 5, 6].map((index) => source[index]).filter(Boolean),
    secondary: [0, 3, 4, 7].map((index) => source[index]).filter(Boolean),
  };
}

function renderTvTechnicianCards(items) {
  return items.length ? items.map((item) => `<article><span class="avatar">${escapeHtml(item.technician.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join(''))}</span><div><strong>${escapeHtml(item.technician)}</strong><small>OS ${escapeHtml(item.os)} · ${escapeHtml(item.service)}</small><b>${escapeHtml(item.state_label)} · ${escapeHtml(item.bucket)}</b></div></article>`).join('') : '<div class="monitor-tv-empty">Nenhum técnico iniciado na leitura atual.</div>';
}

function renderTvFocusFacts(facts) {
  return facts.map(([label, value]) => `<span><small>${label}</small><strong>${escapeHtml(value || '-')}</strong></span>`).join('');
}

function renderTvFocusCard(focus, slot) {
  const countdown = monitorTvCountdown(focus.tec1_deadline);
  const primaryFacts = [
    ['Contrato', focus.contract],
    ['Técnico', focus.technician],
    ['Status', focus.status],
    ['Agenda', focus.schedule],
  ];
  const secondaryFacts = [
    ['OS', focus.os],
    ['Login TOA', focus.technician_login],
    ['Bucket', focus.bucket],
    ['Janela', `${focus.window_start || '-'} — ${focus.window_end || '-'}`],
  ];
  return `<section class="monitor-tv-focus-card ${countdown.kind}" data-tv-focus-slot="${slot}"><div class="monitor-tv-focus-card-head"><span>PRIORIDADE ${slot + 1}</span><span class="monitor-tv-status ${escapeHtml(focus.tec1_kind || 'unknown')}">${escapeHtml(focus.tec1 || focus.status || 'Sem agenda')}</span></div><strong class="monitor-tv-tec1-value ${countdown.kind}" data-tv-countdown>${escapeHtml(countdown.text)}</strong><h1>${escapeHtml(focus.service || 'Atividade')}</h1><div class="monitor-tv-focus-details"><div class="monitor-tv-focus-grid monitor-tv-focus-primary">${renderTvFocusFacts(primaryFacts)}</div><div class="monitor-tv-focus-grid monitor-tv-focus-secondary">${renderTvFocusFacts(secondaryFacts)}</div></div></section>`;
}

function renderTvFocusEmpty() {
  const focus = { contract: '-', technician: 'SEM INFORMAÇÃO', status: '-', schedule: '-', os: '-', technician_login: '-', bucket: '-', window_start: '-', window_end: '-', service: 'Nenhuma atividade carregada', tec1_kind: 'unknown', tec1: 'Sem agenda', tec1_deadline: '' };
  return renderTvFocusCard(focus, 0);
}

let tvSlideIndex = 0;
let tvTechnicianPageIndex = 0;

function renderTv(store, alertService) {
  const tvRoot = document.querySelector('#monitorTv');
  const state = store.get();
  const model = buildModel(state);
  const tv = window.DominiumMonitor.buildTvDashboard(model);
  const routeEstimate = tv.focusBasis === 'route_estimate';
  const focusTitle = routeEstimate ? 'PRIORIDADES DA ROTA' : 'TEC1 PRIORITÁRIOS';
  const focusSubtitle = routeEstimate
    ? 'Estimativa pelo fim da agenda · janela oficial pendente'
    : 'Duas OS por aviso · rotação automática';
  const focusBasisText = routeEstimate
    ? 'Estimativa operacional pelo fim da agenda do TOA; não representa TEC1 oficial.'
    : 'Contagem operacional pelo fim da janela oficial do TOA.';
  // Never revive a completed activity merely to fill the TV focus card.
  const rows = tv.tec1Rows;
  const focusPage = pageTvFocusRows(rows, tvSlideIndex);
  const focus = focusPage.items[0] || { os: '-', contract: '-', service: 'Nenhuma atividade carregada', technician: 'SEM INFORMAÇÃO', bucket: '-', status: '-', schedule: '-', window_start: '-', window_end: '-', tec1_deadline: '' };
  const countdown = monitorTvCountdown(focus.tec1_deadline);
  const routeAlert = tv.routeAlerts[0];
  const technicianPage = pageTvTechnicians(tv.activeTechnicians, tvTechnicianPageIndex);
  const tvSourceLabel = state.snapshot.live ? 'TOA AO VIVO · ALL_BUCKETS' : state.snapshot.source === 'toa_datalake' ? 'BASE LOCAL TOA' : 'RETRATO CSV DO TOA';
  tvRoot.innerHTML = `<header class="monitor-tv-header"><div class="monitor-tv-brand"><span class="monitor-tv-logo"><img class="brand-asset" src="/assets/brands/technet-symbol.png" alt=""></span><img class="monitor-tv-partner brand-asset" src="/assets/brands/claro-orb.png" alt="Claro"><div><strong>TECHNET · DOMINIUM TOA</strong><small>Centro de Controle Operacional</small></div></div><div class="monitor-tv-context"><span>TOA / TEC1</span><strong class="live"><i></i>RETRATO CSV DO TOA</strong><b class="api">TOA LOCAL</b></div><div class="monitor-tv-time"><strong id="tvClock">${new Date().toLocaleTimeString('pt-BR')}</strong><span>${new Date().toLocaleDateString('pt-BR')}</span></div><div class="monitor-tv-header-actions"><button type="button" id="tvVoice" class="${alertService.voice ? 'active' : ''}"><i data-lucide="${alertService.voice ? 'volume-2' : 'volume-x'}"></i><span>${alertService.voice ? 'Voz ativa' : 'Ativar voz'}</span></button><button type="button" id="tvFullscreen"><i data-lucide="maximize"></i></button><button type="button" id="tvExit"><i data-lucide="x"></i></button></div></header><section class="monitor-tv-kpis">${[['Total de OS', tv.kpis.total || 0, 'neutral'], ['Em campo', tv.kpis.field || 0, 'green'], ['Concluídas', tv.kpis.completed || 0, 'blue'], ['Pendentes', tv.kpis.pending || 0, 'yellow'], ['TEC1 em atenção', tv.kpis.tec1Risk || 0, 'red'], ['TEC1 estourado', tv.kpis.tec1Late || 0, 'red'], ['Alertas de rota', tv.kpis.routeAlerts || 0, 'orange']].map(([label, value, kind]) => `<article class="${kind}"><span>${label}</span><strong>${value}</strong></article>`).join('')}</section><main class="monitor-tv-main"><article class="monitor-tv-focus ${countdown.kind}"><div class="monitor-tv-focus-head"><div><span class="monitor-tv-focus-kicker"><i></i>TEC1 PRIORITÁRIO</span><small>Leitura atual</small></div><span class="monitor-tv-status ${escapeHtml(focus.tec1_kind || 'unknown')}">${escapeHtml(focus.tec1 || focus.status || 'Sem agenda')}</span></div><strong class="monitor-tv-tec1-value ${countdown.kind}" id="tvCountdown">${escapeHtml(countdown.text)}</strong><h1>${escapeHtml(focus.service || 'Atividade')}</h1><div class="monitor-tv-focus-grid">${[['OS', focus.os], ['Contrato', focus.contract], ['Técnico', focus.technician], ['Login TOA', focus.technician_login], ['Bucket', focus.bucket], ['Status', focus.status], ['Agenda', focus.schedule], ['Janela', `${focus.window_start || '-'} — ${focus.window_end || '-'}`]].map(([label, value]) => `<span><small>${label}</small><strong>${escapeHtml(value || '-')}</strong></span>`).join('')}</div><footer><span><i data-lucide="info"></i>Contagem operacional pelo fim da agenda do TOA.</span><b>Monitoramento em modo somente leitura.</b></footer></article><aside class="monitor-tv-now"><header><span>OPERAÇÃO AGORA</span><strong>${tv.activeTechnicians.length} técnico${tv.activeTechnicians.length === 1 ? '' : 's'} em execução/rota</strong></header><div class="monitor-tv-technicians">${tv.activeTechnicians.length ? tv.activeTechnicians.slice(0, 4).map((item) => `<article><span class="avatar">${escapeHtml(item.technician.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join(''))}</span><div><strong>${escapeHtml(item.technician)}</strong><small>OS ${escapeHtml(item.os)} · ${escapeHtml(item.service)}</small><b>${escapeHtml(item.state_label)} · ${escapeHtml(item.bucket)}</b></div></article>`).join('') : '<div class="monitor-tv-empty">Nenhum técnico iniciado na leitura atual.</div>'}</div></aside></main><footer class="monitor-tv-footer"><span class="monitor-tv-live"><i></i>Atualização visual automática</span><div class="monitor-tv-ticker"><span>${routeAlert ? `ALERTA: OS ${escapeHtml(routeAlert.os)} · ${escapeHtml(routeAlert.technician)} · ${escapeHtml(routeAlert.detail)}` : 'Nenhuma janela crítica identificada na leitura atual'}</span></div><strong>Atualizado ${localClock(new Date())}</strong></footer>`;
  const sourceBadge = tvRoot.querySelector('.monitor-tv-context .live');
  if (sourceBadge) sourceBadge.innerHTML = `<i></i>${escapeHtml(tvSourceLabel)}`;
  const focusBoard = tvRoot.querySelector('.monitor-tv-focus');
  if (focusBoard) {
    const focusPageLabel = focusPage.total
      ? `Exibindo ${focusPage.start}–${focusPage.end} de ${focusPage.total}`
      : 'Nenhuma prioridade na leitura atual';
    focusBoard.className = `monitor-tv-focus monitor-tv-focus-board${focusPage.items.length <= 1 ? ' single' : ''}`;
    focusBoard.innerHTML = `<div class="monitor-tv-focus-board-head"><div><span class="monitor-tv-focus-kicker"><i></i>${focusTitle}</span><small>${focusSubtitle}</small></div><strong>${focusPageLabel}</strong></div><div class="monitor-tv-focus-cards">${focusPage.items.length ? focusPage.items.map(renderTvFocusCard).join('') : renderTvFocusEmpty()}</div><footer><span><i data-lucide="info"></i>${focusBasisText}</span><b>Monitoramento em modo somente leitura.</b></footer>`;
  }
  const technicianList = tvRoot.querySelector('.monitor-tv-technicians');
  if (technicianList) technicianList.innerHTML = renderTvTechnicianCards(technicianPage.items);
  const technicianSummary = tvRoot.querySelector('.monitor-tv-now > header strong');
  if (technicianSummary) {
    const pageLabel = technicianPage.pageCount > 1
      ? ` · exibindo ${technicianPage.start}–${technicianPage.end}` : '';
    technicianSummary.textContent = `${technicianPage.total} técnico${technicianPage.total === 1 ? '' : 's'} em execução/rota${pageLabel}`;
  }
  alertService.syncTvFocus(focusPage.items);
  const fullscreenButton = tvRoot.querySelector('#tvFullscreen');
  const themeButton = document.createElement('button');
  const lightTheme = document.documentElement.dataset.theme === 'light';
  themeButton.type = 'button';
  themeButton.id = 'tvTheme';
  themeButton.title = lightTheme ? 'Ativar modo escuro' : 'Ativar modo claro';
  themeButton.setAttribute('aria-label', themeButton.title);
  themeButton.innerHTML = `<i data-lucide="${lightTheme ? 'moon' : 'sun'}"></i>`;
  fullscreenButton?.parentElement?.insertBefore(themeButton, fullscreenButton);
  themeButton.addEventListener('click', () => { toggleTheme(); renderTv(store, alertService); });
  tvRoot.querySelector('#tvExit')?.addEventListener('click', () => exitTv());
  tvRoot.querySelector('#tvFullscreen')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else tvRoot.requestFullscreen?.().catch(() => {});
  });
  tvRoot.querySelector('#tvVoice')?.addEventListener('click', () => { alertService.toggleVoice(); renderTv(store, alertService); });
  window.lucide?.createIcons();
}

function updateTvLive(store, alertService) {
  const model = buildModel(store.get());
  const tv = window.DominiumMonitor.buildTvDashboard(model);
  const focusPage = pageTvFocusRows(tv.tec1Rows, tvSlideIndex);
  alertService.syncTvFocus(focusPage.items);
  const now = new Date();
  const clockRoot = document.querySelector('#tvClock');
  const updatedRoot = document.querySelector('.monitor-tv-footer > strong');
  document.querySelectorAll('[data-tv-focus-slot]').forEach((card) => {
    const slot = Number(card.dataset.tvFocusSlot || 0);
    const countdown = monitorTvCountdown(focusPage.items[slot]?.tec1_deadline, now);
    const countdownRoot = card.querySelector('[data-tv-countdown]');
    card.className = `monitor-tv-focus-card ${countdown.kind}`;
    if (countdownRoot) {
      countdownRoot.textContent = countdown.text;
      countdownRoot.className = `monitor-tv-tec1-value ${countdown.kind}`;
    }
  });
  if (clockRoot) clockRoot.textContent = now.toLocaleTimeString('pt-BR');
  if (updatedRoot) updatedRoot.textContent = `Atualizado ${localClock(now)}`;
}

let tvTimer = null;
let tvSlideTimer = null;
function enterTv(store, alertService) {
  const root = document.querySelector('#monitorTv');
  tvSlideIndex = 0;
  tvTechnicianPageIndex = 0;
  document.body.classList.add('monitor-tv-open');
  alertService.setTvMode(true);
  root.classList.remove('hidden');
  renderTv(store, alertService);
  root.requestFullscreen?.().catch(() => {});
  clearInterval(tvTimer);
  clearInterval(tvSlideTimer);
  tvTimer = setInterval(() => updateTvLive(store, alertService), 1000);
  tvSlideTimer = setInterval(() => {
    const model = buildModel(store.get());
    const tv = window.DominiumMonitor.buildTvDashboard(model);
    const focusPages = Math.max(1, Math.ceil(tv.tec1Rows.length / TV_FOCUS_PER_PAGE));
    tvSlideIndex = tv.tec1Rows.length ? (tvSlideIndex + 1) % focusPages : 0;
    const technicianPages = Math.max(
      1,
      Math.ceil(tv.activeTechnicians.length / TV_TECHNICIANS_PER_PAGE),
    );
    tvTechnicianPageIndex = tv.activeTechnicians.length
      ? (tvTechnicianPageIndex + 1) % technicianPages : 0;
    renderTv(store, alertService);
  }, 12000);
}
function exitTv() {
  clearInterval(tvTimer); tvTimer = null;
  clearInterval(tvSlideTimer); tvSlideTimer = null;
  tvSlideIndex = 0;
  tvTechnicianPageIndex = 0;
  document.body.classList.remove('monitor-tv-open');
  globalAlertService?.setTvMode(false);
  const root = document.querySelector('#monitorTv');
  root.className = 'monitor-tv hidden'; root.innerHTML = '';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function exportCurrent(store) {
  const model = buildModel(store.get());
  const rows = model.views.monitor.rows;
  if (!rows.length) return toast('Não há dados para exportar.', 'error');
  const headers = ['OS', 'Contrato', 'Serviço', 'Cidade', 'Bucket', 'Técnico', 'Status', 'Agenda', 'TEC1'];
  const body = rows.map((row) => [row.os, row.contract, row.service, row.city, row.bucket, row.technician, row.status, row.schedule, row.tec1]);
  const csv = [headers, ...body].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `monitor-toa-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
}

async function handleFiles(store, files, directory, alertService) {
  if (!files.length) return;
  try {
    toast(`Lendo ${files.length} CSV${files.length === 1 ? '' : 's'} do TOA...`);
    let snapshot = await loadToaFiles(files);
    snapshot = applyTechnicianNames({ ...snapshot, source: 'csv' }, directory);
    store.set({ snapshot, demo: false, demoOrders: null, view: 'routes', search: '', bucket: 'all', status: 'all' });
    const available = PROFILE_DEFS.find((profile) => snapshot.orders.some((order) => orderProfile(order) === profile.key));
    store.set({ city: available?.key || 'all' });
    renderProfileTabs(store);
    renderActiveModule(store, directory, alertService);
    toast(`${snapshot.files.length} arquivo(s) · ${snapshot.orders.length} OS carregadas.`, 'success');
    if (snapshot.errors.length) toast(`${snapshot.errors.length} arquivo(s) foram ignorados por erro.`, 'error');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function refreshDatalake(store, directory, alertService, { quiet = true } = {}) {
  try {
    let snapshot = await loadDatalakeFeed();
    snapshot = applyTechnicianNames(snapshot, directory);
    const hasData = snapshot.orders.length || snapshot.timelineActivities.length;
    store.set({ datalakeOnline: true });
    if (!hasData && store.get().snapshot.orders.length) return false;
    store.set({ snapshot, demo: false, demoOrders: null });
    renderProfileTabs(store);
    if (store.get().module === 'monitor') renderMonitor(store, alertService);
    if (document.body.classList.contains('monitor-tv-open')) renderTv(store, alertService);
    if (!quiet) toast(`Datalake atualizado: ${snapshot.orders.length} OS.`, 'success');
    return true;
  } catch (error) {
    store.set({ datalakeOnline: false });
    if (!quiet) toast(error.message, 'error');
    return false;
  }
}

function acceptRealtimeSnapshot(store, directory, alertService, incoming) {
  const snapshot = applyTechnicianNames(incoming, directory);
  const hasData = snapshot.orders.length || snapshot.timelineActivities.length;
  store.set({ datalakeOnline: true });
  if (!hasData && store.get().snapshot.orders.length) return;
  store.set({ snapshot, demo: false, demoOrders: null });
  renderProfileTabs(store);
  if (store.get().module === 'monitor') renderMonitor(store, alertService);
  if (document.body.classList.contains('monitor-tv-open')) renderTv(store, alertService);
}

function bindMonitor(store, directory, alertService) {
  const input = document.querySelector('#monitorCsvInput');
  const open = () => input.click();
  document.querySelector('#monitorCsvOpen')?.addEventListener('click', open);
  document.querySelector('#monitorCsvReplace')?.addEventListener('click', open);
  input?.addEventListener('change', async () => { await handleFiles(store, [...input.files], directory, alertService); input.value = ''; });
  document.querySelector('#monitorCsvClear')?.addEventListener('click', () => {
    store.set({ snapshot: { files: [], orders: [], timelineActivities: [], errors: [], loadedAt: null }, city: 'all', demo: false, view: 'routes', search: '', bucket: 'all', status: 'all' });
    renderProfileTabs(store); renderMonitor(store, alertService); toast('CSV removido do monitor.');
  });
  document.querySelector('#monitorDemo')?.addEventListener('click', () => {
    const next = !store.get().demo;
    store.set({ demo: next, demoOrders: next ? window.DominiumMonitor.buildMeetingExamples(new Date()) : null, view: 'routes', search: '', bucket: 'all', status: 'all' });
    renderMonitor(store, alertService);
  });
  document.querySelector('#monitorNotify')?.addEventListener('click', async () => {
    const enabled = await alertService.toggleNotifications();
    toast(enabled ? 'Notificações TEC1 ativadas.' : 'Notificações TEC1 desativadas.'); renderMonitor(store, alertService);
  });
  document.querySelector('#monitorVoice')?.addEventListener('click', () => {
    const enabled = alertService.toggleVoice(); toast(enabled ? 'Voz TEC1 ativada.' : 'Voz TEC1 desativada.'); renderMonitor(store, alertService);
  });
  document.querySelector('#monitorExport')?.addEventListener('click', () => exportCurrent(store));
  document.querySelector('#monitorRefresh')?.addEventListener('click', () => refreshDatalake(store, directory, alertService, { quiet: false }));
  document.querySelector('#monitorTvOpen')?.addEventListener('click', () => enterTv(store, alertService));
  document.querySelector('#monitorSearch')?.addEventListener('input', (event) => { store.set({ search: event.target.value }); renderMonitor(store, alertService); });
  document.querySelector('#monitorBucket')?.addEventListener('change', (event) => { store.set({ bucket: event.target.value }); renderMonitor(store, alertService); });
  document.querySelector('#monitorStatus')?.addEventListener('change', (event) => { store.set({ status: event.target.value }); renderMonitor(store, alertService); });
}

function switchModule(store, module) {
  store.set({ module });
  document.querySelectorAll('[data-module]').forEach((button) => button.classList.toggle('active', button.dataset.module === module));
  renderActiveModule(store);
}

let globalDirectory = null;
let globalAlertService = null;
function renderActiveModule(store, directory = globalDirectory, alertService = globalAlertService) {
  const state = store.get();
  const root = document.querySelector('#workspaceRoot');
  if (state.module === 'dashboard') { root.innerHTML = DashboardWorkspace(); renderDashboard(store); }
  else if (state.module === 'orders') {
    root.innerHTML = OrdersWorkspace();
    renderOrders(store);
    document.querySelector('#ordersSearch')?.addEventListener('input', () => renderOrders(store));
    document.querySelector('#ordersStatus')?.addEventListener('change', () => renderOrders(store));
  } else if (state.module === 'imports') {
    root.innerHTML = ImportWorkspace(); renderImports(store);
    document.querySelector('#importsOpen')?.addEventListener('click', () => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv'; input.multiple = true;
      input.addEventListener('change', () => handleFiles(store, [...input.files], directory, alertService)); input.click();
    });
  } else if (state.module === 'technicians') {
    root.innerHTML = TechniciansWorkspace(); renderTechnicians(store, directory);
    document.querySelector('#techSearch')?.addEventListener('input', () => renderTechnicians(store, directory));
  } else {
    root.innerHTML = MonitorWorkspace(); bindMonitor(store, directory, alertService); renderMonitor(store, alertService);
  }
  window.lucide?.createIcons();
}

function applyTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const nextLabel = current === 'dark' ? 'Modo claro' : 'Modo escuro';
  document.querySelector('#themeLabel').textContent = nextLabel;
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('dominium-toa-theme', next); } catch (_) { /* noop */ }
  applyTheme();
}

export async function createApp(root) {
  root.innerHTML = Shell();
  const store = createStore();
  const directory = await loadTechnicianDirectory();
  const alertService = new AlertService();
  globalDirectory = directory;
  globalAlertService = alertService;

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('monitor-tv-open') && !document.fullscreenElement) exitTv();
  });

  try { document.documentElement.dataset.theme = localStorage.getItem('dominium-toa-theme') || 'dark'; } catch (_) { document.documentElement.dataset.theme = 'dark'; }
  applyTheme();
  document.querySelector('#themeToggle')?.addEventListener('click', toggleTheme);
  document.querySelector('#sidebarToggle')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    document.querySelector('#sidebarToggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  document.querySelector('#headerToaOpen')?.addEventListener('click', () => {
    window.open('https://clarobrasil.etadirect.com/toa/', '_blank', 'noopener,noreferrer');
  });
  document.querySelectorAll('[data-module]').forEach((button) => button.addEventListener('click', () => switchModule(store, button.dataset.module)));

  renderProfileTabs(store);
  renderActiveModule(store, directory, alertService);
  await refreshDatalake(store, directory, alertService);
  window.lucide?.createIcons();
  if (datalakeUsesRealtime()) {
    await subscribeDatalakeFeed(
      (snapshot) => acceptRealtimeSnapshot(store, directory, alertService, snapshot),
      (error) => {
        console.error('Firebase Realtime Database indisponível', error);
        store.set({ datalakeOnline: false });
      },
    );
  } else {
    setInterval(() => refreshDatalake(store, directory, alertService), 5000);
  }
  setInterval(() => {
    if (store.get().module === 'monitor' && (store.get().snapshot.orders.length || store.get().demo)) renderMonitor(store, alertService);
  }, 20000);
  return { store, directory, alertService };
}
