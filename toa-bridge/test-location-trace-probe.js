const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'location-network-hook.js'), 'utf8');

assert.match(source, /__TN_TOA_TEST_TECH_TRACE__/);
assert.match(source, /__TN_TOA_TECH_TRACE_STATUS__/);
assert.match(source, /__TN_TOA_SYNC_TECHNICIANS__/);
assert.match(source, /__TN_TOA_CANCEL_TECHNICIAN_SYNC__/);
assert.match(source, /filter\[show_tech_trace\]/);
assert.match(source, /filter\[show_tech_position\]/);
assert.match(source, /resourceTreeSelection\[selectedPid\]/);
assert.match(source, /params\.set\('parent', providerId\)/);
assert.match(source, /params\.set\('sel_pid', providerId\)/);
assert.match(source, /providerIdFromBody/);
assert.match(source, /publishPayload\(traceProbe\.template\.url, payload, \{ providerId \}\)/);
assert.match(source, /originalFetch\(traceProbe\.template\.url/);
assert.match(source, /credentials: 'include'/);
assert.match(source, /hasRealTraceCandidate: timestampedCoordinateObjects > 1/);
assert.match(source, /SAFE_REPLAY_HEADERS/);
assert.match(source, /for \(const providerId of ids\)/);
assert.match(source, /Math\.max\(1000,/);
assert.doesNotMatch(source, /Promise\.all\(ids/);
assert.doesNotMatch(source, /console\.(?:log|table)\([^\n]*traceProbe\.template/);

console.log('location trace probe tests: ok');
