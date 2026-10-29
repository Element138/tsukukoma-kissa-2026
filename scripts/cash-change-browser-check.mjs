import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

await mkdir("tmp/cash-change-check", { recursive: true });
const bundle = await build({
  stdin: { contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';
    import {CashChange} from './components/cash-change';
    function App(){const [total,setTotal]=useState(700),[version,setVersion]=useState(0),[cash,setCash]=useState(true);
      return <main><div className="row between"><span>合計</span><strong>¥{total}</strong></div>
        {cash&&<CashChange key={version} totalJpy={total}/>}
        <button onClick={()=>setTotal(1200)}>Change total</button>
        <button onClick={()=>setVersion(v=>v+1)}>Next order</button>
        <button onClick={()=>setCash(v=>!v)}>Switch method</button></main>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const css = await readFile("app/globals.css", "utf8");
const html = resolve("tmp/cash-change-check/index.html");
await writeFile(html, `<html lang="ja"><meta charset="utf-8"><style>${css}body{padding:24px}main{width:min(100%,420px);margin:auto}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></html>`);
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(html).href);
  const input = page.getByLabel("お預り", { exact: true });
  const change = page.getByLabel("お釣り", { exact: true });
  await input.waitFor();
  assert.equal(await input.inputValue(), "0");
  assert.equal(await page.locator(".pos-cash-yen").innerText(), "￥");
  assert(await page.locator(".pos-cash-yen").isVisible());
  assert.equal(await change.innerText(), "—");
  await input.click();await page.keyboard.type("1000");
  assert.equal(await input.inputValue(), "1000", "Focus selects the initial zero");
  assert.match(await change.innerText(), /300/);
  await input.fill("700");assert.match(await change.innerText(), /0/);
  await input.fill("699");assert.equal(await change.innerText(), "—");
  await input.fill("");assert.equal(await change.innerText(), "—");
  await input.blur();assert.equal(await input.inputValue(), "0");
  await input.fill("１，０００");assert.equal(await input.inputValue(), "1000");
  await page.getByText("Change total", { exact: true }).click();assert.equal(await change.innerText(), "—");
  await input.fill("2000");assert.match(await change.innerText(), /800/);
  await page.screenshot({ path: "tmp/cash-change-check/mobile.png" });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByText("Next order", { exact: true }).click();assert.equal(await input.inputValue(), "0");
  await page.getByText("Switch method", { exact: true }).click();assert.equal(await input.count(), 0);
  await page.getByText("Switch method", { exact: true }).click();assert.equal(await input.inputValue(), "0");
  assert.deepEqual(errors, []);assert.deepEqual(requests, [], "Cash calculations make no server requests");
  console.log("Cash change browser checks passed: initial zero, focus selection, sufficient/exact/insufficient cash, empty/full-width input, changed totals, next-order reset, cash-only visibility, mobile fit and no network requests.");
} finally { await browser.close(); }
