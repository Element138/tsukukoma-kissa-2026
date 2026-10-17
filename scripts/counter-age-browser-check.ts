import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

async function main() {
  const base = Date.parse("2026-10-17T01:00:00Z");
  const makeOrder = (id: string, orderNo: number, ageSeconds: number) => ({id,orderNo,createdAt:new Date(base-ageSeconds*1000).toISOString(),fulfillmentType:"DINE_IN",specialNote:null,lastCalledAt:null,readyItems:[{id:`item-${id}`,name:"トースト"}],servedItemGroups:[],unreadyItemGroups:[]});
  let role="WAITER";
  const orders:any[]=[makeOrder("one",11,599),makeOrder("two",22,1499),makeOrder("three",33,2399)];
  const bulkPosts:any[]=[];
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const errors:string[]=[];
  await context.addInitScript(({base})=>{
    // tsx preserves class names with this helper when serializing the fixture.
    (0, eval)("globalThis.__name = value => value;");
    const state=window as unknown as {clock:number;played:string[];overlap:boolean};
    state.clock=base;state.played=[];state.overlap=false;
    try { if (!localStorage.getItem("kissa.counter-age-audio.v1:counter-test")) localStorage.setItem("kissa.counter-age-audio.v1:counter-test",JSON.stringify({two:{minutes:10,at:base},three:{minutes:25,at:base}})); } catch {}
    Date.now=()=>state.clock;
    const blobs=new Map<string,Blob>();let next=0,playing=0;
    URL.createObjectURL=blob=>{const id=`blob:check-${++next}`;blobs.set(id,blob as Blob);return id;};
    URL.revokeObjectURL=url=>{blobs.delete(url);};
    class FakeAudio {
      src="";onended:(()=>void)|null=null;onerror:(()=>void)|null=null;timer:number|null=null;active=false;
      async play(){
        if(this.src.startsWith("data:"))return;
        const blob=blobs.get(this.src);if(!blob)throw Error("missing audio blob");
        state.played.push(await blob.text());
        if(playing)state.overlap=true;playing++;this.active=true;
        this.timer=window.setTimeout(()=>{playing--;this.active=false;this.onended?.();},(window as any).audioDuration??30);
      }
      pause(){if(this.timer!==null)clearTimeout(this.timer);if(this.active){playing--;this.active=false;}}
      load(){} removeAttribute(){this.src="";}
    }
    window.Audio=FakeAudio as unknown as typeof Audio;
  },{base});
  await context.route("**/api/**",async route=>{
    const url=new URL(route.request().url());let data:unknown={};
    if(url.pathname==="/api/auth/me")data={actor:{actorId:"counter-test",actorType:role,label:"カウンター"},offlineActors:[]};
    else if(url.pathname==="/api/counter/targets")data={orders,stock:[]};
    else if(url.pathname==="/api/counter/serve-item")orders.splice(0,orders.length);
    else if(url.pathname==="/api/counter/serve-order"){bulkPosts.push(route.request().postDataJSON());orders.splice(0,orders.length);data={servedItemCount:3,partial:true};}
    else if(url.pathname==="/api/realtime/token"){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    else if(url.pathname==="/api/admin/actors")data={actors:[]};
    else if(url.pathname==="/api/admin/menus")data={menus:[],categories:[]};
    else if(url.pathname==="/api/admin/categories")data={categories:[]};
    else if(url.pathname==="/api/admin/square-payments")data={incidentCount:0};
    else if(url.pathname==="/api/admin/menu-display-settings")data={settings:{pageDisplaySeconds:20,orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:0.8}};
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  // Test sequencing/eligibility without sending speech requests or making sound.
  await context.route("**/audio/**",route=>route.fulfill({contentType:"audio/mpeg",body:new URL(route.request().url()).pathname}));
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto("http://localhost:3102/counter",{waitUntil:"domcontentloaded",timeout:60000});
    await page.locator(".counter-tile").first().waitFor();
    assert.equal(await page.locator(".counter-tile.safe").count(),1);
    assert.equal(await page.locator(".counter-tile.warn").count(),1);
    assert.equal(await page.locator(".counter-tile.danger").count(),1);
    assert.deepEqual(await page.evaluate(()=> (window as any).played),[]);
    await page.getByRole("button",{name:"音声通知を有効にする",exact:true}).click();
    await page.getByRole("button",{name:"音声通知を停止",exact:true}).waitFor();
    await page.evaluate(()=>{(window as any).clock+=1000;});
    await page.waitForFunction(()=>(window as any).played.length===9);
    const expected=[11,22,33].flatMap((n,i)=>[`/audio/counter-alerts/tone-${i+1}.mp3`,`/audio/order-call/numbers/v2/number-${n}.mp3`,`/audio/counter-alerts/elapsed-${[10,25,40][i]}.mp3`]);
    assert.deepEqual(await page.evaluate(()=>(window as any).played),expected);
    assert.equal(await page.evaluate(()=>(window as any).overlap),false);
    await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem("kissa.counter-age-audio.v1:counter-test")??"{}")).length===3);
    assert.equal(await page.locator(".counter-tile.critical").count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await mkdir("tmp/counter-alerts",{recursive:true});
    await page.screenshot({path:"tmp/counter-alerts/counter-phone.png",fullPage:true});
    await page.reload();await page.getByRole("button",{name:"音声通知を有効にする",exact:true}).click();
    await page.getByRole("button",{name:"音声通知を停止",exact:true}).waitFor();
    await page.evaluate(()=>{(window as any).clock+=1000;});
    // Give the next real UI tick time to check the persisted history.
    await page.waitForFunction(()=>document.querySelector(".counter-tile.critical"));
    assert.deepEqual(await page.evaluate(()=>(window as any).played),[]);
    orders.splice(0,orders.length,{...makeOrder("bulk",55,300),readyItems:[{id:"a1",name:"クロックムッシュ"},{id:"a2",name:"クロックムッシュ"},{id:"b1",name:"紅茶"}],unreadyItemGroups:[{name:"クロックムッシュ",count:1},{name:"紅茶",count:1},{name:"クロワッサン",count:1}],servingPlan:[{menuId:"a",name:"クロックムッシュ",waitingCount:3,servableCount:2},{menuId:"b",name:"紅茶",waitingCount:2,servableCount:1},{menuId:"c",name:"クロワッサン",waitingCount:1,servableCount:0}]});
    await page.reload();await page.getByRole("button",{name:"全て提供",exact:true}).waitFor();
    const confirmation = page.waitForEvent("dialog");
    const canceledClick=page.getByRole("button",{name:"全て提供",exact:true}).click();
    const dialog=await confirmation;
    assert.match(dialog.message(),/クロックムッシュ.*3個のうち2個/);
    assert.match(dialog.message(),/紅茶.*2個のうち1個/);
    assert.match(dialog.message(),/クロワッサン.*1個のうち0個/);
    await dialog.dismiss();await canceledClick;assert.equal(bulkPosts.length,0);
    page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"全て提供",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".counter-tile").length===0);
    assert.equal(bulkPosts[0].confirmPartial,true);assert.deepEqual(bulkPosts[0].expectedItemIds,["a1","a2","b1"]);
    orders.splice(0,orders.length,{...makeOrder("removed",44,600),servingPlan:[{menuId:"a",name:"トースト",waitingCount:1,servableCount:1}]});
    await page.reload();await page.locator(".counter-tile").first().waitFor();
    assert.equal(await page.getByRole("button",{name:"全て提供",exact:true}).count(),0);
    await page.evaluate(()=>{(window as any).audioDuration=5000;});
    await page.getByRole("button",{name:"音声通知を有効にする",exact:true}).click();
    await page.waitForFunction(()=>(window as any).played.length===1);
    await page.getByRole("button",{name:"提供",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".counter-tile").length===0);
    assert.deepEqual(await page.evaluate(()=>(window as any).played),["/audio/counter-alerts/tone-1.mp3"]);
    role="ADMIN";await page.goto("http://localhost:3102/admin",{waitUntil:"domcontentloaded",timeout:60000});
    await page.getByRole("button",{name:"新規メニューを追加",exact:true}).click();
    const label=page.getByText("メニュー表示にアレルゲン情報を表示",{exact:true});await label.waitFor();
    assert.equal(await label.locator("..").getByRole("switch").getAttribute("aria-checked"),"false");
    assert.deepEqual(errors,[]);
    const realContext=await browser.newContext();
    await realContext.route("http://localhost:3102/audio-check",route=>route.fulfill({contentType:"text/html",body:"<html><body>Audio decoder check</body></html>"}));
    const realPage=await realContext.newPage();await realPage.goto("http://localhost:3102/audio-check");
    const durations=await realPage.evaluate(async()=>Promise.all([
      ...[1,2,3].map(i=>`/audio/counter-alerts/tone-${i}.mp3`),
      ...[10,25,40].map(n=>`/audio/counter-alerts/elapsed-${n}.mp3`),
      "/audio/order-call/numbers/v2/number-177.mp3",
    ].map(src=>new Promise<number>((resolve,reject)=>{
      const audio=new Audio(src);const timer=setTimeout(()=>reject(Error(`metadata timeout ${src}`)),10000);
      audio.onloadedmetadata=()=>{clearTimeout(timer);resolve(audio.duration);};
      audio.onerror=()=>{clearTimeout(timer);reject(Error(`invalid audio ${src}`));};audio.preload="auto";audio.load();
    }))));
    assert.equal(durations.every(n=>Number.isFinite(n)&&n>0),true);await realContext.close();
    console.log("PASS: 10/25/40 colors, serialized tone/number/minutes clips, no autoplay before enabling, persistent deduplication, and allergen display off by default; no browser errors.");
  }catch(e){console.error({alerts:await page.getByRole("alert").allTextContents(),errors,played:await page.evaluate(()=>(window as any).played)});throw e;}
  finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
