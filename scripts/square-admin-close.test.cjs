const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function setup({ actorType = 'ADMIN', paymentStatus = 'AWAITING', noAttempt = false, owner = 'pos1', paidDuringLock = false, completedPayment = false, deferred = false } = {}) {
  const state = { externalReads: 0, confirmations: [], audits: [], broadcasts: [], locks: 0,
    order: { id: 'order700', orderNo: 700, totalPriceJpy: 300, paymentMethod: 'SQUARE', paymentStatus,
      createdByActorId: owner, squareAttempt: noAttempt ? null : {
        id: 'attempt700', callbackUrl: 'https://kissa.example/api/square/callback',
        transactionId: 'misbound-square-order', locationId: 'location1', launchedAt: new Date(),
        lastError: 'Squareの注文内容が一致しません。管理者に確認してください',
      } },
  };
  const tx = {
    $queryRaw: async () => { state.locks++; if (paidDuringLock) state.order.paymentStatus = 'PAID'; },
    order: { findUniqueOrThrow: async () => structuredClone(state.order) },
    squarePaymentAttempt: { update: async ({ data }) => Object.assign(state.order.squareAttempt, data) },
    paymentIncident: { updateMany: async () => ({ count: 1 }) },
  };
  const externalMismatch = async () => { state.externalReads++; throw new AppError(409, 'SQUARE_MISMATCH', 'mismatch'); };
  const dependencies = {
    zod: require('zod'),
    '@/lib/db': { prisma: { order: { findUnique: async () => structuredClone(state.order) }, $transaction: async callback => callback(tx) } },
    '@/lib/server/auth': { requireSession: async (_req, options) => {
      if (!options.actorTypes.includes(actorType)) throw new AppError(403, 'FORBIDDEN', 'forbidden');
      return { actorId: actorType === 'ADMIN' ? 'admin1' : 'pos1', actorType };
    } },
    '@/lib/server/http': { parseJson: async (req, schema) => schema.parse(await req.json()) },
    '@/lib/errors': { assert: (value, status, code, message) => { if (!value) throw new AppError(status, code, message); } },
    '@/lib/response': { ok: data => ({ status: 200, data }), fail: error => ({ status: error.status ?? 400, code: error.code }) },
    '@/lib/domain/orders': { confirmOrderPayment: async (_tx, input) => { state.confirmations.push(input); state.order.paymentStatus = 'FAILED'; } },
    '@/lib/domain/square-payments': {
      reconcileSquarePayment: async () => { if (deferred) return { verified: false, deferred: true }; state.order.paymentStatus = 'PAID'; return { verified: true }; },
      recordSquareTransaction: async () => true,
    },
    '@/lib/domain/square-verification': { verifySquareTransaction: completedPayment ? async () => { state.externalReads++; } : externalMismatch },
    '@/lib/domain/square-unpaid': { inspectSquareBeforeClosing: completedPayment ? async () => { state.externalReads++; return { kind: 'completed', transactionId: 'matched-payment' }; } : externalMismatch },
    '@/lib/domain/audit': { writeAuditLog: async (_tx, input) => state.audits.push(input) },
    '@/lib/server/realtime-broadcast': { CHANNEL_GROUPS: { ORDER_FLOW: ['orders'] }, broadcastInvalidation: async (...args) => state.broadcasts.push(args) },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('app/api/admin/square-payments/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, process: { env: {} }, URL, Date, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  } });
  return { state, post: (body = {}, origin = 'https://kissa.example') => exports.POST({
    headers: new Headers({ origin }), nextUrl: new URL('https://kissa.example/api/admin/square-payments'),
    json: async () => ({ orderId: 'order700', action: 'NO_CHARGE', attested: true, noChargeConfirmed: true, reason: '元のSquare端末と取引履歴を確認し、未決済と判断', ...body }),
  }) };
}

test('administrator attestation closes #700 despite a misbound Square ID and stored mismatch', async () => {
  const f = setup();
  const response = await f.post({ transactionId: 'admin-supplied-different-id' });
  assert.equal(response.status, 200); assert.equal(response.data.closed, true);
  assert.equal(f.state.order.paymentStatus, 'FAILED'); assert.equal(f.state.externalReads, 1);
  assert.equal(f.state.locks, 1); assert.equal(f.state.confirmations.length, 1);
  assert.equal(f.state.confirmations[0].reasonType, 'ADMIN_NO_CHARGE_ATTESTED');
  assert.equal(f.state.audits[0].beforeJson.recordedTransactionId, 'misbound-square-order');
  assert.match(f.state.audits[0].beforeJson.previousError, /一致しません/);
  assert.equal(f.state.audits[0].beforeJson.operatorAttested, true);
  assert.equal(f.state.audits[0].beforeJson.noChargeConfirmed, true);
  assert.equal(f.state.audits[0].beforeJson.confirmationText, '私はSquareアプリから#700という名前の着金がないことを確認しました。');
  assert.ok(f.state.order.squareAttempt.resolvedAt); assert.equal(f.state.broadcasts.length, 1);
  const repeated = await f.post(); assert.equal(repeated.data.alreadyProcessed, true);
  assert.equal(f.state.confirmations.length, 1);
});

test('POS and administrator can close a legacy unresolved order without launch metadata', async () => {
  for (const actorType of ['ADMIN', 'POS']) {
    const f = setup({ actorType, noAttempt: true });
    assert.equal((await f.post()).data.closed, true); assert.equal(f.state.externalReads, 0);
  }
});

test('attestation, reason, authorization and same-origin checks remain required', async () => {
  for (const body of [{ attested: false }, { reason: ' ' }, { noChargeConfirmed: undefined }, { noChargeConfirmed: false }]) {
    const f = setup(); assert.equal((await f.post(body)).status, 400); assert.equal(f.state.confirmations.length, 0);
  }
  assert.equal((await setup({ actorType: 'WAITER' }).post()).status, 403);
  assert.equal((await setup().post({}, 'https://elsewhere.example')).status, 403);
  assert.equal((await setup({ actorType: 'POS', owner: 'other-pos' }).post()).status, 404);
});

test('POS attestation closes its own order despite Square mismatch and records the operator', async () => {
  const pos = setup({ actorType: 'POS' });
  const result = await pos.post({ transactionId: 'corrected-by-pos' });
  assert.equal(result.data.closed, true); assert.equal(pos.state.externalReads, 1);
  assert.equal(pos.state.confirmations[0].reasonType, 'POS_NO_CHARGE_ATTESTED');
  assert.equal(pos.state.audits[0].actorType, 'POS');
  assert.equal(pos.state.audits[0].beforeJson.operatorAttested, true);
  assert.equal((await pos.post()).data.alreadyProcessed, true);
});

test('VERIFY still runs Square verification for both roles', async () => {
  for (const actorType of ['ADMIN', 'POS']) {
    const f = setup({ actorType }); assert.equal((await f.post({ action: 'VERIFY' })).code, 'SQUARE_MISMATCH');
    assert.equal(f.state.confirmations.length, 0);
  }
});

test('an already recorded or concurrent paid result is preserved', async () => {
  for (const options of [{ paymentStatus: 'PAID' }, { paidDuringLock: true }]) {
    const f = setup(options); const response = await f.post();
    assert.equal(response.data.verified, true); assert.equal(f.state.order.paymentStatus, 'PAID');
    assert.equal(f.state.confirmations.length, 0);
  }
});

test('a completed payment found during closure completes the order instead of terminating it', async () => {
  for (const actorType of ['ADMIN', 'POS']) {
    const f = setup({ actorType, completedPayment: true }); const response = await f.post();
    assert.equal(response.data.verified, true); assert.equal(response.data.paymentFound, true);
    assert.equal(f.state.order.paymentStatus, 'PAID'); assert.equal(f.state.confirmations.length, 0);
  }
});

test('verification in progress after a real payment was found cannot terminate that order', async () => {
  const f = setup({ completedPayment: true, deferred: true }); const response = await f.post();
  assert.equal(response.data.deferred, true); assert.equal(f.state.order.paymentStatus, 'AWAITING');
  assert.equal(f.state.confirmations.length, 0);
});
