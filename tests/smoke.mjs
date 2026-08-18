import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadToaFiles } from '../src/services/csvService.js';
import { groupTvFocusFacts, orderProfile, pageTvFocusRows, pageTvTechnicians } from '../src/app.js';
import { applyTechnicianNames } from '../src/services/technicianService.js';
import { normalizeOracleDetail } from '../scripts/toa-detail-reader.mjs';

await import(pathToFileURL(resolve('src/core/operations-monitor.js')));
assert.ok(globalThis.DominiumMonitor, 'Motor do monitor não carregou');

const fixture = resolve('tests/fixtures/Atividades-NTL-DMV_12_08_26.csv');
const bytes = await readFile(fixture);
const file = new File([bytes], 'Atividades-NTL-DMV_12_08_26.csv', { type: 'text/csv' });
const snapshot = await loadToaFiles([file]);
assert.equal(snapshot.orders.length, 2);
assert.equal(snapshot.timelineActivities.length, 1);
const model = globalThis.DominiumMonitor.buildMonitorModel(snapshot.orders, {
  timelineActivities: snapshot.timelineActivities,
  now: new Date('2026-08-12T08:30:00-03:00'),
});
assert.equal(model.kpis.total, 2);
assert.ok(model.views.routes.console.technicians.length >= 1, 'Console de rotas sem técnicos');
assert.ok(model.views.routes.console.totalActivities >= 2, 'Timeline incompleta');
assert.equal(orderProfile({ bucket: 'JCR-DMV_ADM', city: 'RECIFE' }), 'recife');
assert.equal(orderProfile({ bucket: 'JCR-DMV_ADM', city: '' }), 'recife');
assert.equal(orderProfile({ bucket: 'FTZ-DMV_ADM', city: 'FORTALEZA' }), 'fortaleza');

const completedModel = globalThis.DominiumMonitor.buildMonitorModel([{
  date: '12/08/26',
  num_os: '2647752427',
  contract: '3611800',
  service: '87 - RETIRAR EMTA',
  activity_status: 'concluÃ­do',
  toa_status: 'Executada',
  technician_login: 'Z512085',
  technician: 'Z512085',
  bucket: 'PWM-DMV_ADM',
  service_window: '07:45 - 08:45',
  started_at: '08:11',
  ended_at: '08:20',
}], { now: new Date('2026-08-12T15:28:30-03:00') });
const completedRow = completedModel.views.monitor.rows[0];
assert.equal(completedRow.status_kind, 'completed');
assert.equal(completedRow.tec1_kind, 'done');
assert.equal(completedRow.tec1_minutes, null);
assert.equal(globalThis.DominiumMonitor.buildTvDashboard(completedModel).tec1Rows.length, 0);

const englishStatusModel = globalThis.DominiumMonitor.buildMonitorModel([{
  scheduled_date: '2026-08-12', activity_id: '1968788015',
  activity_status: 'complete', status: 'complete', technician: 'TECNICO TESTE',
  route_start: '08:26', route_end: '09:02',
}], { now: new Date('2026-08-12T13:31:00-03:00') });
assert.equal(englishStatusModel.kpis.completed, 1);
assert.equal(englishStatusModel.kpis.pending, 0);
assert.equal(englishStatusModel.views.monitor.rows[0].tec1_kind, 'done');

const routeOnlyModel = globalThis.DominiumMonitor.buildMonitorModel([{
  scheduled_date: '2026-08-12', activity_id: '1968788016',
  activity_status: 'pending', status: 'pending', technician: 'TECNICO TESTE',
  route_start: '08:26', route_end: '09:02',
}], { now: new Date('2026-08-12T13:31:00-03:00') });
assert.equal(routeOnlyModel.views.monitor.rows[0].tec1_kind, 'unknown');
assert.equal(routeOnlyModel.views.monitor.rows[0].tec1_deadline, '');
assert.equal(globalThis.DominiumMonitor.buildTvDashboard(routeOnlyModel).tec1Rows.length, 0);

