'use strict';

const assert = require('node:assert/strict');
const core = require('./toa-inventory-core.js');

function fixture() {
  return {
    delta: {
      Activity: {
        194300555: {
          aid: 194300555,
          customer_number: '2221170',
          cname: 'CLIENTE TESTE',
          astatus: 'complete',
          auto_routed_to_provider_id: 328898,
          193: '2646508672',
          194: 'E',
          195: 409,
          196: '2646508683',
          197: 'E',
          198: 409,
          466: 'Z637677',
          _identifier_structure: {
            aworktype: { text: 'MUDANCA DE PACOTE' },
          },
        },
        999999999: {
          aid: 999999999,
          customer_number: '9999999',
        },
      },
      Provider: {
        328898: {
          pid: 328898,
          external_id: 'Z637677',
          pname: 'DENNIS NUNES DE OLIVEIRA',
        },
      },
      Inventory: {
        1: {
          invid: 1,
          inv_aid: 194300555,
          inv_pid: 328898,
          invpool: 'install',
          invsn: '2CD8AE5D436F',
          335: '25471541',
          419: '1',
          _identifier_structure: {
            invtype: { text: 'EMTA' },
            335: { text: '25471541' },
            419: { text: 'instalado' },
          },
        },
        2: {
          invid: 2,
          inv_aid: 194300555,
          inv_pid: 328898,
          invpool: 'deinstall',
          invsn: 'B4F26757B818',
          335: '25471541',
          _identifier_structure: {
            invtype: { text: 'EMTA' },
            335: { text: '25471541' },
          },
        },
        3: {
          invid: 3,
          inv_aid: 194300555,
          inv_pid: 328898,
          invpool: 'customer',
          invsn: '241786844144',
          _identifier_structure: {
            invtype: { text: 'DECODER DIGITAL' },
          },
        },
        4: {
          invid: 4,
          inv_aid: 194300555,
          inv_pid: 328898,
          invpool: 'install',
          192: '22069613',
          335: '25471541',
          419: '1',
          quantity: '100.5',
          stock_quantity: '14',
          _identifier_structure: {
            192: { text: '22069613_CONECTOR FO CAMPO FAST SC/APC' },
            335: { text: '25471541' },
            419: { text: 'instalado' },
          },
        },
        5: {
          invid: 5,
          inv_aid: 999999999,
          invpool: 'install',
          invsn: 'FOREIGN123',
        },
      },
      FormData: {
        a: {
          form_data_id: 'a',
          activity_id: 194300555,
          provider_id: 328898,
          user_name: 'DENNIS',
        },
        b: {
          form_data_id: 'b',
          activity_id: 999999999,
          provider_id: 1,
        },
      },
    },
  };
}

const source = fixture();
const before = JSON.stringify(source);
const capture = core.normalizeActivityResponse(source, '194300555', {
  route: {
    aid: '194300555',
    pid: '328898',
    external_id: 'Z637677',
    date: '2026-07-22',
  },
  captureSource: 'test',
});

assert.equal(capture.schema_version, 2);
assert.equal(capture.aid, '194300555');
assert.equal(capture.contract, '2221170');
assert.deepEqual(
  capture.tasks.map((task) => [task.index, task.os_number, task.close_code]),
  [[1, '2646508672', '409'], [2, '2646508683', '409']]
);
assert.equal(capture.inventory.length, 4);
assert.equal(capture.installed_equipment[0].serial, '2CD8AE5D436F');
assert.equal(capture.removed_equipment[0].serial, 'B4F26757B818');
assert.equal(capture.customer_equipment[0].serial, '241786844144');
assert.equal(capture.materials[0].material_code, '22069613');
assert.equal(capture.materials[0].used_quantity, '100.5');
assert.equal(capture.materials[0].available_stock, '14');
assert.equal(capture.materials[0].point, '25471541');
assert.equal(capture.materials[0].quantity, '100.5');
assert.equal(capture.forms.length, 1);
assert.equal(capture.responsibility.assigned_technician.external_id, 'Z637677');
assert.match(capture.validation.warnings.join('|'), /foreign_inventory_ignored:1/);
assert.match(capture.validation.warnings.join('|'), /foreign_forms_ignored:1/);
assert.equal(JSON.stringify(source), before, 'normalization must not mutate TOA data');

assert.equal(core.decimalString('00100,500'), '100.5');
assert.equal(core.decimalString('not-a-number'), '');
const identifierOnlyMaterial = core.normalizeInventoryItem({
  invid: 10,
  inv_aid: 194300555,
  quantity: '2',
  _identifier_structure: {
    192: { text: '22069613_CONECTOR FO CAMPO FAST SC/APC' },
  },
}, '10', '194300555');
assert.equal(identifierOnlyMaterial.material_code, '22069613');
assert.equal(identifierOnlyMaterial.used_quantity, '2');

const routeMismatch = core.normalizeActivityResponse(fixture(), '194300555', {
  route: { aid: '123' },
});
assert.match(routeMismatch.validation.errors.join('|'), /route_activity_id_mismatch/);

const invalidQuantity = fixture();
invalidQuantity.delta.Inventory[4].quantity = 'invalid';
const invalidCapture = core.normalizeActivityResponse(invalidQuantity, '194300555', {
  route: { aid: '194300555' },
});
assert.match(invalidCapture.validation.errors.join('|'), /material_used_quantity_invalid:4/);

const zeroQuantity = fixture();
zeroQuantity.delta.Inventory[4].quantity = '0';
const zeroCapture = core.normalizeActivityResponse(zeroQuantity, '194300555', {
  route: { aid: '194300555' },
});
assert.match(zeroCapture.validation.errors.join('|'), /material_used_quantity_invalid:4/);

console.log('toa-inventory-core: all tests passed');
