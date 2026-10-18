import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { counterAlertSources } from "../lib/counter-age-alerts";

async function main(){
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const base=Date.now();const createdAt=new Date(base-599000).toISOString();
  const order={id:"playback-test-258",orderNo:258,createdAt,fulfillmentType:"DINE_IN",specialNote:null,lastCalledAt:null,readyItems:[{id:"test-item",name:"音声テスト"}],servedItemGroups:[],unreadyItemGroups:[],servingPlan:[]};
  await context.addInitScript(({base})=>{
    (0,eval)("globalThis.__name=value=>value");
    const state=window as any;state.clock=base;state.played=[];state.ended=[];
    Date.now=()=>state.clock;
    const blobPaths=new WeakMap<Blob,string>(),urlPaths=new Map<string,string>();
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=async(...args)=>{const response=await fetchOriginal(...args);const originalBlob=response.blob.bind(response);response.blob=async()=>{const blob=await originalBlob();blobPaths.set(blob,new URL(response.url).pathname);return blob;};return response;};
    const createOriginal=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=createOriginal(blob);if(blob instanceof Blob)urlPaths.set(url,blobPaths.get(blob)??"");return url;};
    const playOriginal=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){const path=urlPaths.get(this.src);if(path){state.played.push(path);this.addEventListener("ended",()=>state.ended.push(path),{once:true});}return playOriginal.call(this);};
  },{base});
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==="/api/realtime/token"){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    const data=path==="/api/auth/me"?{actor:{actorId:"audio-test",actorType:"WAITER",label:"音声テスト"},offlineActors:[]}:path==="/api/counter/targets"?{orders:[order],stock:[]}:{};
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto("http://localhost:3102/counter",{waitUntil:"domcontentloaded",timeout:60000});
    await page.getByRole("button",{name:"音声通知を有効にする",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
    let count=0;const expected:string[]=[];
    await page.evaluate(({base})=>{(window as any).clock=base+1000;document.dispatchEvent(new Event("visibilitychange"));},{base});
    await page.waitForFunction(()=>document.querySelector(".counter-tile.warn"));
    assert.deepEqual(await page.evaluate(()=>(window as any).played),[]);
    for(const minutes of [25,40] as const){
      await page.evaluate(({base,minutes})=>{(window as any).clock=base+(minutes*60-599)*1000;document.dispatchEvent(new Event("visibilitychange"));},{base,minutes});
      count+=3;expected.push(...counterAlertSources({...order,minutes}));
      await page.waitForFunction(count=>(window as any).ended.length===count,count,{timeout:30000});
      assert.deepEqual(await page.evaluate(()=>(window as any).played),expected);
    }
    assert.deepEqual(errors,[]);await mkdir("tmp/counter-samples",{recursive:true});await page.screenshot({path:"tmp/counter-samples/counter-258.png",fullPage:true});
    console.log("PASS: order #258 stays silent at 10 minutes and plays real tone → cached number → 注文からX分経過 at 25/40; no live order changed.");
  }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
