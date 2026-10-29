import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

await mkdir("tmp/pos-age-layout", { recursive: true });
const bundle = await build({
  stdin: { contents: `import {createRoot} from 'react-dom/client';import {AGE_GROUPS} from './lib/age-groups';
    createRoot(document.getElementById('root')).render(<main className="dashboard-shell"><div className="dashboard-body"><div className="grid two"><section className="card">メニュー</section><section className="card">
      <div className="age-group-grid" style={{'--age-group-rows':Math.ceil(AGE_GROUPS.length/2)}}>
        {AGE_GROUPS.map(group=><div className="age-group-row" key={group.key}><span>{group.label}</span><div className="row"><button className="ghost-btn">-</button><strong>0</strong><button className="ghost-btn">+</button></div></div>)}
      </div></section></div></div></main>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const css = await readFile("app/globals.css", "utf8");
const html = resolve("tmp/pos-age-layout/index.html");
await writeFile(html, `<html lang="ja"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></html>`);
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(html).href);
  await page.locator(".age-group-row").first().waitFor();
  for (const [width, height] of [[744,1133],[1133,744],[768,1024],[1024,768],[390,844]]) {
    await page.setViewportSize({ width, height });
    const rows = await page.locator(".age-group-row").evaluateAll(elements => elements.map(el => {
      const box=el.getBoundingClientRect(), label=el.firstElementChild.getBoundingClientRect(), controls=el.lastElementChild.getBoundingClientRect();
      return { x:box.x, y:box.y, right:box.right, bottom:box.bottom, fits:label.right<=controls.left&&controls.right<=box.right };
    }));
    assert(rows.every(row=>row.fits), `Age controls must fit at ${width}px`);
    if (width >= 700) {
      assert(rows.slice(0,4).every(row=>Math.abs(row.x-rows[0].x)<1));
      assert(rows.slice(4).every(row=>row.x>rows[0].x));
      assert(Math.abs(rows[0].y-rows[4].y)<1);
      assert(rows[1].y>rows[0].y&&rows[2].y>rows[1].y&&rows[3].y>rows[2].y);
      assert(rows[5].y>rows[4].y&&rows[6].y>rows[5].y);
    } else assert(rows.every(row=>Math.abs(row.x-rows[0].x)<1));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({ path:`tmp/pos-age-layout/${width}x${height}.png` });
  }
  console.log("Age layout checks passed: four rows in two columns, down-left then down-right at iPad mini portrait/landscape and 768/1024px; controls fit, with one column on phones.");
} finally { await browser.close(); }
