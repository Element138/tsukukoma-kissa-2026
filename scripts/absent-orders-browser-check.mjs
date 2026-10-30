import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

await mkdir("tmp/absent-order-check", { recursive: true });
const stub = `const session={actor:{actorId:'test-counter',actorType:'WAITER',label:'Preview'},offlineActors:[]};
 export const useSession=()=>({loading:false,session});export const useWakeLock=()=>{};export const useRealtimeSubscription=()=>{};
 export const useMidnightRefresh=()=>{};export const useCounterAgeAudio=()=>({enabled:true,starting:false,error:'',speaking:'',enable:async()=>{}});
 export const useToast=()=>({notify:()=>{}});export const TerminalBanner=()=>null;`;
const bundle = await build({
  stdin: { contents: `import {createRoot} from 'react-dom/client';import Counter from './app/counter/page';import Display from './app/order-display/page';createRoot(document.getElementById('root')).render(location.hash==='#display'?<Display/>:<Counter/>);`, loader:"tsx",resolveDir:process.cwd() },
  bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},
  plugins:[{name:"isolated-browser-session",setup(build){build.onResolve({filter:/^@\/components\/(use-session|use-wake-lock|use-realtime-subscription|use-midnight-refresh|use-counter-age-audio|toast|terminal-banner)$/},()=>({path:"test-hooks",namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:stub,loader:"js"}));}}],
});
const css=await readFile("app/globals.css","utf8");
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script","<\\/script")}</script></html>`;
const fixture={id:"absent",orderNo:208,createdAt:new Date().toISOString(),fulfillmentType:"DINE_IN",specialNote:null,lastCalledAt:null,ghostedAt:null,readyItems:[{id:"one",name:"ホットドッグ"},{id:"two",name:"ホットドッグ"}],servedItemGroups:[],unreadyItemGroups:[{name:"紅茶",count:1}],servingPlan:[{menuId:"food",name:"ホットドッグ",waitingCount:2,servableCount:2},{menuId:"tea",name:"紅茶",waitingCount:1,servableCount:0}]};
let absent=false;const actions=[];
const server=createServer(async(req,res)=>{
  if(!req.url.startsWith("/api/")){res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);return;}
  let data;
  if(req.url==="/api/counter/targets")data={orders:absent?[]:[fixture],ghostOrders:absent?[{...fixture,ghostedAt:new Date().toISOString()}]:[],stock:[]};
  else if(req.url==="/api/counter/absent"){let raw="";for await(const chunk of req)raw+=chunk;actions.push(JSON.parse(raw));absent=true;data={};}
  else if(req.url.startsWith("/api/order-display"))data={callCursor:1,calls:[],readyOrders:[{id:"ready",orderNo:207,createdAt:fixture.createdAt}],unreadyOrders:[{id:"waiting",orderNo:209,createdAt:fixture.createdAt,queuedItemCount:1}],ghostOrders:absent?[fixture]:[]};
  else if(req.url==="/api/admin/menu-display-settings")data={settings:{orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:0}};
  else {res.writeHead(404);res.end();return;}
  res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:true,data}));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try{
  const page=await browser.newPage({viewport:{width:1133,height:744}});const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",dialog=>dialog.accept());
  await page.goto(origin);await page.getByRole("button",{name:"不在",exact:true}).waitFor();
  await page.getByRole("button",{name:"不在",exact:true}).click();
  await page.getByRole("button",{name:"不在注文 (1)",exact:true}).waitFor();
  assert.equal(await page.locator(".counter-tile").count(),0);assert.equal(actions.length,1);assert.equal(actions[0].orderId,"absent");
  await page.getByRole("button",{name:"不在注文 (1)",exact:true}).click();
  await page.locator(".counter-tile").waitFor();assert.equal(await page.getByRole("button",{name:/呼び出/}).count(),0);
  assert.equal(await page.getByRole("button",{name:"提供",exact:true}).count(),2);assert(await page.getByRole("button",{name:"全て提供",exact:true}).isVisible());
  await page.screenshot({path:"tmp/absent-order-check/counter-ipad.png"});
  const ghostButton=await page.getByRole("button",{name:"通常注文",exact:true}).boundingBox(),heading=await page.getByRole("heading",{name:"不在注文",exact:true}).boundingBox();assert(ghostButton.x<heading.x);
  await page.goto(`${origin}/display#display`);await page.getByRole("region",{name:"ご不在",exact:true}).waitFor();
  for(const [width,height]of [[1920,1080],[2160,3840],[1133,744]]){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(1500); // Let the existing panel transitions settle before measuring.
    const absentBox=await page.locator(".order-display-absent").boundingBox(),waiting=await page.locator(".order-display-unready-viewport").boundingBox();
    assert(absentBox.y>=waiting.y+waiting.height-2);assert(absentBox.height<height*.3);
    assert(absentBox.x>=0&&absentBox.x+absentBox.width<=width+1);
    assert.equal(await page.locator(".order-display-absent-numbers").innerText(),"208");
    assert(!(await page.locator(".order-display-unready-grid").innerText()).includes("208"));
    await page.screenshot({path:`tmp/absent-order-check/display-${width}.png`});
  }
  assert.deepEqual(errors,[]);console.log("Absent order browser checks passed: counter transition, separate list, no call controls, retained item/bulk service and compact customer panel below waiting orders at landscape, portrait 4K and iPad sizes.");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
