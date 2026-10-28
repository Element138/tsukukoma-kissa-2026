import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera"] });
  let role = "POS";
  let ignoreActive = false;
  const calls: string[] = [];
  const photoUploads: Buffer[] = [];
  const checkoutKeys: string[] = [];
  const errors: string[] = [];
  await context.addInitScript(() => {
    (window as any).denyCamera = true;
    navigator.mediaDevices.getUserMedia = async constraints => {
      if ((window as any).denyCamera) throw new DOMException("Denied", "NotAllowedError");
      if ((constraints?.video as MediaTrackConstraints)?.facingMode && JSON.stringify((constraints!.video as MediaTrackConstraints).facingMode) !== JSON.stringify({ exact: "user" })) throw new Error("Front camera must be mandatory");
      // Native fake camera tracks on this host report "ended" after play().
      // A synthetic stream keeps real video/frame progression and stop semantics.
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const painter = canvas.getContext("2d")!;
      const timer = setInterval(() => { painter.fillStyle = `hsl(${Date.now() % 360}, 50%, 50%)`; painter.fillRect(0, 0, 640, 480); }, 50);
      const stream = canvas.captureStream(10);
      stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(timer));
      (window as any).cameraStream = stream;
      return stream;
    };
  });
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    let data: any = {};
    if (url.pathname === "/api/auth/me") data = { actor: { actorId: "staff", actorType: role, label: role }, offlineActors: [] };
    else if (url.pathname === "/api/admin/photo-storage") {
      if (route.request().method() === "POST") { calls.push("dismiss"); ignoreActive = true; }
      data = { failed: true, ignoreActive };
    } else if (url.pathname === "/api/admin/menus") data = { menus: role === "POS" ? [{ id: "coffee", name: "Coffee", priceJpy: 500, availability: "AVAILABLE", isActive: true, categoryId: "drinks", displayOrder: 0, hasActiveKitchenCoverage: true, todayOrderCount: 0, dailyOrderCap: null, remainingUntilCap: null, isCapReached: false }] : [], categories: role === "POS" ? [{ id: "drinks", name: "Drinks", displayOrder: 0 }] : [] };
    else if (url.pathname === "/api/admin/actors") data = { actors: [] };
    else if (url.pathname === "/api/admin/categories") data = { categories: [] };
    else if (url.pathname === "/api/admin/menu-display-settings") data = { settings: { pageDisplaySeconds: 18, orderDisplayMarqueeText: "", orderDisplayMarqueeSpeedSeconds: 24, orderCallVolume: 0.8 } };
    else if (url.pathname === "/api/admin/square-payments") data = { incidentCount: 0, incidents: [] };
    else if (url.pathname === "/api/payment-watchdog/ping") data = { awaitingOrder: null, incidents: [], trackedOrder: null };
    else if (url.pathname === "/api/pos/cashier-photos") data = { photoId: "browser-photo", stored: false };
    else if (url.pathname === "/api/pos/cashier-photos/browser-photo") { photoUploads.push(route.request().postDataBuffer()!); data = { stored: true, ignoreAllowed: false }; }
    else if (url.pathname === "/api/orders") {
      checkoutKeys.push(route.request().postDataJSON().idempotencyKey);
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "TEST_DONE", message: "撮影検証完了" } }) }); return;
    }
    else if (url.pathname === "/api/order-book") data = { orders: [
      { id: "order", orderNo: 1, createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(), lastCalledAt: null, fulfillmentType: "TAKEOUT", tableNo: null, ageGroupCounts: {}, totalPriceJpy: 500, paymentMethod: "CASH", paymentStatus: "PAID", orderStatus: "COMPLETED", specialNote: null, lastMutationVersion: 0, items: [], cashierPhotoStatus: "STORED" },
      { id: "waived", orderNo: 2, createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(), fulfillmentType: "TAKEOUT", ageGroupCounts: {}, totalPriceJpy: 500, paymentMethod: "CASH", paymentStatus: "PAID", orderStatus: "COMPLETED", lastMutationVersion: 0, items: [], cashierPhotoStatus: "WAIVED" },
    ], incidents: [], menuCounts: [], totals: {} };
    else if (url.pathname === "/api/orders/order/cashier-photo") { calls.push("view"); data = { url: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", capturedAt: new Date().toISOString(), waived: false }; }
    else if (url.pathname === "/api/realtime/token") { await route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' }); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto("http://localhost:3117/pos", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("Checking denied camera gate");
    await page.getByRole("heading", { name: "カメラを接続してください" }).waitFor();
    await page.getByText("ブラウザの設定でカメラを許可してください").waitFor();
    assert.equal(await page.locator("[inert]").count(), 1);
    await mkdir("tmp/cashier-photos", { recursive: true });
    await page.screenshot({ path: "tmp/cashier-photos/camera-denied.png", fullPage: true });
    await page.evaluate(() => { (window as any).denyCamera = false; });
    await page.getByRole("button", { name: "カメラを接続", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("[inert]"));
    await page.locator(".menu-tile").filter({ hasText: "Coffee" }).getByRole("button", { name: "+", exact: true }).click();
    await page.locator(".age-group-row").filter({ hasText: "18～29歳" }).getByRole("button", { name: "+", exact: true }).click();
    const slider = page.locator(".confirm-slider");
    await slider.scrollIntoViewIfNeeded();
    const thumb = await page.locator(".confirm-slider-thumb").boundingBox();
    const rail = await slider.boundingBox();
    assert(thumb && rail);
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rail.x + rail.width - 26, rail.y + rail.height / 2, { steps: 12 });
    const sent = page.waitForResponse(response => new URL(response.url()).pathname === "/api/orders");
    await page.mouse.up(); await sent;
    assert.equal(photoUploads.length, 1); assert.equal(checkoutKeys.length, 1);
    assert(photoUploads[0].length <= 100000 && photoUploads[0].length > 0);
    assert.equal(photoUploads[0].readUInt16BE(0), 0xffd8);
    assert.equal(photoUploads[0].readUInt16BE(photoUploads[0].length - 2), 0xffd9);
    console.log(`Captured and uploaded a ${photoUploads[0].length}-byte JPEG before checkout`);
    console.log("Camera connected; checking stopped stream lock");
    await page.evaluate(() => { (window as any).cameraStream.getTracks().forEach((track: MediaStreamTrack) => track.stop()); });
    await page.getByRole("heading", { name: "カメラを接続してください" }).waitFor({ timeout: 7000 });
    assert.equal(await page.locator("[inert]").count(), 1);

    role = "ADMIN";
    await page.goto("http://localhost:3117/admin", { waitUntil: "domcontentloaded" });
    await page.getByText("会計者画像を保存できないため、新規会計を停止しています", { exact: true }).waitFor();
    console.log("Checking administrator override confirmation");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "本日の会計を許可" }).click();
    assert.equal(calls.length, 0);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "本日の会計を許可" }).click();
    await page.getByText("本日は画像の保存失敗時も会計を続行します").waitFor();
    assert.deepEqual(calls, ["dismiss"]);
    await page.screenshot({ path: "tmp/cashier-photos/admin-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "tmp/cashier-photos/admin-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.goto("http://localhost:3117/order-book", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "会計者画像", exact: true }).waitFor();
    assert.equal(calls.filter(call => call === "view").length, 0, "No image requests before opening the viewer");
    await page.getByRole("button", { name: "会計者画像", exact: true }).click();
    await page.getByAltText("会計者画像", { exact: true }).waitFor();
    assert.equal(calls.filter(call => call === "view").length, 1);
    await page.getByText("会計者画像：保存なし（管理者承認）").waitFor();
    await page.screenshot({ path: "tmp/cashier-photos/order-book-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log("Browser checks passed: camera refusal and stopped streams lock POS, recovery unlocks it, administrator confirmation and JST notice work, images load on demand, mobile layouts fit.");
  } catch (error) {
    console.log((await page.locator("body").innerText()).slice(0, 1500));
    console.log("Page errors:", errors);
    console.log("Camera state:", JSON.stringify(await page.evaluate(() => ({
      visibility: document.visibilityState,
      video: Array.from(document.querySelectorAll("video")).map(video => ({
        time: video.currentTime, readyState: video.readyState,
        streamTracks: (video.srcObject as MediaStream | null)?.getTracks().map(track => ({ state: track.readyState, muted: track.muted })),
      })),
      lastTracks: (window as any).cameraStream?.getTracks().map((track: MediaStreamTrack) => ({ state: track.readyState, muted: track.muted })),
    })), null, 2));
    await mkdir("tmp/cashier-photos", { recursive: true });
    await page.screenshot({ path: "tmp/cashier-photos/browser-failure.png", fullPage: true });
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
