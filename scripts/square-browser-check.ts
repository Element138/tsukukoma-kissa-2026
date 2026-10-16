import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

async function main() {
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
await mkdir("tmp/square-browser", { recursive: true });
const errors: string[] = [], posts: Array<Record<string, unknown>> = [];
let role = "ADMIN", paid = false, recoverRequest = false, incidentCount = 0;
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", isMobile: true, hasTouch: true });
await context.route("**/api/**", async route => {
  const req = route.request(), url = new URL(req.url());
  let data: unknown = {};
  if (url.pathname === "/api/auth/me") data = { actor: { actorId: role === "ADMIN" ? "admin" : "pos1", actorType: role, label: "確認用端末" }, offlineActors: [] };
  else if (url.pathname === "/api/admin/menus") data = { menus: [], categories: [] };
  else if (url.pathname === "/api/admin/actors") data = { actors: [] };
  else if (url.pathname === "/api/admin/categories") data = { categories: [] };
  else if (url.pathname === "/api/order-book") data = {orders:[],menuCounts:[],incidents:[{id:"incident1",orderId:"order1",orderNo:7,responsiblePosActorId:"pos1",messageJa:"決済結果の照合が必要です",createdAt:"2026-10-16T01:05:30Z"}],menuTotals:{ordered:0,queued:0,totalSoldPriceJpy:0}};
  else if (url.pathname === "/api/admin/menu-display-settings") data = { settings: {pageDisplaySeconds:20,orderDisplayMarqueeText:"",orderDisplayMarqueeSpeedSeconds:24,orderCallVolume:0.8} };
  else if (url.pathname === "/api/admin/square-payments") {
    if (req.method() === "POST") { const body=req.postDataJSON(); posts.push(body); data = { verified: true, paymentFound: body.action === "NO_CHARGE" }; }
    else if (url.searchParams.has("summary")) data = { incidentCount };
    else data = { orders: [{ id: "order1", orderNo: 7, totalPriceJpy: 420, createdAt: "2026-10-16T01:00:00Z", createdByActorId: "pos1",
      squareAttempt: { launchedAt: "2026-10-16T01:00:10Z", transactionId: null, verifyAttempts: 3, lastError: "Squareとの通信に失敗しました。再決済しないでください。" } }] };
  } else if (url.pathname === "/api/payment-watchdog/ping") {
    data = { incidents: [], awaitingOrder: paid || recoverRequest ? null : { id: "order1", orderNo: 7, createdAt: "2026-10-16T01:00:00Z",
      paymentAwaitDeadlineAt: null, launchAvailable: false, lastError: "入金の照合が必要です", verificationPending: false },
      trackedOrder: paid ? { id: "order1", orderNo: 7, paymentStatus: "PAID", orderStatus: "IN_PROGRESS", paymentMethod: "SQUARE" } : null };
  } else if (url.pathname === "/api/realtime/token") {
    await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{message:"mock realtime disabled"}})});return;
  } else if (url.pathname === "/api/orders" && req.method() === "POST") {
    posts.push(req.postDataJSON()); data = { order: { id: "order1", orderNo: 7, paymentMethod: "SQUARE", paymentStatus: "AWAITING" } };
  }
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
});
const page = await context.newPage();page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://localhost:3100/admin", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("heading",{name:"管理者パネル",exact:true}).waitFor({state:"attached"});
  assert.equal(await page.getByText("Square決済の確認が必要です",{exact:true}).count(),0);
  assert.equal(await page.getByRole("banner").getByRole("link",{name:"オーダーブック",exact:true}).count(),1);
  await page.goto("http://localhost:3100/order-book",{waitUntil:"domcontentloaded",timeout:60000});
  await page.getByRole("heading",{name:"オーダーブック",exact:true}).waitFor({state:"attached"});
  assert.equal(await page.getByRole("banner").getByRole("link",{name:"オーダーブック",exact:true}).count(),0);
  await page.getByText("決済結果の照合が必要です",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"確認済みにする",exact:true}).count(),0);
  // APIRequestContext bypasses the page mocks and checks the real retired endpoint.
  const dismissed = await context.request.post("http://localhost:3100/api/order-book/incidents/incident1/dismiss");
  assert.equal(dismissed.status(),410);
  assert.equal((await dismissed.json()).error.code,"PAYMENT_INCIDENT_DISMISSAL_REMOVED");
  await page.goto("http://localhost:3100/admin",{waitUntil:"domcontentloaded",timeout:60000});
  await page.getByRole("heading",{name:"管理者パネル",exact:true}).waitFor({state:"attached"});
  assert.equal(await page.getByRole("button",{name:"Square決済の照合",exact:true}).count(),0);
  incidentCount=1;await page.reload();await page.getByText("Square決済の確認が必要です",{exact:true}).waitFor();
  await page.screenshot({path:"tmp/square-browser/admin-banner.png",fullPage:true});
  incidentCount=0;await page.reload();await page.getByRole("heading",{name:"管理者パネル",exact:true}).waitFor({state:"attached"});
  assert.equal(await page.getByText("Square決済の確認が必要です",{exact:true}).count(),0);
  await page.goto("http://localhost:3100/admin/square-payments", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("heading", {name:/注文 #7/}).waitFor();
  assert.ok((await page.getByRole("heading",{name:"Square決済の照合",exact:true}).boundingBox())!.height < 100, "mobile title must not collapse into a vertical column");
  const verify = page.getByRole("button", {name:"支払い状況を再確認"});
  assert.equal(await verify.isDisabled(), true);
  await page.getByText("Square注文IDを指定する",{exact:true}).click();
  await page.getByLabel(/Square注文ID/).fill("transaction1");
  await page.getByLabel(/確認内容/).fill("Squareの店舗・金額・時刻を照合済み");
  assert.equal(await verify.isDisabled(), true);
  await page.getByRole("checkbox").check();assert.equal(await verify.isEnabled(), true);
  await verify.click();await page.getByText("入金を確認し、注文を決済済みにしました。",{exact:true}).waitFor();
  assert.equal(posts[0].action,"VERIFY");assert.equal(posts[0].attested,true);
  await page.getByRole("button",{name:"未決済を確認して注文を終了",exact:true}).click();
  await page.getByText("Squareへの入金を確認したため、注文を決済済みにしました。",{exact:true}).waitFor();
  assert.equal(posts[1].action,"NO_CHARGE");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
  await page.reload();await page.getByRole("heading",{name:/注文 #7/}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"tmp/square-browser/admin-iphone.png",fullPage:true});
  await page.setViewportSize({width:1024,height:768});await page.screenshot({path:"tmp/square-browser/admin-ipad.png",fullPage:true});
  role="POS";
  await page.goto("http://localhost:3100/pos", { waitUntil: "domcontentloaded", timeout: 60000 });await page.getByText("入金の照合が必要です",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Squareで決済を開始"}).count(),0);
  await page.screenshot({path:"tmp/square-browser/pos-held.png",fullPage:true});
  // Close the page, reopen it with the same persistent storage; a completed result restores the receipt.
  await page.close();paid=true;
  const reopened=await context.newPage();reopened.on("pageerror",e=>errors.push(e.message));
  await reopened.goto("http://localhost:3100/pos", { waitUntil: "domcontentloaded", timeout: 60000 });await reopened.getByRole("dialog").waitFor();
  assert.match(await reopened.getByRole("dialog").innerText(),/注文 #7/);
  assert.equal(await reopened.evaluate(()=>localStorage.getItem("kissa.checkout.v1:pos1:pending")),null);
  await reopened.close();paid=false;recoverRequest=true;
  const recovery=await context.newPage();await recovery.goto("http://localhost:3100/pos", { waitUntil: "domcontentloaded", timeout: 60000 });
  const saved={idempotencyKey:"original-key-123",paymentMethod:"SQUARE",items:[],partySize:1,ageRanges:["20s"],fulfillmentType:"DINE_IN"};
  await recovery.evaluate(payload=>localStorage.setItem("kissa.checkout.v1:pos1:request",JSON.stringify(payload)),saved);
  await recovery.reload();await recovery.getByRole("button",{name:"元の注文送信を安全に再試行"}).waitFor();
  await recovery.getByRole("button",{name:"元の注文送信を安全に再試行"}).click();
  await recovery.waitForFunction(()=>!localStorage.getItem("kissa.checkout.v1:pos1:request"));
  assert.equal(posts.at(-1)?.idempotencyKey,"original-key-123");
  assert.deepEqual(errors,[]);
  console.log("PASS: conditional incident banner, mobile reconciliation and paid-on-close notice, held checkout, page-close recovery, persisted idempotent retry; no browser runtime errors.");
} finally {await browser.close();}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
