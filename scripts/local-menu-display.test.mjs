import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { startMenuServer } from "../standalone/menu-display/server.mjs";

const image = await sharp({create:{width:400,height:300,channels:3,background:"#6c826d"}}).webp().toBuffer();
const hash = createHash("sha256").update(image).digest("hex");
const images = new Map([[hash, image]]);
await mkdir("tmp/local-menu-check",{recursive:true});
const root = await mkdtemp(resolve("tmp/local-menu-check/pack-"));
for (const name of ["index.html","assets","fonts","images"]) await cp(join(process.env.MENU_PACK_DIR ?? "output/Kissa-Menu-Windows",name),join(root,name),{recursive:true});
const seed = JSON.parse(await readFile("tmp/menu-display-seed.json","utf8"));
seed.data.categories[0].menus[0].coverImageDataUrl = `data:image/webp;base64,${image.toString("base64")}`;
await writeFile(join(root,"seed.json"),JSON.stringify(seed));
let data = structuredClone(seed.data), mode = "offline", imageMode = "ok", remoteImages = 0;
let etag = '"one"';
data.categories[0].menus[0].coverImageDataUrl = `/api/menu-covers/${hash}`;
const remote = createServer((req,res)=>{
  if(req.url.startsWith("/api/menu-covers/")){
    remoteImages++;
    const bytes=images.get(req.url.split("/").at(-1));
    res.writeHead(imageMode==="ok"&&bytes?200:503,{"Content-Type":"image/webp"});res.end(bytes??image);return;
  }
  if(mode==="offline"){res.writeHead(503);res.end();return;}
  if(mode==="invalid"){res.end('{"ok":true,"data":{"categories":[]}}');return;}
  if(req.headers["if-none-match"]===etag){res.writeHead(304,{ETag:etag});res.end();return;}
  res.writeHead(200,{"Content-Type":"application/json",ETag:etag});res.end(JSON.stringify({ok:true,data}));
});
await new Promise(resolve=>remote.listen(0,"127.0.0.1",resolve));
const feedUrl=`http://127.0.0.1:${remote.address().port}/feed`;
let helper;
let browser;
const start=()=>startMenuServer({root,config:{feedUrl},port:0,allowHttpFeed:true,pollMs:3600_000});
const payload=async()=>{const r=await fetch(`${helper.origin}/api/menu-display`);assert.equal(r.status,200);return(await r.json()).data;};
try{
  helper=await start();await helper.refresh();
  let shown=await payload();assert.equal(shown.categories[0].menus.length,seed.data.categories[0].menus.length);
  const localImage=shown.categories[0].menus[0].coverImageDataUrl;
  assert.equal(localImage,`/cache/images/${hash}.webp`);
  assert.deepEqual(Buffer.from(await(await fetch(helper.origin+localImage)).arrayBuffer()),image);
  const originalName=shown.categories[0].menus[0].name;
  mode="online";data.categories[0].menus[0].name="オンライン更新";data.privateActorSecret="never persist this";
  await helper.refresh();shown=await payload();assert.equal(shown.categories[0].menus[0].name,"オンライン更新");
  assert.equal(shown.privateActorSecret,undefined);assert(!(await readFile(join(root,"cache/snapshot.json"),"utf8")).includes("never persist"));
  const disk=await readFile(join(root,"cache/snapshot.json"),"utf8");
  mode="invalid";await helper.refresh();assert.equal((await payload()).categories[0].menus[0].name,"オンライン更新");assert.equal(await readFile(join(root,"cache/snapshot.json"),"utf8"),disk);
  mode="offline";await helper.refresh();assert.equal((await payload()).categories[0].menus[0].name,"オンライン更新");
  await helper.close();helper=await start();assert.equal((await payload()).categories[0].menus[0].name,"オンライン更新");
  mode="online";await helper.refresh();assert.equal(remoteImages,0,"Seeded content-addressed images should not download again");
  const newImage=await sharp({create:{width:300,height:200,channels:3,background:"#abc123"}}).webp().toBuffer();
  const newHash=createHash("sha256").update(newImage).digest("hex");
  images.set(newHash,newImage);
  data.categories[0].menus[0].coverImageDataUrl=`/api/menu-covers/${newHash}`;etag='"two"';imageMode="bad";
  await helper.refresh();assert.equal((await payload()).categories[0].menus[0].coverImageDataUrl,localImage,"Incomplete image update must not replace the last good snapshot");
  imageMode="ok";await helper.refresh();
  const updatedImage=`/cache/images/${newHash}.webp`;
  assert.equal((await payload()).categories[0].menus[0].coverImageDataUrl,updatedImage);
  const downloads=remoteImages;await helper.refresh();assert.equal(remoteImages,downloads,"304 refreshes must reuse downloaded images");
  data.categories[0].menus[0].coverImageDataUrl="https://example.invalid/private-image";etag='"three"';
  await helper.refresh();assert.equal((await payload()).categories[0].menus[0].coverImageDataUrl,updatedImage);
  for(const path of ["/config.json","/server.mjs","/seed.json","/cache/snapshot.json","/cache/status.log","/%2e%2e/server.mjs"])assert.equal((await fetch(helper.origin+path)).status,404);
  const badHost = await new Promise((resolve,reject)=>{const req=request(helper.origin,{headers:{Host:"evil.example"}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);req.end();});
  assert.equal(badHost,403);
  assert.equal((await fetch(helper.origin,{headers:{Origin:"https://evil.example"}})).status,403);
  assert.equal((await fetch(helper.origin,{method:"POST"})).status,405);
  // Restore a valid complete update for browser verification.
  data=structuredClone(seed.data);data.categories[0].menus[0].coverImageDataUrl=`/api/menu-covers/${hash}`;etag='"four"';imageMode="ok";
  await helper.refresh();
  browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:2160,height:3840},timezoneId:"America/Los_Angeles"});
  const requests=[];const errors=[];
  await context.route("**/*",async route=>{requests.push(route.request().url());if(!route.request().url().startsWith(helper.origin)){await route.abort();return;}await route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",error=>errors.push(error.message));
  await page.goto(helper.origin);await page.locator(".menu-display-row").first().waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator(".terminal-banner,button").count(),0);
  assert.equal(await page.getByRole("heading",{name:"喫茶",exact:true}).count(),1);
  await page.waitForFunction(()=>document.querySelector(".menu-display-row-image")?.naturalWidth>0);
  const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,panels:[...document.querySelectorAll(".menu-display-category")].map(el=>{const r=el.getBoundingClientRect();return{y:r.y,bottom:r.bottom};}),title:parseFloat(getComputedStyle(document.querySelector(".dashboard-title")).fontSize),ratio:document.querySelector(".menu-display-logo").getBoundingClientRect().height/document.querySelector(".menu-display-brand > div").getBoundingClientRect().height}));
  assert.equal(geometry.panels.length,2);assert(geometry.panels[1].y>geometry.panels[0].y);assert(geometry.panels.every(panel=>panel.bottom<=3840));assert(geometry.scrollHeight<=3841);assert(geometry.title>100);assert(Math.abs(geometry.ratio-2.5)<.03);
  await page.screenshot({path:"tmp/local-menu-check/portrait-4k.png",fullPage:true});
  await page.setViewportSize({width:1080,height:1920});await page.screenshot({path:"tmp/local-menu-check/portrait-1080.png",fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
  await page.setViewportSize({width:1920,height:1080});await page.waitForFunction(()=>!document.querySelector(".is-portrait"));
  await page.screenshot({path:"tmp/local-menu-check/landscape.png",fullPage:true});
  const now=new Date(),today=new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);
  data.settings.lastOrders=[{date:today,closesAt:new Date(now.getTime()-5000).toISOString()}];etag='"closed"';await helper.refresh();
  await page.locator(".menu-display-closed").waitFor();assert.equal(await page.locator(".menu-display-screen").getAttribute("inert"),"");
  await page.screenshot({path:"tmp/local-menu-check/closed.png",fullPage:true});
  data.settings.lastOrders=[];etag='"open"';await helper.refresh();await page.locator(".menu-display-closed").waitFor({state:"detached"});
  mode="offline";await helper.refresh();await page.reload();await page.locator(".menu-display-row").first().waitFor();
  assert.equal(await page.locator(".menu-display-row").count(),11);
  assert(requests.every(url=>url.startsWith(helper.origin)));assert(!requests.some(url=>url.includes("auth")||url.includes("realtime")));assert.deepEqual(errors,[]);
  await writeFile("tmp/local-menu-check/measurements.json",JSON.stringify(geometry,null,2));
  console.log("Local menu checks passed: offline first boot, image integrity/reuse, complete atomic refresh, malformed/error fallback, disk recovery after helper restart, read-only loopback restrictions, local-only browser requests, responsive layout, no login/controls, and JST closing updates via SSE.");
}finally{
  if(browser)await browser.close();
  if(helper)await helper.close();
  await new Promise(resolve=>remote.close(resolve));
}
