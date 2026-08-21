const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeXHR {
  addEventListener() {}
  open() {}
  send() {}
}

const context = {
  console,
  URL,
  URLSearchParams,
  AbortController,
  Blob,
  setTimeout,
  clearTimeout,
  location: { href: 'https://clarobrasil.etadirect.com/', origin: 'https://clarobrasil.etadirect.com' },
  document: { querySelectorAll: () => [] },
  fetch: async () => ({ clone: () => ({ json: async () => ({}) }) }),
  XMLHttpRequest: FakeXHR,
};
context.window = context;

const source = fs.readFileSync(path.join(__dirname, 'toa-auto-export.js'), 'utf8');
vm.runInNewContext(source, context, { filename: 'toa-auto-export.js' });

const api = context.TNTOAAutoExport;
assert.ok(api, 'API da árvore não foi instalada');

api.observePayload({
  delta: {
    Provider: {
      33128: { pid: 33128, pname: 'NTL-DMV', parent_id: 0 },
      1439: { pid: 1439, pname: 'EDICARLOS DE LIRA SILVA', external_id: 'Z131568', parent_id: 33128 },
    },
  },
});

assert.deepEqual(
  JSON.parse(JSON.stringify(api.routeForProvider('1439'))),
  { name: 'NTL-DMV', providerId: '33128', source: 'Time.get:delta' },
);
assert.equal(api.treeStatus().buckets, 1);

api.observePayload({
  pid: 1439,
  p: { z: 1439, n: 'EDICARLOS DE LIRA SILVA', e: 'Z131568', p: 33128, t: 5 },
});
assert.equal(api.selectedProvider().providerId, '1439');
assert.equal(api.selectedProvider().externalId, 'Z131568');
assert.equal(api.selectedProvider().route.name, 'NTL-DMV');

console.log('test-toa-route-tree: ok');
