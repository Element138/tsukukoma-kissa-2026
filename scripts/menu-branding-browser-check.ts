import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 2160, height: 3840 }, timezoneId: "America/Los_Angeles" });
  let role = "MENU_DISPLAY";
  let serverNow = "2026-10-29T07:59:58Z";
  let lastOrders: Array<{date:string;closesAt:string}> = [];
  let entries: Array<{date:string;time:string;closesAt:string}> = [];
  const changes: Array<{method:string;body:any}> = [];
  const errors: string[] = [];
  const menu = (id:string, enabled:boolean, allergens:string[]) => ({ id, name: `メニュー ${id}`, priceJpy: 200, availability: id === "blank" ? "INCREASED_WAIT" : "AVAILABLE", coverImageDataUrl: null, allergenDisplayEnabled: enabled, allergens, customBadgeText: null, showLowStockBadge: false });
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = {};
    if (path === "/api/auth/me") data = { actor: { actorId: "review", actorType: role, label: role }, offlineActors: [] };
    else if (path === "/api/menu-display") data = { serverNow, settings: { pageDisplaySeconds: 18, lastOrders }, categories: [
      { id:"food", name:"フード・スイーツ", menus:[menu("blank", true, []), menu("disabled",false,[]), menu("allergens",true,["MILK"])] },
      { id:"drinks", name:"ドリンク", menus:[menu("coffee",true,[])] },
    ] };
    else if (path === "/api/admin/menu-last-orders") {
      const method = route.request().method();
      if (method !== "GET") {
        const body = route.request().postDataJSON(); changes.push({method,body});
        entries = entries.filter(entry=>entry.date!==body.date);
        if (method === "PUT") entries.push({...body,closesAt:new Date(`${body.date}T${body.time}:00+09:00`).toISOString()});
      }
      data = { today:"2026-10-29",entries };
    }
    else if (path === "/api/admin/actors") data = {actors:[]};
    else if (path === "/api/admin/menus") data = {menus:[],categories:[]};
    else if (path === "/api/admin/categories") data = {categories:[]};
    else if (path === "/api/admin/menu-display-settings") data = {settings:{pageDisplaySeconds:18,orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:.8}};
    else if (path === "/api/admin/square-payments") data = {incidentCount:0,incidents:[]};
    else if (path === "/api/order-book") data = { orders:[{id:"cancel-test",orderNo:255,createdAt:serverNow,confirmedAt:serverNow,fulfillmentType:"TAKEOUT",ageGroupCounts:{},totalPriceJpy:200,paymentMethod:"CASH",paymentStatus:"PAID",orderStatus:"PREPARING",lastMutationVersion:0,items:[{id:"queued",name:"Coffee",status:"QUEUED",unitPriceJpy:200}],cashierPhotoStatus:"WAIVED"}],menuCounts:[],menuTotals:{ordered:1,queued:1,totalSoldPriceJpy:200},incidents:[] };
    else if (path === "/api/realtime/token") { await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return; }
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  const page = await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",error=>errors.push(error.message));
  const go = async (path="/menu-display") => { await page.goto(`http://localhost:3120${path}`,{waitUntil:"domcontentloaded",timeout:120000}); };
  try {
    await mkdir("tmp/menu-branding",{recursive:true});
    await go();await page.getByRole("heading",{name:"喫茶",exact:true}).waitFor();
    await page.getByText("正門入ってすぐ右",{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector<HTMLImageElement>(".menu-display-logo")?.naturalWidth!>0);
    assert.equal(await page.getByRole("heading",{name:"メニュー",exact:true}).count(),0);
    const blank=page.locator(".menu-display-row").filter({hasText:"メニュー blank"});
    assert.equal(await blank.locator(".menu-display-row-allergen").count(),0);
    await blank.getByText("待ち時間が長くなっております",{exact:true}).waitFor();
    await page.getByText("アレルゲン情報なし",{exact:true}).waitFor();
    assert.equal(await page.getByText("特定原材料なし",{exact:true}).count(),0);
    await page.screenshot({path:"tmp/menu-branding/portrait-4k.png",fullPage:true});
    lastOrders=[{date:"2026-10-29",closesAt:"2026-10-29T08:00:00Z"}];
    await go();await page.getByRole("status").filter({hasText:"喫茶はラストオーダー時刻を過ぎました"}).waitFor({timeout:6000});
    assert.deepEqual(await page.locator(".menu-display-closed").evaluate(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),[0,0,2160,3840]);
    assert.equal(await page.locator(".menu-display-screen").getAttribute("inert"),"");
    assert.equal(await page.evaluate(()=>document.elementFromPoint(5,5)?.className),"menu-display-closed");
    await page.screenshot({path:"tmp/menu-branding/closed-4k.png",fullPage:true});
    serverNow="2026-10-29T14:59:58Z";
    await go();await page.locator(".menu-display-closed").waitFor();
    await page.locator(".menu-display-closed").waitFor({state:"detached",timeout:6000});
    lastOrders=[];await go();await page.getByRole("button",{name:"全画面表示",exact:true}).click();
    await page.waitForFunction(()=>Boolean(document.fullscreenElement));
    serverNow="2026-10-29T07:59:58Z";lastOrders=[{date:"2026-10-29",closesAt:"2026-10-29T08:00:00Z"}];
    // Focus resync updates the schedule without a page reload or leaving fullscreen.
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await page.locator(".menu-display-closed").waitFor({timeout:6000});
    assert.equal(await page.evaluate(()=>Boolean(document.fullscreenElement)),true);
    await page.screenshot({path:"tmp/menu-branding/closed-fullscreen.png",fullPage:true});
    await page.evaluate(()=>document.exitFullscreen());
    lastOrders=[];
    // Unmount the MENU_DISPLAY session poller before changing the mocked actor.
    await page.goto("about:blank");
    role="ADMIN";await page.setViewportSize({width:1440,height:1000});await go("/admin");
    await page.getByRole("heading",{name:"ラストオーダー時刻",exact:true}).waitFor();
    const date=page.getByLabel("日付（JST）",{exact:true}),time=page.getByLabel("時刻",{exact:true});
    await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('input[type="date"][min="2026-10-29"]')?.disabled===false);
    assert.equal(await date.getAttribute("min"),"2026-10-29");
    await date.fill("2026-11-01");await time.fill("16:30");
    const card=page.locator(".rounded-lg").filter({has:page.getByRole("heading",{name:"ラストオーダー時刻",exact:true})}).last();
    await card.getByRole("button",{name:"保存",exact:true}).click();
    await card.getByText("2026/11/01　16:30",{exact:true}).waitFor();
    await card.getByRole("button",{name:"編集",exact:true}).click();await time.fill("17:00");await card.getByRole("button",{name:"保存",exact:true}).click();
    await card.getByText("2026/11/01　17:00",{exact:true}).waitFor();
    await card.screenshot({path:"tmp/menu-branding/admin-settings.png"});
    page.once("dialog",dialog=>dialog.accept());await card.getByRole("button",{name:"削除",exact:true}).click();
    await card.getByText("2026/11/01　17:00",{exact:true}).waitFor({state:"detached"});
    assert.deepEqual(changes.map(change=>change.method),["PUT","PUT","DELETE"]);
    await go("/order-book");const cancel=page.getByRole("button",{name:"現金注文を取り消す",exact:true});await cancel.waitFor();
    const isRed=async(locator:typeof cancel)=>locator.evaluate(el=>{const [r,g,b]=getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);return r>g*2&&r>b*2;});
    assert(await isRed(cancel));await cancel.click();assert(await isRed(page.getByRole("button",{name:"注文と現金会計を取り消す",exact:true})));
    await page.screenshot({path:"tmp/menu-branding/red-cancel.png",fullPage:true});
    assert.deepEqual(errors,[]);
    console.log("Browser checks passed: branding/wording, server JST closing despite device timezone/date, fullscreen cover, midnight reopen, admin date CRUD, and red cancellation controls. No real order canceled.");
  } catch(error) { await page.screenshot({path:"tmp/menu-branding/failure.png",fullPage:true});console.error(errors);throw error; }
  finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
