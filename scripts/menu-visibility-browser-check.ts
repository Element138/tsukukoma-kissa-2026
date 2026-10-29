import assert from "node:assert/strict";
import { chromium } from "playwright-core";

async function main(){
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const category={id:"category",name:"フード",displayOrder:0,isActive:true,customBadgeText:null,customBadgeColor:null};
  const menu={id:"menu",name:"トースト",shortName:null,priceJpy:200,availability:"PAUSED",workloadSeconds:1,displayOrder:0,categoryId:"category",assignedKitchenId:null,isActive:true,hasActiveKitchenCoverage:false,coverImageDataUrl:null,allergensJson:[],allergenDisplayEnabled:false,showOnMenuDisplay:true,customBadgeText:null,customBadgeColor:null,dailyOrderCap:null,lowStockBadgeEnabled:false,lowStockBadgeThreshold:0,todayOrderCount:0,remainingUntilCap:null,isCapReached:false};
  const patches:unknown[]=[];const errors:string[]=[];
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;let data:unknown={};
    if(path==="/api/auth/me")data={actor:{actorId:"admin",actorType:"ADMIN",label:"Admin"},offlineActors:[]};
    else if(path==="/api/admin/menus"){
      if(route.request().method()==="PATCH"){const body=route.request().postDataJSON();patches.push(body);menu.showOnMenuDisplay=body.showOnMenuDisplay;}
      data={menus:[menu],categories:[category]};
    }else if(path==="/api/admin/categories")data={categories:[category]};
    else if(path==="/api/admin/actors")data={actors:[]};
    else if(path==="/api/admin/menu-last-orders")data={today:"2026-10-29",entries:[]};
    else if(path==="/api/admin/menu-display-settings")data={settings:{pageDisplaySeconds:18,orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:.8}};
    else if(path==="/api/admin/square-payments")data={incidents:[],incidentCount:0};
    else if(path==="/api/realtime/token"){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto("http://localhost:3120/admin",{waitUntil:"domcontentloaded",timeout:120000});
    await page.getByRole("button").filter({hasText:"トースト"}).first().click();
    const toggle=page.getByRole("switch",{name:"トーストをメニュー表示に掲載",exact:true});
    await toggle.waitFor();assert.equal(await toggle.getAttribute("aria-checked"),"true");
    await toggle.click();await page.waitForFunction(()=>document.querySelector('[aria-label="トーストをメニュー表示に掲載"]')?.getAttribute("aria-checked")==="false");
    await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[aria-label="トーストをメニュー表示に掲載"]')?.disabled);
    await toggle.click();await page.waitForFunction(()=>document.querySelector('[aria-label="トーストをメニュー表示に掲載"]')?.getAttribute("aria-checked")==="true");
    assert.deepEqual(patches,[{id:"menu",showOnMenuDisplay:false},{id:"menu",showOnMenuDisplay:true}]);
    await toggle.locator("..").locator("..").screenshot({path:"tmp/local-menu-check/admin-visibility.png"});
    assert.deepEqual(errors,[]);console.log("Admin visibility browser checks passed: default-on switch saves immediately, reloads its state and restores visibility without editing other menu fields.");
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
