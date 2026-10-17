import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

async function main(){
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const at="2026-10-17T02:00:00.000Z";
  let order:any={id:"test",orderNo:255,createdAt:at,confirmedAt:at,canceledAt:null,fulfillmentType:"DINE_IN",tableNo:null,partySize:1,ageGroupCounts:{},specialNote:"手動完了",excludeFromWaitStats:false,lastMutationVersion:2,paymentStatus:"PAID",paymentMethod:"CASH",orderStatus:"COMPLETED",totalPriceJpy:500,events:[],eventActors:{},createdBy:{id:"pos",label:"POS"},items:[],auditLogs:[],paymentIncidents:[]};
  const saved:any[]=[];const hours:string[]=[];const errors:string[]=[];
  let role="ADMIN";
  await context.route("**/api/**",async route=>{
    const url=new URL(route.request().url());let data:any={};
    if(url.pathname==="/api/auth/me")data={actor:{actorId:"staff",actorType:role,label:role},offlineActors:[]};
    else if(url.pathname==="/api/sales/orders/test"){
      if(route.request().method()==="PATCH"){const body=route.request().postDataJSON();saved.push(body);order={...order,...body,lastMutationVersion:order.lastMutationVersion+1};}
      data={order};
    }
    else if(url.pathname==="/api/sales"){
      hours.push(url.searchParams.get("businessHoursOnly")??"");
      const chartStart=hours.at(-1)==="false"?"2026-10-16T15:00:00Z":at;
      const chartEnd=hours.at(-1)==="false"?"2026-10-17T15:00:00Z":"2026-10-17T03:00:00Z";
      data={date:"2026-10-17",timezone:"Asia/Tokyo",range:{start:at,end:chartEnd,chartStart,chartEnd},chartRange:{chartStart,chartEnd},totals:{orderCount:1,itemCount:1,salesJpy:500,failedOrCanceledCount:0,unconfirmedCount:0},menus:[],salesEvents:[{at,orderId:"test",orderNo:255,menuId:null,itemId:null,menuName:null}],wait:{summaries:[{key:"order:complete",label:"注文（提供完了）",sampleSize:0,p50Seconds:null,maxSeconds:null,lateRatio:null,severeLateRatio:null}],points:[],yMaxMinutes:10},incidents:[]};
    }
    else if(url.pathname==="/api/order-book")data={orders:[order],menuCounts:[],menuTotals:{ordered:1,queued:1,totalSoldPriceJpy:500},incidents:[]};
    else if(url.pathname==="/api/orders/test/manual-close"){
      saved.push(route.request().postDataJSON());order={...order,orderStatus:"COMPLETED",specialNote:"手動完了",lastMutationVersion:order.lastMutationVersion+1,items:order.items.map((item:any)=>({...item,status:"SERVED"}))};data={order};
    }
    else if(url.pathname==="/api/admin/actors")data={actors:[]};
    else if(url.pathname==="/api/admin/menus")data={menus:[],categories:[]};
    else if(url.pathname==="/api/admin/categories")data={categories:[]};
    else if(url.pathname==="/api/admin/square-payments")data={incidentCount:0,incidents:[]};
    else if(url.pathname==="/api/admin/menu-display-settings")data={settings:{pageDisplaySeconds:20,orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:0.8}};
    else if(url.pathname==="/api/realtime/token"){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto("http://localhost:3102/sales?date=2026-10-17&order=test",{waitUntil:"domcontentloaded",timeout:60000});
    await page.getByRole("heading",{name:"注文 #255",exact:true}).waitFor();
    assert.equal(await page.locator(".sales-kicker").count(),0);
    assert.equal(await page.getByRole("checkbox",{name:"営業時間のみ表示"}).isChecked(),true);
    const hoursResponse=page.waitForResponse(response=>response.url().includes("/api/sales?")&&response.url().includes("businessHoursOnly=false"));
    await page.getByRole("checkbox",{name:"営業時間のみ表示"}).uncheck();
    await hoursResponse;
    await page.getByLabel("備考",{exact:true}).fill("edited after completion");
    await page.getByRole("checkbox",{name:"待ち時間統計から除外する"}).check();
    assert.equal(saved.length,0);
    page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("button",{name:"閉じる",exact:true}).click();
    assert.equal(await page.getByLabel("備考",{exact:true}).inputValue(),"edited after completion");
    await page.getByRole("button",{name:"すべて保存",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>(".sales-order-drawer .order-call-btn")?.disabled);
    assert.equal(saved[0].excludeFromWaitStats,true);assert.equal(saved[0].specialNote,"edited after completion");
    await mkdir("tmp/order-corrections",{recursive:true});await page.screenshot({path:"tmp/order-corrections/sales-desktop.png",fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:"tmp/order-corrections/sales-phone.png",fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("body *")].map(element=>({tag:element.tagName,cls:element.className,right:element.getBoundingClientRect().right,width:element.getBoundingClientRect().width})).filter(row=>row.right>innerWidth+1).slice(0,15))));
    for(role of ["POS","KITCHEN","WAITER","ADMIN"]){
      order={...order,orderStatus:"PREPARING",specialNote:"",items:[{id:"item",menuId:"m",name:"Coffee",unitPriceJpy:500,status:"QUEUED",kitchenId:null}],lastMutationVersion:4};
      await page.goto("http://localhost:3102/order-book",{waitUntil:"domcontentloaded",timeout:60000});
      const before: number=saved.length;
      page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("button",{name:"手動完了",exact:true}).click();assert.equal(saved.length,before);
      page.once("dialog",dialog=>{assert.match(dialog.message(),/手動完了として記録/);void dialog.accept();});await page.getByRole("button",{name:"手動完了",exact:true}).click();
      await page.getByText("備考: 手動完了",{exact:true}).waitFor();
      assert.equal(saved.length,before+1);assert.deepEqual(saved.at(-1),{expectedVersion:4,confirm:true});
      assert.equal(await page.getByRole("button",{name:"手動完了",exact:true}).count(),0);
    }
    order={...order,confirmedAt:null,paymentStatus:"AWAITING",orderStatus:"PENDING"};
    await page.reload();await page.getByRole("button",{name:"レシート再印刷",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"手動完了",exact:true}).count(),0);
    await page.goto("http://localhost:3102/admin",{waitUntil:"domcontentloaded",timeout:60000});await page.getByRole("button",{name:"新規メニューを追加",exact:true}).waitFor();
    assert.equal(await page.getByRole("heading",{name:"注文の管理",exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log("PASS: saved inspection controls and hours toggle; all four staff roles can close from order book after confirmation; canceled confirmations send no request; unresolved/completed orders have no closure button; redundant admin card removed; no browser errors.");
  }catch(error){console.error({errors,alerts:await page.getByRole("alert").allTextContents(),saved,layout:await page.evaluate(()=>[...document.querySelectorAll('.sales-chart-wrap,.sales-shell,.sales-workspace,.sales-wait-layout')].map(element=>({class:element.className,width:element.getBoundingClientRect().width,overflow:getComputedStyle(element).overflowX,columns:getComputedStyle(element).gridTemplateColumns}))) });throw error;}
  finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