const startedRouteModel = globalThis.DominiumMonitor.buildMonitorModel([{
  scheduled_date: '2026-08-12', activity_id: '1968788017',
  activity_status: 'started', status: 'started', technician: 'TECNICO EM CAMPO',
  route_start: '14:00', route_end: '15:00', bucket: 'NTL-DMV',
}], { now: new Date('2026-08-12T14:30:00-03:00') });
const startedRouteTv = globalThis.DominiumMonitor.buildTvDashboard(startedRouteModel);
assert.equal(startedRouteTv.focusBasis, 'route_estimate');
assert.equal(startedRouteTv.tec1Rows.length, 1);
assert.equal(startedRouteTv.tec1Rows[0].status, 'INICIADA');
assert.equal(startedRouteTv.tec1Rows[0].deadline_basis, 'route_estimate');
assert.equal(startedRouteTv.kpis.tec1Risk, 0, 'Estimativa de rota nao pode inflar TEC1 oficial');

const pendingDetailModel = globalThis.DominiumMonitor.buildMonitorModel([{
  scheduled_date: '2026-08-13', activity_id: '196904738', contract: '4244444',
  activity_status: 'started', status: 'started', technician: 'JEYFFERSON GUEDES PAULINO',
  service_window: '13:15 - 14:45', route_start: '14:00', route_end: '16:20',
  detail_state: 'pending', bucket: 'NTL-DMV',
}], { now: new Date('2026-08-13T17:23:00-03:00') });
const pendingDetailRow = pendingDetailModel.views.monitor.rows[0];
assert.equal(pendingDetailRow.tec1_kind, 'unknown', 'Janela nao validada nao pode gerar TEC1 falso');
assert.equal(pendingDetailModel.kpis.field, 0, 'Status resumido nao validado nao pode entrar como em campo');
assert.equal(pendingDetailRow.status_kind, 'pending');
assert.equal(pendingDetailRow.status, 'VALIDANDO TOA');
assert.equal(pendingDetailRow.deadline_basis, 'validating_toa');
assert.equal(pendingDetailModel.views.routes.console.alerts.length, 0, 'Janela pendente nao pode gerar alerta de rota');
assert.equal(globalThis.DominiumMonitor.buildTvDashboard(pendingDetailModel).tec1Rows.length, 0,
  'Agenda de rota nao pode virar prioridade enquanto a janela oficial e validada');

const confirmedWindowModel = globalThis.DominiumMonitor.buildMonitorModel([{
  scheduled_date: '2026-08-13', activity_id: '196904738', contract: '4244444',
  activity_status: 'started', status: 'started', technician: 'JEYFFERSON GUEDES PAULINO',
  service_window: '12:00 - 18:00', route_start: '14:00', route_end: '16:20',
  detail_state: 'complete', bucket: 'NTL-DMV',
}], { now: new Date('2026-08-13T17:23:00-03:00') });
const confirmedWindowRow = confirmedWindowModel.views.monitor.rows[0];
assert.equal(confirmedWindowRow.tec1_kind, 'risk');
assert.equal(confirmedWindowRow.tec1_minutes, 37);
assert.equal(confirmedWindowRow.deadline_basis, 'official_window');

const unscheduledModel = globalThis.DominiumMonitor.buildMonitorModel([{
  scheduled_date: '2026-08-14', activity_id: '187458590', contract: '1077489',
  activity_status: 'pending', status: 'pending', technician: 'SMALEY STALLONE BEZERRA PEREIRA',
  service_window: '08:00 - 10:00', started_at: '3000-01-01 00:00:00',
  ended_at: '3000-01-01 00:52:00', detail_state: 'complete', bucket: 'MRO-DMV',
}], { now: new Date('2026-08-14T10:31:00-03:00') });
const unscheduledRow = unscheduledModel.views.monitor.rows[0];
assert.equal(unscheduledRow.tec1_kind, 'unknown', 'Atividade nao agendada nao pode gerar TEC1');
assert.equal(unscheduledRow.tec1_deadline, '');
assert.equal(unscheduledRow.deadline_basis, 'unscheduled');
assert.equal(unscheduledRow.schedule, 'Nao agendada');
assert.equal(unscheduledModel.views.routes.console.alerts.length, 0,
  'Atividade nao agendada nao pode gerar alerta de janela');
