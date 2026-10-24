const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const { chromium } = require('playwright-core');

test('real print dialog fits iPhone SE, reduced browser height and landscape', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ReceiptPrintDialog} from './components/receipt-print-dialog';
      import {Button} from './components/ui/button';
      const mode = new URL(location.href).searchParams.get('mode');
      window.fetch = async () => {
        if (mode === 'loading') return new Promise(() => {});
        if (mode === 'error') return new Response(JSON.stringify({error:{message:'プリンターの設定を確認してください。' + 'VeryLongUnbrokenErrorMessage'.repeat(12)}}), {status:503});
        return new Response('%PDF-1.7\\nfixture', {headers:{'content-type':'application/pdf'}});
      };
      function Fixture() {
        const [target,setTarget] = useState({id:'fixture',orderNo:266});
        return <ReceiptPrintDialog target={target} onClose={()=>setTarget(null)} additionalAction={<Button variant="destructive">注文を取り消す</Button>} />;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const css = (await postcss([tailwind(require('../tailwind.config.js'))]).process(fs.readFileSync('app/globals.css', 'utf8'), {from:'app/globals.css'})).css;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    fs.mkdirSync('tmp/receipt-dialog', {recursive:true});
    for (const viewport of [{width:375,height:667},{width:375,height:550},{width:667,height:375},{width:1280,height:800}]) {
      const context = await browser.newContext({viewport, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
      await context.route('**/*', route => route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
      for (const mode of ['ready','error','loading']) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`https://receipt-layout.test/?mode=${mode}`);
        await page.addStyleTag({content:css});
        await page.addScriptTag({content:bundle.outputFiles[0].text});
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        if (mode === 'ready') {
          await page.locator('a[href^="tmprintassistant:"]').waitFor();
          await page.locator('a[href^="siiprintagent:"]').waitFor();
        } else if (mode === 'error') await page.getByRole('button',{name:'再試行'}).first().waitFor();
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${JSON.stringify(viewport)} ${mode}: dialog must stay inside viewport`);
        const body = page.locator('.receipt-print-body');
        assert.ok(await body.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No horizontal scrolling');
        const close = dialog.getByRole('button',{name:'Close',exact:true});
        assert.ok(await close.isVisible());
        const closeInitial = await close.boundingBox();
        const description = await dialog.locator('[id]').filter({hasText:'の用紙サイズを選択してください。'}).last().boundingBox();
        if (description) assert.ok(description.x + description.width <= closeInitial.x - 2, 'Header text must not run beneath close control');
        if (viewport.width === 375 && viewport.height === 667) await page.screenshot({path:`tmp/receipt-dialog/se-${mode}-top.png`});
        await dialog.getByRole('button',{name:'注文を取り消す',exact:true}).scrollIntoViewIfNeeded();
        if (viewport.width === 375 && viewport.height === 667) await page.screenshot({path:`tmp/receipt-dialog/se-${mode}.png`});
        // Scrolling the body must not move the header's close control off screen.
        const closeBox = await close.boundingBox();
        assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= viewport.height);
        await close.click();
        await dialog.waitFor({state:'hidden'});
        assert.deepEqual(errors, []);
        await page.close();
      }
      await context.close();
    }
  } finally { await browser.close(); }
});
