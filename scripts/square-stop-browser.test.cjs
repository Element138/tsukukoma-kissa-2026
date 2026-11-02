const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const baseUrl = process.env.KISSA_TEST_BASE_URL || 'http://127.0.0.1:3123';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname));

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    fs.mkdirSync('output', { recursive: true });
    for (const mode of ['closed', 'completed', 'verify']) {
      const context = await browser.newContext({ viewport: { width: 820, height: 1100 } });
      let resolved = false;
      const posts = [];
      const errors = [];
      const order = { id: 'order700', orderNo: 700, totalPriceJpy: 300, createdAt: '2026-10-31T02:12:00Z', createdByActorId: 'pos1',
        squareAttempt: { launchedAt: '2026-10-31T02:12:00Z', transactionId: 'transaction700', verifyAttempts: 3, lastError: 'Squareの注文内容が一致しません。' } };
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data = {};
        if (url.pathname === '/api/auth/me') data = { actor: { actorId: 'pos1', actorType: 'POS', label: 'POS1' }, offlineActors: [] };
        else if (url.pathname === '/api/admin/square-payments') {
          if (route.request().method() === 'POST') {
            posts.push(route.request().postDataJSON()); resolved = true;
            data = mode === 'closed' ? { closed: true } : { verified: true, paymentFound: mode === 'completed' };
          } else data = { orders: resolved ? [] : [order], incidents: [], incidentCount: 0 };
        } else if (url.pathname === '/api/realtime/token') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) }); return;
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      for (let attempt = 0; ; attempt++) {
        try {
          await page.goto(`${baseUrl}/admin/square-payments`, { waitUntil: 'domcontentloaded', timeout: 120000 });
          break;
        } catch (error) {
          if (attempt >= 29 || !String(error).includes('ERR_CONNECTION_REFUSED')) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      await page.getByText('注文 #700', { exact: true }).waitFor({ timeout: 60000 });
      await page.getByPlaceholder('確認した店舗・金額・取引時刻など').fill('Squareアプリの取引履歴を確認しました');
      await page.getByRole('checkbox').check();
      if (mode === 'verify') {
        await page.getByRole('button', { name: '支払い状況を再確認', exact: true }).click();
        await page.getByText('照合待ちの注文はありません', { exact: true }).waitFor();
        assert.equal(posts.length, 1); assert.equal(posts[0].action, 'VERIFY');
        assert.equal(await page.getByRole('alertdialog').count(), 0);
        assert.equal(await page.getByRole('dialog').count(), 0, 'ordinary verification must not show the closure warning receipt');
      } else {
        await page.getByRole('button', { name: '未決済を確認して注文を終了', exact: true }).click();
        const stop = page.getByRole('alertdialog');
        await stop.getByRole('heading', { name: 'STOP!', exact: true }).waitFor();
        const confirmation = '私はSquareアプリから#700という名前の着金がないことを確認しました。';
        assert.equal(await stop.getByText(confirmation, { exact: true }).count(), 1);
        assert.equal(await stop.getByRole('button', { name: '確認して注文を終了', exact: true }).isEnabled(), false);
        assert.equal(posts.length, 0, 'opening STOP must not submit termination');
        await stop.getByRole('checkbox').check();
        await stop.getByRole('button', { name: '戻る', exact: true }).click();
        await page.getByRole('button', { name: '未決済を確認して注文を終了', exact: true }).click();
        assert.equal(await stop.getByRole('checkbox').isChecked(), false, 'each attempt needs a fresh confirmation');
        await stop.getByRole('checkbox').check();
        if (mode === 'completed') await page.screenshot({ path: 'output/square-stop.png', fullPage: true });
        await stop.getByRole('button', { name: '確認して注文を終了', exact: true }).click();
        await page.getByText('照合待ちの注文はありません', { exact: true }).waitFor();
        assert.equal(posts.length, 1); assert.equal(posts[0].action, 'NO_CHARGE'); assert.equal(posts[0].noChargeConfirmed, true);
        if (mode === 'completed') {
          const receipt = page.getByRole('dialog');
          await receipt.getByRole('heading', { name: 'レシート印刷', exact: true }).waitFor();
          await receipt.getByText('注文 #700 の決済が完了しました', { exact: true }).waitFor();
          assert.match(await receipt.getByRole('alert').innerText(), /注文を終了しようとしましたが、Squareへの着金が確認されたため/);
          assert.equal(await receipt.getByRole('link').count(), 2);
          await page.screenshot({ path: 'output/square-payment-found.png', fullPage: true });
          await receipt.getByRole('button', { name: '印刷せず閉じる', exact: true }).click();
          assert.equal(await page.getByRole('dialog').count(), 0);
        } else assert.equal(await page.getByRole('dialog').count(), 0, 'an unpaid closure must not open a receipt');
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${mode}: STOP confirmation and appropriate result UI`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
