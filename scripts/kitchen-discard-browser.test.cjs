const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const baseUrl = process.env.KISSA_TEST_BASE_URL || 'http://localhost:3126';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname));

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    fs.mkdirSync('output', { recursive: true });
    for (const width of [375, 820]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const actor = { id: 'kitchen1', actorType: 'KITCHEN', label: 'Kitchen', isActive: true, kitchenEnabled: true, kitchenDisplayOrder: 0 };
      const menu = { menuId: '00000000-0000-4000-8000-000000000001', menuName: 'テストコーヒー', availability: 'AVAILABLE', hasActiveKitchenCoverage: true,
        queuedCount: 10, surplusCount: 0, readyCount: 10, todayCookedCount: 20, oldestQueuedSeconds: 0, oldestElapsed: '0:00', queuedOrders: [],
        todayOrderCount: 10, remainingUntilCap: 90, dailyOrderCap: 100, isCapReached: false };
      const posts = [];
      const errors = [];
      await context.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data = {};
        if (path === '/api/auth/me') data = { actor: { actorId: actor.id, actorType: 'KITCHEN', label: actor.label }, offlineActors: [] };
        if (path === '/api/admin/actors') data = { actors: [actor] };
        if (path === '/api/kitchen/queue') data = { menus: [menu] };
        if (path === '/api/kitchen/menus/ready') {
          const body = route.request().postDataJSON(); posts.push(body);
          menu.readyCount += body.quantity; menu.todayCookedCount += body.quantity;
          if (body.correctionType === 'DISCARD') menu.dailyOrderCap += body.quantity;
          else menu.dailyOrderCap = 94; // A concurrent discard elsewhere, while this editor stays open.
          data = { markedReadyCount: body.quantity, correctionType: body.correctionType };
        }
        if (path === '/api/kitchen/menu-cap') {
          const body = route.request().postDataJSON(); posts.push(body);
          assert.equal(body.expectedDailyOrderCap, 97, 'the baseline must be captured when opening, not replaced by a realtime refresh');
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'MENU_CAP_CHANGED', message: '上限が別の操作で変更されました。最新の上限を確認し、もう一度設定してください' } }) }); return;
        }
        if (path === '/api/realtime/token') { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }); return; }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      for (let attempt = 0; ; attempt++) {
        try { await page.goto(`${baseUrl}/kitchen`, { waitUntil: 'domcontentloaded', timeout: 120000 }); break; }
        catch (error) { if (attempt >= 29 || !String(error).includes('ERR_CONNECTION_REFUSED')) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
      }
      await page.getByText('テストコーヒー', { exact: true }).waitFor({ timeout: 60000 });
      const minus = page.getByRole('button', { name: '数量を減らす', exact: true });
      for (let count = 0; count < 4; count++) await minus.click();
      const discard = page.getByRole('button', { name: /^3個\s*廃棄する$/ });
      const uncook = page.getByRole('button', { name: /^3個\s*未調理にする$/ });
      const left = await discard.boundingBox(), right = await uncook.boundingBox();
      assert.ok(left.x + left.width <= right.x + 1); assert.ok(Math.abs(left.width - right.width) < 1);
      assert.ok(left.width >= 60 && right.width >= 60, 'both halves need usable touch areas');
      await page.screenshot({ path: `output/kitchen-discard-${width}.png`, fullPage: true });
      await discard.click();
      await page.getByText(/上限 97 個/).waitFor(); assert.equal(posts[0].correctionType, 'DISCARD'); assert.equal(posts[0].quantity, -3);
      assert.equal(posts[0].dailyOrderCap, undefined, 'discard must never send a stale replacement cap');
      await page.getByRole('button', { name: '変更', exact: true }).click();
      for (let count = 0; count < 4; count++) await minus.click();
      await page.getByRole('button', { name: /^3個\s*未調理にする$/ }).click();
      await page.getByText(/上限 94 個/).waitFor(); assert.equal(posts[1].correctionType, 'UNCOOK');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByText(/上限が別の操作で変更されました/).waitFor();
      await page.getByRole('button', { name: '変更', exact: true }).waitFor();
      assert.equal(menu.dailyOrderCap, 94); assert.deepEqual(errors, []);
      await context.close(); console.log(`PASS ${width}px: split actions, correct payloads, and stale cap conflict recovery`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
