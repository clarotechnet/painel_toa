'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content-main.js'), 'utf8');
const options = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const locationHook = fs.readFileSync(path.join(root, 'location-network-hook.js'), 'utf8');

assert.equal(manifest.name, 'TOA TechNet Bridge');
assert.equal(manifest.version, '2.6.11');
assert.match(background, /MONITOR_API_PORT = 8765/);
assert.match(locationHook, /toa_map_pid_mismatch_/);
assert.match(content, /respostasDescartadasPorPidDivergente/);
assert.match(content, /activity_id: firstText/);
assert.match(background, /DEFAULT_CLOUD_BASE_URL = 'https:\/\/dominium-toa-bridge\.dominium-toa-cloud-bridge\.workers\.dev'/);
assert.match(background, /String\(stored\.dominiumCollectorToken \|\| ''\)/);
assert.match(options, /DEFAULT_COLLECTOR_ID = 'central-toa'/);
assert.match(content, /const ROUTE_TREE_ONLY_MODE = true;/);
assert.ok(manifest.content_scripts.some((entry) => entry.run_at === 'document_start'
  && entry.world === 'MAIN' && entry.js.includes('location-network-hook.js')));
assert.match(locationHook, /TN_TOA_LOCATION_NETWORK_PAYLOAD/);
assert.match(content, /coordinateY/);
assert.match(content, /respostasDeMapaAnalisadas/);
assert.match(content, /queueLocationVisit/);
assert.match(content, /marker_label/);
assert.match(content, /dominium\.toa\.technician-location-batch\.v2/);
assert.match(content, /gps_real: gpsReal/);
assert.match(content, /planned_route: plannedRoute/);
assert.match(content, /service_stops: serviceStops/);
assert.match(content, /function customerNumberRows/);
assert.match(content, /ultimoDiagnosticoSeguro/);
assert.match(content, /__TN_TOA_LOCATION_SYNC_ALL__/);
assert.match(content, /__TN_TOA_LOCATION_SYNC_MAP_ALL__/);
assert.match(content, /syncMapPositionHistory/);
assert.match(content, /const SILENT_UI_MODE = true/);
assert.match(content, /document\.getElementById\('tn-panel'\)\?\.remove\(\)/);

const snapshotStart = content.indexOf('function buildOperationalSnapshot');
const snapshotEnd = content.indexOf('function buildDisconnectSnapshot', snapshotStart);
assert.ok(snapshotStart > 0 && snapshotEnd > snapshotStart);
const snapshotSource = content.slice(snapshotStart, snapshotEnd);
for (const forbidden of ['cpfCliente', 'cnpjCliente', 'endereco:', 'telefone', 'cookie', 'csrf']) {
  assert.equal(snapshotSource.toLowerCase().includes(forbidden.toLowerCase()), false, `campo proibido no retrato remoto: ${forbidden}`);
}

console.log('cloud-bridge: configuração, modo silencioso e privacidade validados');
