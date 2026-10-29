import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import sharp from "sharp";

async function main() {
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:1366,height:900}});
  const good=await sharp({create:{width:400,height:300,channels:3,background:"#537f60"}}).webp().toBuffer();
  const blobRequests:string[]=[], errors:string[]=[];
  const menu=(name:string,coverImageDataUrl:string)=>({id:name,name,priceJpy:500,availability:"AVAILABLE",coverImageDataUrl,allergens:[],allergenDisplayEnabled:false,customBadgeText:null,customBadgeColor:null,showLowStockBadge:false,remainingUntilCap:null});
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.hostname.endsWith(".blob.vercel-storage.com")){blobRequests.push(url.href);await route.abort();return;}
    if(!url.pathname.startsWith("/api/")){await route.continue();return;}
    if(url.pathname==="/api/menu-covers/good"){await route.fulfill({contentType:"image/webp",body:good});return;}
    if(url.pathname==="/api/menu-covers/missing"){await route.fulfill({status:404,body:""});return;}
    if(url.pathname==="/api/realtime/token"){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    let data:any={};
    if(url.pathname==="/api/auth/me")data={actor:{actorId:"menu-test",actorType:"MENU_DISPLAY",label:"Menu"},offlineActors:[]};
    if(url.pathname==="/api/menu-display")data={categories:[{id:"drinks",name:"Drinks",customBadgeText:null,customBadgeColor:null,menus:[menu("Stored image","/api/menu-covers/good"),menu("Old Blob image","https://old.public.blob.vercel-storage.com/menu.jpg"),menu("Missing image","/api/menu-covers/missing")]}],settings:{pageDisplaySeconds:120}};
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto("http://localhost:3118/menu-display",{waitUntil:"domcontentloaded",timeout:60000});
    const stored=page.locator("article").filter({hasText:"Stored image"});
    await stored.locator("img").waitFor();
    await page.waitForFunction(()=>document.querySelector<HTMLImageElement>('img[alt="Stored image の画像"]')?.naturalWidth===400);
    const legacy=page.locator("article").filter({hasText:"Old Blob image"});
    assert.equal(await legacy.locator("img").count(),0);
    await page.locator("article.no-image").filter({hasText:"Missing image"}).waitFor();
    assert.equal(await page.locator('img[alt="Missing image の画像"]').count(),0);
    assert.deepEqual(blobRequests,[]);
    await mkdir("tmp/menu-cover-images",{recursive:true});
    await page.screenshot({path:"tmp/menu-cover-images/display-desktop.png",fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:"tmp/menu-cover-images/display-mobile.png",fullPage:true});
    assert.deepEqual(errors,[]);
    console.log("Menu display browser checks passed: stored WebP renders, old Blob URLs produce no network requests, unavailable images fall back without broken icons, and no page errors.");
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