assert.equal(globalThis.DominiumMonitor.buildTvDashboard(unscheduledModel).tec1Rows.length, 0,
  'Atividade nao agendada nao pode aparecer entre prioridades TEC1');

const suspendedModel = globalThis.DominiumMonitor.buildMonitorModel([{
  date: '12/08/26',
  num_os: '2650918313',
  contract: '2515823',
  service: '191 - INSTALACAO DE CABO GPON',
  activity_status: 'suspenso',
  toa_status: 'suspenso',
  technician_login: 'Z676289',
  technician: 'Z676289',
  bucket: 'NTL-DMV',
  service_window: '12:00 - 15:00',
  started_at: '10:43',
  ended_at: '10:56',
}], { now: new Date('2026-08-12T15:32:43-03:00') });
const suspendedRow = suspendedModel.views.monitor.rows[0];
assert.equal(suspendedRow.status_kind, 'suspended');
assert.equal(suspendedRow.tec1_kind, 'done');
assert.equal(suspendedRow.tec1_minutes, null);
assert.equal(globalThis.DominiumMonitor.buildTvDashboard(suspendedModel).tec1Rows.length, 0);

const openWindowModel = globalThis.DominiumMonitor.buildMonitorModel([{
  date: '12/08/26',
  num_os: '2650846357',
  contract: '4246412',
  service: '69 - RETORNO DE CREDENCIADA',
  activity_status: 'iniciado',
  toa_status: 'iniciado',
  technician_login: 'Z671707',
  technician: 'Z671707',
  bucket: 'NTL-DMV',
  time_window: '14:00 - 17:00',
  service_window: '14 - 17',
  started_at: '14:06',
  ended_at: '15:05',
}], { now: new Date('2026-08-12T15:37:45-03:00') });
const openWindowRow = openWindowModel.views.monitor.rows[0];
assert.equal(openWindowRow.status_kind, 'field');
assert.equal(openWindowRow.tec1_kind, 'safe');
assert.equal(openWindowRow.tec1_minutes, 82);
assert.equal(
  new Date(openWindowRow.tec1_deadline).getTime(),
  new Date('2026-08-12T17:00:00-03:00').getTime(),
);

const manyTechniciansModel = globalThis.DominiumMonitor.buildMonitorModel(
  Array.from({ length: 7 }, (_, index) => ({
    date: '12/08/26',
    num_os: `90000000${index}`,
    contract: `800000${index}`,
    service: 'ATIVIDADE EM CAMPO',
    activity_status: 'iniciado',
    toa_status: 'iniciado',
    technician_login: `ZTEST${index}`,
    technician: `TECNICO ${index}`,
    bucket: 'NTL-DMV',
    time_window: '14:00 - 17:00',
    started_at: `15:0${index}`,
    ended_at: `16:0${index}`,
  })),
  { now: new Date('2026-08-12T15:37:45-03:00') },
);
assert.equal(
  globalThis.DominiumMonitor.buildTvDashboard(manyTechniciansModel).activeTechnicians.length,
  7,
);
const technicianPages = [
  pageTvTechnicians(Array.from({ length: 7 }, (_, index) => index), 0),
  pageTvTechnicians(Array.from({ length: 7 }, (_, index) => index), 1),
];
assert.deepEqual(technicianPages.map((page) => page.items), [[0, 1, 2, 3], [4, 5, 6]]);
assert.deepEqual(technicianPages.map((page) => [page.start, page.end]), [[1, 4], [5, 7]]);
assert.deepEqual(pageTvTechnicians([0, 1, 2, 3, 4, 5, 6], 2).items, [0, 1, 2, 3]);
const focusPages = [
  pageTvFocusRows([0, 1, 2, 3, 4], 0),
  pageTvFocusRows([0, 1, 2, 3, 4], 1),
  pageTvFocusRows([0, 1, 2, 3, 4], 2),
];
assert.deepEqual(focusPages.map((page) => page.items), [[0, 1], [2, 3], [4]]);
assert.deepEqual(focusPages.map((page) => [page.start, page.end]), [[1, 2], [3, 4], [5, 5]]);
assert.deepEqual(pageTvFocusRows([0, 1, 2, 3, 4], 3).items, [0, 1]);
const groupedFacts = groupTvFocusFacts([
  'OS', 'Contrato', 'Técnico', 'Login TOA', 'Bucket', 'Status', 'Agenda', 'Janela',
]);
assert.deepEqual(groupedFacts.primary, ['Contrato', 'Técnico', 'Status', 'Agenda']);

