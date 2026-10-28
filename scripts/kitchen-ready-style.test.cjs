const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

test('negative kitchen button stays red against the full global CSS cascade', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button class="ready-action-submit" id="ready">1個調理済みにする</button><button class="ready-action-submit ready-action-submit-negative" id="reduce">1個調理済みを減らす</button>');
    await page.addStyleTag({ content: fs.readFileSync('app/globals.css', 'utf8') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Disable transitions so assertions measure the final state, not animation frames.
    await page.addStyleTag({ content: 'button { transition: none !important; }' });
    const style = id => page.locator(id).evaluate(element => {
      const computed = getComputedStyle(element);
      return { background: computed.backgroundColor, image: computed.backgroundImage, color: computed.color };
    });
    assert.deepEqual(await style('#ready'), { background: 'rgb(15, 118, 110)', image: 'none', color: 'rgb(255, 255, 255)' });
    assert.deepEqual(await style('#reduce'), { background: 'rgb(198, 40, 40)', image: 'none', color: 'rgb(255, 255, 255)' });
    await page.locator('#reduce').hover();
    assert.deepEqual(await style('#reduce'), { background: 'rgb(167, 31, 31)', image: 'none', color: 'rgb(255, 255, 255)' });
    await page.locator('#reduce').evaluate(element => { element.disabled = true; });
    assert.equal((await style('#reduce')).image, 'none');
    await page.locator('#ready').hover();
    assert.equal((await style('#reduce')).background, 'rgb(198, 40, 40)');
    assert.match(fs.readFileSync('app/kitchen/page.tsx', 'utf8'), /readyQuantity < 0 && "ready-action-submit-negative"/);
  } finally {
    await browser.close();
  }
});
