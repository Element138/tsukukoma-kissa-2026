import assert from "node:assert/strict";
import { chromium } from "playwright-core";
async function main(){
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext();let completed=false,delivered=false;
  await context.addInitScript(()=>{
    (0,eval)("globalThis.__name=value=>value;");
    const state=window as any;state.played=[];state.active=0;
    class FakeAudio{
      src:string;readyState=4;currentTime=0;onended:(()=>void)|null=null;onerror=null;active=false;timer:number|undefined;
      constructor(src=""){this.src=src;} load(){}
      play(){this.active=true;state.active++;state.played.push(this.src);this.timer=window.setTimeout(()=>{this.active=false;state.active--;this.onended?.();},20000);return Promise.resolve();}
      pause(){clearTimeout(this.timer);if(this.active){this.active=false;state.active--;}}
    }
    window.Audio=FakeAudio as unknown as typeof Audio;
  });
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;let data:unknown={};
    const rows=[{id:"a",orderNo:77,createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString(),itemCount:1,readyItemCount:0,queuedItemCount:1},{id:"b",orderNo:88,createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString(),itemCount:1,readyItemCount:0,queuedItemCount:1}];
    if(path==="/api/auth/me")data={actor:{actorId:"display",actorType:"ORDER_DISPLAY",label:"注文表示"},offlineActors:[]};
    else if(path==="/api/order-display") {data={callCursor:2,readyOrders:completed?[]:rows,unreadyOrders:[],calls:completed||delivered?[]:rows.map(row=>({...row,callCount:1}))};delivered=true;}
    else if(path==="/api/admin/menu-display-settings")data={settings:{orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:0.8}};
    else if(path==="/api/realtime/token"){await route.fulfill({status:503,body:'{"ok":false}',contentType:"application/json"});return;}
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  await context.route("**/audio/**",route=>route.fulfill({contentType:"audio/mpeg",body:"mock"}));
  const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto("http://localhost:3102/order-display",{waitUntil:"domcontentloaded",timeout:60000});
    await page.locator(".order-display-callout").waitFor();
    await page.waitForFunction(()=>(window as any).active===1);
    completed=true;
    await page.locator(".order-display-callout").waitFor({state:"hidden",timeout:10000});
    assert.equal(await page.evaluate(()=>(window as any).active),0);
    assert.equal((await page.evaluate(()=>(window as any).played)).length,1);
    assert.deepEqual(errors,[]);
    console.log("PASS: completed/canceled calls clear the overlay, stop active speech, and remove queued calls.");
  }finally{await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
