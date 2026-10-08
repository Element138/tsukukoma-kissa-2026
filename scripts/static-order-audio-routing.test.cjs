const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');

class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function loadRoute(authorized = true) {
  const calls = [];
  const module = { exports: {} };
  const dependencies = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/errors': { AppError },
    '@/lib/response': { fail: error => NextResponse.json({ code: error.code }, { status: error.status || 500 }) },
    '@/lib/server/auth': { requireSession: async () => { if (!authorized) throw new AppError(401, 'UNAUTHORIZED', 'Login required'); } },
    '@/lib/server/google-tts': { synthesizeJapaneseSpeechMp3: async text => { calls.push(text); return Buffer.from('test audio'); } },
  };
  const source = fs.readFileSync('app/api/order-display/audio/[part]/[orderNo]/route.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports: module.exports, module, URL, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency (including Blob): ${name}`);
    return dependencies[name];
  } });
  return { GET: module.exports.GET, calls };
}
const request = new NextRequest('https://example.com/api/order-display/audio/number/1');
const params = (part, orderNo) => ({ params: Promise.resolve({ part, orderNo: String(orderNo) }) });

test('legacy API requests redirect all cached numbers without synthesis or Blob', async () => {
  const route = loadRoute();
  for (const number of [1, 1353, 2000]) for (const part of ['number', 'customer']) {
    const response = await route.GET(request, params(part, number));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `https://example.com/audio/order-call/numbers/v2/${part}-${number}.mp3`);
  }
  assert.equal(route.calls.length, 0);
});

test('apology redirects to a static asset, larger numbers retain Google fallback', async () => {
  const route = loadRoute();
  const apology = await route.GET(request, params('extreme-long-wait', 1));
  assert.equal(apology.headers.get('location'), 'https://example.com/audio/order-call/extreme-long-wait-apology.mp3');
  const response = await route.GET(request, params('customer', 2001));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(route.calls, ['2001番のお客様。']);
});

test('invalid input and unauthorized API calls never trigger Google', async () => {
  const route = loadRoute();
  for (const number of [0, -1, 1.5, 'not-a-number', 1000000]) {
    assert.equal((await route.GET(request, params('number', number))).status, 400);
  }
  assert.equal((await route.GET(request, params('invalid', 1))).status, 400);
  assert.equal(route.calls.length, 0);
  const denied = loadRoute(false);
  assert.equal((await denied.GET(request, params('number', 1))).status, 401);
  assert.equal(denied.calls.length, 0);
});
