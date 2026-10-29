import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import sharp from "sharp";

const html = resolve(process.env.MENU_HTML ?? "output/Kissa-Menu-HTML-Test2/Menu.html");
const fileUrl = pathToFileURL(html).href;
const source = await readFile(html, "utf8");
assert(!source.includes('src="/assets/') && !source.includes('/_next/'));
const config = JSON.parse(/<script id="menu-config" type="application\/json">([\s\S]*?)<\/script>/.exec(source)[1]);
const image = await sharp({create:{width:400,height:300,channels:3,background:"#7f896a"}}).webp().toBuffer();
const hash = createHash("sha256").update(image).digest("hex");
let data = structuredClone(config.seed.data);
data.categories[0].menus[0].name = "キャッシュ更新テスト";
data.categories[0].menus[0].coverImageDataUrl = `/api/menu-covers/${hash}`;
await mkdir("tmp/file-menu-check",{recursive:true});
const results = {};

for (const [name, executablePath] of [["chrome","C:/Program Files/Google/Chrome/Application/chrome.exe"],["edge","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]]) {
  const profile = await mkdtemp(resolve(`tmp/file-menu-check/${name}-`));
  let mode="offline", downloads=0, requests=[];
  let context;
  const errors=[];
  async function start() {
    context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:{width:2160,height:3840},timezoneId:"America/Los_Angeles"});
    await context.addCookies([{name:"kissa_session",value:"must-not-send",url:new URL(config.feedUrl).origin}]);
    await context.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.protocol==="file:"||url.protocol==="data:"){await route.continue();return;}
      requests.push({url:req.url(),origin:req.headers().origin,cookie:req.headers().cookie});
      assert.equal(url.origin,new URL(config.feedUrl).origin,"No external fonts/assets/auth/helper requests");
      if(mode==="offline"){await route.abort();return;}
      const headers={"Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"Date, Age",Date:new Date().toUTCString()};
      if(url.pathname.startsWith("/api/menu-covers/")){
        downloads++;
        await route.fulfill({status:mode==="image-failure"?503:200,headers:{...headers,"Content-Type":"image/webp"},body:image});return;
      }
      assert.equal(url.pathname,new URL(config.feedUrl).pathname);
      const body=mode==="malformed"?{ok:true,data:{categories:[]}}:{ok:true,data};
      await route.fulfill({headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(body)});
    });
    const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",error=>errors.push(error.message));
    return page;
  }
  const refresh = page=>page.evaluate(()=>window.dispatchEvent(new Event("online")));
  const ready = async page=>{await page.locator(".menu-display-row").first().waitFor();await page.evaluate(()=>document.fonts.ready);};
  try {
    let page=await start();await page.goto(fileUrl,{waitUntil:"load",timeout:120000});await ready(page);
    assert.equal(await page.locator(".menu-display-row").count(),11);
    assert.equal(await page.locator("button,.terminal-banner").count(),0);
    const cdp=await context.newCDPSession(page);await cdp.send("DOM.enable");await cdp.send("CSS.enable");
    const {root}=await cdp.send("DOM.getDocument");
    const fonts=async selector=>{const {nodeId}=await cdp.send("DOM.querySelector",{nodeId:root.nodeId,selector});return(await cdp.send("CSS.getPlatformFontsForNode",{nodeId})).fonts;};
    const titleFonts=await fonts(".dashboard-title"),priceFonts=await fonts(".menu-display-row-price");
    assert(titleFonts.some(font=>/Zen.*Kaku/i.test(font.familyName)&&font.isCustomFont),JSON.stringify(titleFonts));
    assert(priceFonts.some(font=>/DM.*Sans/i.test(font.familyName)&&font.isCustomFont),JSON.stringify(priceFonts));
    results[name]={titleFonts,priceFonts};
    await page.screenshot({path:`tmp/file-menu-check/${name}-offline-4k.png`,fullPage:true});
    mode="online";await refresh(page);await page.getByText("キャッシュ更新テスト",{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector(".menu-display-row-image")?.naturalWidth>0);
    assert.equal(downloads,1);
    await refresh(page);await page.waitForResponse(response=>response.url()===config.feedUrl);assert.equal(downloads,1,"Unchanged images must be reused");
    mode="malformed";await refresh(page);await page.waitForResponse(response=>response.url()===config.feedUrl);assert.equal(await page.getByText("キャッシュ更新テスト",{exact:true}).count(),1);
    mode="image-failure";data.categories[0].menus[0].name="Incomplete update";data.categories[0].menus[0].coverImageDataUrl=`/api/menu-covers/${"f".repeat(64)}`;
    await refresh(page);await page.waitForResponse(response=>response.url().includes("/api/menu-covers/"));
    assert.equal(await page.getByText("キャッシュ更新テスト",{exact:true}).count(),1);
    data.categories[0].menus[0].name="キャッシュ更新テスト";data.categories[0].menus[0].coverImageDataUrl=`/api/menu-covers/${hash}`;
    await context.close();context=null;
    mode="offline";downloads=0;
    page=await start();await page.goto(fileUrl,{waitUntil:"load",timeout:120000});await ready(page);
    await page.getByText("キャッシュ更新テスト",{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector(".menu-display-row-image")?.naturalWidth>0);
    assert.equal(downloads,0);
    await page.setViewportSize({width:1080,height:1920});assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
    await page.setViewportSize({width:1920,height:1080});await page.waitForFunction(()=>!document.querySelector(".is-portrait"));
    assert(await page.evaluate(()=>[...document.querySelectorAll(".menu-display-category")].every(el=>el.getBoundingClientRect().bottom<=innerHeight)));
    mode="online";
    const today=new Date(Date.now()+9*3600_000).toISOString().slice(0,10);
    data.settings.lastOrders=[{date:today,closesAt:new Date(`${today}T00:00:00+09:00`).toISOString()}];
    await refresh(page);await page.locator(".menu-display-closed").waitFor();
    await page.screenshot({path:`tmp/file-menu-check/${name}-closed.png`,fullPage:true});
    data.settings.lastOrders=[];await refresh(page);await page.locator(".menu-display-closed").waitFor({state:"detached"});
    // Successful visibility changes arrive through the same public contract.
    const visible=data.categories[0].menus.shift();await refresh(page);await page.getByText("キャッシュ更新テスト",{exact:true}).waitFor({state:"detached"});
    data.categories[0].menus.unshift(visible);
    assert(requests.every(req=>req.origin==="null"&&!req.cookie));assert.deepEqual(errors,[]);
    console.log(`${name}: file:// offline first boot, exact embedded fonts, live credential-free CORS updates, cached image reuse, failed-update rollback, browser restart persistence, responsive panels and JST overlay passed.`);
  } finally { if(context)await context.close(); }
}

// Even storage-denying controllers retain the packaged offline snapshot and can update in memory.
const profile=await mkdtemp(resolve("tmp/file-menu-check/blocked-"));
const context=await chromium.launchPersistentContext(profile,{executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try{
  await context.addInitScript(()=>{
    Object.defineProperty(window,"indexedDB",{get(){throw new DOMException("Disabled","SecurityError");}});
    Storage.prototype.getItem=Storage.prototype.setItem=function(){throw new DOMException("Disabled","SecurityError");};
  });
  await context.route("https://**",route=>route.abort());
  const page=context.pages()[0];await page.goto(fileUrl,{timeout:120000});await page.locator(".menu-display-row").first().waitFor();
  assert.equal(await page.locator(".menu-display-row").count(),11);assert.equal(await page.locator("button").count(),0);
  console.log("Storage-disabled offline fallback passed.");
}finally{await context.close();}
await writeFile("tmp/file-menu-check/fonts.json",JSON.stringify(results,null,2));
