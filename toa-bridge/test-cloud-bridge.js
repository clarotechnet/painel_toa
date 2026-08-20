'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content-main.js'), 'utf8');
const options = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

assert.equal(manifest.name, 'TOA TechNet Bridge');
assert.equal(manifest.version, '2.6.2');
assert.match(background, /DEFAULT_CLOUD_BASE_URL = 'https:\/\/dominium-toa-bridge\.dominium-toa-cloud-bridge\.workers\.dev'/);
assert.match(background, /String\(stored\.dominiumCollectorToken \|\| ''\)/);
assert.match(options, /DEFAULT_COLLECTOR_ID = 'central-toa'/);
assert.match(content, /const ROUTE_TREE_ONLY_MODE = true;/);

const snapshotStart = content.indexOf('function buildOperationalSnapshot');
const snapshotEnd = content.indexOf('function buildDisconnectSnapshot', snapshotStart);
assert.ok(snapshotStart > 0 && snapshotEnd > snapshotStart);
const snapshotSource = content.slice(snapshotStart, snapshotEnd);
for (const forbidden of ['cpfCliente', 'cnpjCliente', 'endereco:', 'telefone', 'cookie', 'csrf']) {
  assert.equal(snapshotSource.toLowerCase().includes(forbidden.toLowerCase()), false, `campo proibido no retrato remoto: ${forbidden}`);
}

console.log('cloud-bridge: configuração, modo silencioso e privacidade validados');
