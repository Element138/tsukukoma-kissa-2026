const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/receipt/sii-handoff.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: moduleValue.exports, module: moduleValue, URL, Uint8Array,
  btoa: binary => Buffer.from(binary, 'binary').toString('base64') });
const { siiPdfHandoff } = moduleValue.exports;
test('SII v1.0 PDF handoff preserves binary data and sets MP-B20 options', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([251,255,254,0,128])]);
  const url = new URL(siiPdfHandoff(pdf, 'https://pos.example/pos?order=1&mode=a'));
  assert.equal(url.protocol, 'siiprintagent:');
  assert.equal(url.hostname, '1.0'); assert.equal(url.pathname, '/print');
  assert.equal(url.searchParams.get('Format'), 'pdf');
  assert.deepEqual(Buffer.from(url.searchParams.get('Data'), 'base64'), pdf);
  assert.equal(url.searchParams.get('CallbackSuccess'), 'https://pos.example/pos?order=1&mode=a');
  for (const [key,value] of Object.entries({BtKeepConnect:'no',PaperWidth:'58',FitToWidth:'yes',CutType:'off',CutFeed:'yes',ErrorDialog:'yes',SelectOnError:'yes'})) assert.equal(url.searchParams.get(key),value);
});
test('SII rejects invalid PDF, excessive payloads and unsafe callback', () => {
  assert.throws(() => siiPdfHandoff(Buffer.from('html login'), 'https://pos.example'));
  assert.throws(() => siiPdfHandoff(Buffer.alloc(501 * 1024), 'https://pos.example'));
  const big = Buffer.alloc(499 * 1024, 255); big.write('%PDF-');
  assert.throws(() => siiPdfHandoff(big, 'https://pos.example'));
  assert.throws(() => siiPdfHandoff(Buffer.from('%PDF-'), 'javascript:alert(1)'));
});
test('shared iPad component selects the correct app and preserves PDF preview', () => {
  const source = fs.readFileSync('components/receipt-print-dialog.tsx', 'utf8');
  assert.match(source, /size === "large" \? epsonPdfHandoff : siiPdfHandoff/);
  assert.match(source, /if \(appleMobile\) return <NativePrintOption/);
  assert.match(source, /receiptPdfPath\(orderId, size\)/);
  assert.match(fs.readFileSync('lib/receipt/paper.ts','utf8'), /printer: "SII MP-B20"/);
});
