const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('lib/receipt/epson-handoff.ts', 'utf8');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: moduleValue.exports, module: moduleValue, URL, Uint8Array,
  btoa: binary => Buffer.from(binary, 'binary').toString('base64') });
const { epsonPdfHandoff, isAppleMobileDevice } = moduleValue.exports;

test('iPad including desktop-mode iPadOS uses Epson; laptops keep PDF preview', () => {
  assert.equal(isAppleMobileDevice('Mozilla iPad', 5), true);
  assert.equal(isAppleMobileDevice('Mozilla iPhone', 5), true);
  assert.equal(isAppleMobileDevice('Mozilla Macintosh Safari', 5), true);
  assert.equal(isAppleMobileDevice('Mozilla Macintosh Safari', 0), false);
  assert.equal(isAppleMobileDevice('Mozilla Windows Chrome', 10), false);
  assert.equal(isAppleMobileDevice('Mozilla Android Chrome', 5), false);
});
test('Epson URL round-trips binary PDF with correctly escaped Base64', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([251, 255, 254, 0, 128])]);
  const url = new URL(epsonPdfHandoff(pdf, 'https://pos.example/order-book?date=2026-10-17'));
  assert.equal(url.protocol, 'tmprintassistant:');
  assert.equal(url.hostname, 'tmprintassistant.epson.com');
  assert.equal(url.pathname, '/print');
  assert.equal(url.searchParams.get('ver'), '1');
  assert.equal(url.searchParams.get('data-type'), 'pdf');
  assert.deepEqual(Buffer.from(url.searchParams.get('data'), 'base64'), pdf);
  assert.equal(url.searchParams.get('success'), 'https://pos.example/order-book?date=2026-10-17');
  assert.equal(url.searchParams.get('error-dialog'), 'yes');
  assert.equal(url.searchParams.get('reselect'), 'yes');
  assert.equal(url.searchParams.get('cut'), 'feed');
  assert.equal(url.searchParams.get('fit-to-width'), 'yes');
  assert.equal(url.searchParams.get('printable-width'), '72');
  assert.ok(!url.href.includes('token='));
});

test('Epson requests end feed without modifying the PDF or using black-mark feed', () => {
  const pdf = Buffer.from('%PDF-1.7\noriginal receipt with bottom whitespace\n%%EOF');
  const url = new URL(epsonPdfHandoff(pdf, 'https://pos.example/pos'));
  assert.equal(url.searchParams.get('cut'), 'feed');
  assert.equal(url.searchParams.has('feed-position'), false);
  assert.deepEqual(Buffer.from(url.searchParams.get('data'), 'base64'), pdf);
});
test('rejects invalid PDF, unsafe callback, oversized PDF and oversized encoded URL', () => {
  assert.throws(() => epsonPdfHandoff(Buffer.from('login page'), 'https://pos.example'));
  assert.throws(() => epsonPdfHandoff(Buffer.from('%PDF-'), 'javascript:alert(1)'));
  assert.throws(() => epsonPdfHandoff(Buffer.alloc(151 * 1024), 'https://pos.example'));
  const big = Buffer.alloc(149 * 1024, 255);
  big.write('%PDF-');
  assert.throws(() => epsonPdfHandoff(big, 'https://pos.example'));
});
test('existing sample PDF fits the native handoff, if generated', () => {
  const sample = 'output/pdf/receipt-large.pdf';
  if (!fs.existsSync(sample)) return;
  const pdf = fs.readFileSync(sample);
  const url = new URL(epsonPdfHandoff(pdf, 'https://pos.example/pos'));
  assert.deepEqual(Buffer.from(url.searchParams.get('data'), 'base64'), pdf);
});
