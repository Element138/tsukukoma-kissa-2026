const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const baseUrl=process.env.KISSA_TEST_BASE_URL||'http://127.0.0.1:3121';
assert(['127.0.0.1','localhost'].includes(new URL(baseUrl).hostname),'Run this fixture against a local test server');
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
for(const mode of (process.env.KISSA_CAMERA_TEST_MODE?[process.env.KISSA_CAMERA_TEST_MODE]:['denied','hung-camera','hung-cache','hung-encoding'])){
 const context=await browser.newContext({viewport:{width:1100,height:900},permissions:['camera'],userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',hasTouch:true});
 await context.addInitScript(mode=>{
   if(mode==='denied') navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};
   else if(mode==='hung-camera') navigator.mediaDevices.getUserMedia=()=>new Promise(()=>{});
   else {
     const source=document.createElement('canvas');source.width=640;source.height=480;
     const paint=source.getContext('2d');paint.fillRect(0,0,640,480);
     const stream=source.captureStream(10);
     setInterval(()=>{paint.fillStyle=Date.now()%2?'#345678':'#456789';paint.fillRect(0,0,640,480);},80);
     navigator.mediaDevices.getUserMedia=async()=>stream.clone();
     if(mode==='hung-cache'){
       const open=indexedDB.open.bind(indexedDB);
       indexedDB.open=(name,...args)=>name==='kissa.cashier-frames.v1'?{}:open(name,...args);
     }
     if(mode==='hung-encoding')HTMLCanvasElement.prototype.toBlob=()=>{};
   }
 },mode);
 let awaiting=null,launches=0,photos=0;
 const orders=[],errors=[];
 await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());let data={};
   if(url.pathname==='/api/auth/me') data={actor:{actorId:'pos-camera-test',actorType:'POS',label:'Camera test POS'},offlineActors:[]};
   else if(url.pathname==='/api/admin/menus') data={categories:[{id:'category',name:'飲み物',displayOrder:0}],menus:[{id:'coffee',name:'Coffee test',categoryId:'category',priceJpy:550,availability:'AVAILABLE',displayOrder:0,isActive:true,hasActiveKitchenCoverage:true,todayOrderCount:0,dailyOrderCap:null,remainingUntilCap:null,isCapReached:false}]};
   else if(url.pathname==='/api/payment-watchdog/ping') data={awaitingOrder:awaiting,trackedOrder:null,incidents:[]};
   else if(url.pathname==='/api/admin/photo-storage') data={failed:true,ignoreActive:false};
   else if(url.pathname==='/api/admin/square-payments') data={incidentCount:0};
   else if(url.pathname==='/api/realtime/token') return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{message:'Mock realtime disabled'}})});
   else if(url.pathname==='/api/realtime/events') return route.fulfill({contentType:'text/event-stream',body:': mocked\n\n'});
   else if(url.pathname==='/api/pos/cashier-photos'){ photos++;data={photoId:'test-photo',stored:false}; }
   else if(url.pathname==='/api/orders'&&req.method()==='POST'){
     const payload=req.postDataJSON();orders.push(payload);assert.equal(payload.cashierPhotoBestEffort,true);
     const square=payload.paymentMethod==='SQUARE';
     if(square) awaiting={id:'square-test-order',orderNo:479,checkoutKey:payload.idempotencyKey,launchAvailable:true,verificationPending:false,paymentAwaitDeadlineAt:null};
     data={order:{id:square?'square-test-order':'cash-test-order',orderNo:square?479:478,totalPriceJpy:550,paymentStatus:square?'AWAITING':'PAID',orderStatus:square?'PENDING':'IN_PROGRESS',paymentMethod:payload.paymentMethod},square:square?{launchAvailable:true}:null};
   } else if(url.pathname==='/api/square/launch'){
     launches++;assert.match(req.postData(),/cashierPhotoBestEffort=true/);
     return route.fulfill({contentType:'text/html',body:'<h1>Mock Square handoff reached</h1>'});
   }
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})});
 });
 const page=await context.newPage();await page.bringToFront();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('/pos',baseUrl).href,{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByText('Coffee test',{exact:true}).waitFor({timeout:60000});
 if(mode==='hung-cache'||mode==='hung-encoding') {
   try {await page.getByText('会計者画像の撮影は任意です',{exact:true}).waitFor({state:'detached',timeout:15000});}
   catch(error){console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,450),visibility:document.visibilityState,video:Array.from(document.querySelectorAll('video')).map(v=>({width:v.videoWidth,ready:v.readyState,time:v.currentTime,tracks:v.srcObject?.getTracks().map(t=>({state:t.readyState,muted:t.muted}))}))})));throw error;}
 }
 assert.equal(await page.locator('[inert]').count(),0);
 await page.locator('.menu-tile').filter({hasText:'Coffee test'}).getByRole('button',{name:'+',exact:true}).click();
 await page.locator('.age-group-grid > div').first().getByRole('button',{name:'+',exact:true}).click();
 const slide=async()=>{
   const track=page.locator('.confirm-slider');await track.scrollIntoViewIfNeeded();
   const thumb=page.locator('.confirm-slider-thumb');assert.equal(await thumb.isEnabled(),true);
   const box=await track.boundingBox(),button=await thumb.boundingBox();
   await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await page.mouse.down();
   await page.mouse.move(box.x+box.width-8,button.y+button.height/2,{steps:12});await page.mouse.up();
 };
 await slide();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=dialog]')).some(d=>d.textContent.includes('レシート')),{timeout:10000});
 assert.equal(orders.length,1);assert.equal(orders[0].paymentMethod,'CASH');
 await page.getByRole('dialog').getByRole('button',{name:'印刷せず閉じる',exact:true}).click();
 // A second checkout must remain possible after the failed photo preparation.
 await page.locator('.menu-tile').filter({hasText:'Coffee test'}).getByRole('button',{name:'+',exact:true}).click();
 await page.locator('.age-group-grid > div').first().getByRole('button',{name:'+',exact:true}).click();
 await page.getByRole('combobox').last().click();await page.getByRole('option',{name:'Square',exact:true}).click();
 await slide();await page.getByRole('button',{name:'Square決済を準備',exact:true}).waitFor({timeout:10000});
 const before=Date.now();await page.getByRole('button',{name:'Square決済を準備',exact:true}).click();
 assert.equal(launches,0,'preparation must not auto-submit the app launch');
 const launch=page.getByRole('button',{name:'Squareを開く',exact:true});await launch.waitFor({timeout:6000});
 assert(Date.now()-before<5500,'photo preparation must release checkout promptly');assert.equal(await launch.isEnabled(),true);
 await launch.click();await page.getByRole('heading',{name:'Mock Square handoff reached'}).waitFor();
 assert.equal(orders.length,2);assert.equal(launches,1);assert.deepEqual(errors,[]);
 if(mode==='denied'||mode==='hung-camera')assert.equal(photos,0);else assert(photos>=2);
 console.log('PASS browser:',mode,'cash checkout and subsequent Square native handoff; no camera lock or runtime errors');
 await context.close();
}
}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