const detail = normalizeOracleDetail({ delta: {
  Activity: { 196873590: {
    aid: 196873590, customer_number: '4255519', astatus: 'started',
    service_window_start: '12:45', service_window_end: '13:45',
    193: '2650990001', 194: 'Em execucao', 195: '', 236: 'OBS DO TECNICO',
  } },
  Inventory: {
    10: { invid: 10, inv_aid: 196873590, invpool: 'install', invsn: 'ABC123', invtype: 'DECODER' },
    11: { invid: 11, inv_aid: 196873590, 192: '22056332', quantity: 1,
      _identifier_structure: { 192: { text: '22056332 FITA ISOLANTE' } } },
  },
} }, '196873590');
assert.equal(detail.contract, '4255519');
assert.equal(detail.service_window, '12:45 - 13:45');
assert.equal(detail.orders[0].os_number, '2650990001');
assert.equal(detail.installed_equipment[0].serial, 'ABC123');
assert.equal(detail.materials[0].code, '22056332');
assert.deepEqual(groupedFacts.secondary, ['OS', 'Login TOA', 'Bucket', 'Janela']);

const toaCss = await readFile(resolve('src/styles/toa-only.css'), 'utf8');
assert.match(toaCss, /html\[data-theme="light"\] \.monitor-tv[\s\S]*?color-scheme:\s*light/);
assert.match(toaCss, /html\[data-theme="light"\] \.monitor-tv-now/);
assert.match(toaCss, /html\[data-theme="light"\] \.monitor-tv-technicians article/);
assert.match(toaCss, /\.monitor-tv-focus\s*\{\s*--tv-focus:\s*227,\s*38,\s*54/);
assert.match(toaCss, /\.monitor-tv-focus-primary\s*\{[\s\S]*?linear-gradient[\s\S]*?#e32636/);

const technicianPayload = JSON.parse(await readFile(resolve('public/data/technicians.json'), 'utf8'));
const directory = {
  byLogin: new Map(technicianPayload.technicians.map((item) => [item.login, item])),
};
const named = applyTechnicianNames({
  orders: [{ technician_login: 'Z512085', technician: 'Z512085', customer_name: 'NATAN DIAS DA SILVA' }],
  timelineActivities: [],
}, directory);
assert.equal(named.orders[0].technician, 'ALLAN JAYVERSON DA COSTA');
assert.equal(named.orders[0].customer_name, 'NATAN DIAS DA SILVA');
const antonimar = applyTechnicianNames({
  orders: [{ technician_login: 'Z676289', technician: 'Z676289', customer_name: 'ANTONIMAR CARLOS DE ALMEIDA' }],
  timelineActivities: [],
}, directory);
assert.equal(antonimar.orders[0].technician, 'BRUNO GABRIEL OLIVEIRA PEREIRA');
assert.equal(antonimar.orders[0].customer_name, 'ANTONIMAR CARLOS DE ALMEIDA');
const livia = applyTechnicianNames({
  orders: [{ technician_login: 'Z671707', technician: 'Z671707', customer_name: 'LÍVIA GABRIELLA DE LIMA CORREIA' }],
  timelineActivities: [],
}, directory);
assert.equal(livia.orders[0].technician, 'IRENILSON ROCHA');
assert.equal(livia.orders[0].customer_name, 'LÍVIA GABRIELLA DE LIMA CORREIA');
console.log('Smoke test TOA OK', { orders: snapshot.orders.length, meals: snapshot.timelineActivities.length, alerts: model.kpis.routeAlerts });
