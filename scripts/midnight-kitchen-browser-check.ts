import assert from "node:assert/strict";
import { chromium } from "playwright-core";

async function main(){
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const page=await browser.newPage({viewport:{width:1024,height:800}});let offline=false;
  await page.clock.install({time:new Date("2026-10-17T14:59:50Z")});
  await page.clock.pauseAt(new Date("2026-10-17T14:59:59Z"));
  const menus=[0,3].map((count,index)=>({menuId:`m${index}`,menuName:index?"待ち注文あり":"待ち注文なし",availability:"AVAILABLE",hasActiveKitchenCoverage:true,queuedCount:0,surplusCount:8,todayCookedCount:8,oldestQueuedSeconds:0,oldestElapsed:"0:00",queuedOrders:Array.from({length:count},(_,i)=>({itemId:`i${i}`,orderNo:258,confirmedAt:null,queuedSeconds:0,elapsed:"0:00"})),todayOrderCount:count,remainingUntilCap:null,dailyOrderCap:null,isCapReached:false}));
  await page.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==="/api/realtime/token" || (offline&&path==="/api/kitchen/queue")){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    const actor={id:"k",actorType:"KITCHEN",label:"Kitchen",isActive:true,kitchenEnabled:true,kitchenDisplayOrder:0};
    const data=path==="/api/auth/me"?{actor:{actorId:"k",actorType:"KITCHEN",label:"Kitchen"},offlineActors:[]}:path==="/api/admin/actors"?{actors:[actor]}:path==="/api/kitchen/queue"?{menus}:{};
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  try{
    await page.goto("http://localhost:3102/kitchen",{waitUntil:"domcontentloaded",timeout:60000});
    await page.locator(".kitchen-menu-tile").first().waitFor();assert.equal(await page.getByText("個余剰",{exact:true}).count(),2);
    offline=true;await page.clock.runFor(2000);
    await page.getByText("個調理待ち",{exact:true}).first().waitFor();
    assert.equal(await page.getByText("個余剰",{exact:true}).count(),0);
    const counts=await page.locator(".kitchen-queued-big").allTextContents();assert.deepEqual(counts.sort(),["0","3"]);
    console.log("PASS: at JST midnight old surplus immediately becomes 0/3 waiting, even when refresh fails.");
  }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
