import assert from 'node:assert/strict';
import { createXlsxBlob, createXlsxBytes } from '../src/utils/xlsx.js';

const bytes = createXlsxBytes([
  ['OS', 'Contrato', 'Técnico'],
  ['2650000001', '408676249', 'JOSÉ DA SILVA'],
], { sheetName: 'Monitor TOA' });

assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), 0x04034b50);
const binaryText = new TextDecoder().decode(bytes);
for (const required of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
  assert.match(binaryText, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(binaryText, /Monitor TOA/);
assert.match(binaryText, /2650000001/);
assert.match(binaryText, /JOSÉ DA SILVA/);
assert.match(binaryText, /<dimension ref="A1:C2"\/>/);

const blob = createXlsxBlob([['OS'], ['1']]);
assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
assert.ok(blob.size > 1000);

console.log('Exportação XLSX validada.');
