import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const path=resolve("output/Kissa-Menu-HTML-Title-Time/Menu.html");
const source=await readFile(path,"utf8");
const config=JSON.parse(/<script id="menu-config" type="application\/json">([\s\S]*?)<\/script>/.exec(source)[1]);
await mkdir("tmp/html-labels",{recursive:true});
const profile=await mkdtemp(resolve("tmp/html-labels/profile-"));
let online=false, context;const requests=[],errors=[];
async function start(){
  context=await chromium.launchPersistentContext(profile,{executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,viewport:{width:2160,height:3840},timezoneId:"America/Los_Angeles"});
  await context.route("**/*",async route=>{
    if(new URL(route.request().url()).protocol!=="https:"){await route.continue();return;}
    requests.push({url:route.request().url(),online});
    if(!online){await route.abort();return;}
    await route.fulfill({headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"Date",Date:new Date().toUTCString()},body:JSON.stringify({ok:true,data:config.seed.data})});
  });
  const page=context.pages()[0];page.on("pageerror",error=>errors.push(error.message));await page.goto(pathToFileURL(path).href,{timeout:120000});
  await page.getByRole("heading",{name:"喫茶「翡翠」",exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);return page;
}
try{
  let page=await start();assert.equal(await page.title(),"喫茶「翡翠」");assert.equal(await page.locator(".file-menu-last-retrieved").count(),0);
  online=true;await page.evaluate(()=>window.dispatchEvent(new Event("online")));await page.locator(".file-menu-last-retrieved").waitFor();
  const timestamp=page.locator(".file-menu-last-retrieved"),saved=await timestamp.getAttribute("datetime");
  const expected=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date(saved));
  assert.equal(await timestamp.innerText(),`最終取得 ${expected} JST`);
  assert(await timestamp.evaluate(el=>{const r=el.getBoundingClientRect(),css=getComputedStyle(el);return r.right>=innerWidth-20&&r.top<=12&&parseFloat(css.fontSize)<=14&&css.color==="rgb(148, 163, 184)";}));
  await page.screenshot({path:"tmp/html-labels/portrait-4k.png",fullPage:true});
  online=false;const failed=page.waitForRequest(request=>request.url()===config.feedUrl);await page.evaluate(()=>window.dispatchEvent(new Event("online")));await failed;
  assert.equal(await timestamp.getAttribute("datetime"),saved);
  await context.close();context=null;page=await start();await page.locator(".file-menu-last-retrieved").waitFor();assert.equal(await page.locator(".file-menu-last-retrieved").getAttribute("datetime"),saved);
  for(const [width,height]of [[1080,1920],[1920,1080]]){
    await page.setViewportSize({width,height});await page.waitForFunction(portrait=>Boolean(document.querySelector(".is-portrait"))===portrait,width<height);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll(".menu-display-category")].every(el=>el.getBoundingClientRect().bottom<=innerHeight)));
  }
  console.log("HTML title/timestamp checks passed: branded title, no fabricated seed timestamp, tiny gray top-right JST retrieval time, failure preservation, cached timestamp after browser restart and responsive fit.");
}catch(error){console.error({requests,errors});throw error;}finally{if(context)await context.close();}
