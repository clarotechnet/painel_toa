const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, 'content-main.js'), 'utf8');

// Contrato observado nos HARs reais do TOA em 22 e 24/08/2026:
// Map/get -> queue[aid] -> x=longitude, y=latitude, ETA e show_order.
assert.match(source, /const toaLongitude = locationNumber\(raw\.x\)/);
assert.match(source, /const toaLatitude = locationNumber\(raw\.y\)/);
assert.match(source, /activity\|activities\|queue/);
assert.match(source, /'ETA', 'eta'/);
assert.match(source, /scheduledAt\?\.slice\(0, 10\)/);
assert.match(source, /!\/\\\/queue\$\/\.test\(context\.path\)/);
assert.match(source, /function replaceMapVisitSnapshot/);
assert.match(source, /replace_visits: Boolean\(resource\.replace_visits\)/);
assert.match(source, /hasAuthoritativeQueue/);
assert.match(source, /if \(!context\.skipVisit\) queueLocationVisit/);
assert.match(source, /record\.providerId/);
assert.match(source, /'routePosition', 'show_order'/);
assert.match(source, /value === null \|\| value === undefined \|\| value === ''/);

console.log('OK: parser Map/get preserva snapshot queue[aid], ETA, show_order e coordenadas validas.');
