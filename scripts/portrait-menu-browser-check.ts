import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";

const item = (name: string, index: number) => ({ id: `item-${index}`, name, priceJpy: 150 + index * 10, availability: "AVAILABLE", coverImageDataUrl: null, allergens: ["WHEAT", "MILK"], allergenDisplayEnabled: true, customBadgeText: index === 0 ? "おすすめ" : null, customBadgeColor: "#0f766e", showLowStockBadge: index === 1, remainingUntilCap: 5 });
const category = (id: string, name: string, menus: ReturnType<typeof item>[]) => ({ id, name, customBadgeText: null as string | null, customBadgeColor: null as string | null, menus });
const defaultCategories = [category("food", "フード・スイーツ", ["小倉トースト", "三角バナナチョコパイ", "ラスク", "ホットドッグ", "チーズケーキ"].map(item)), category("drinks", "ドリンク", ["ドリップコーヒー（ホット）", "オーツミルクラテ（ホット）", "ホット抹茶豆乳ラテ", "アイスティー", "りんごジュース", "コーラ"].map((name, index) => item(name, index + 10)))];

async function measure(page: Page) {
  return page.evaluate(() => ({
    width: innerWidth, height: innerHeight, portrait: Boolean(document.querySelector(".is-portrait")),
    logoRatio: document.querySelector(".menu-display-logo")!.getBoundingClientRect().height / document.querySelector(".menu-display-brand > div")!.getBoundingClientRect().height,
    documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
    board: (() => { const r=document.querySelector(".menu-display-columns")!.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}; })(),
    sections: Array.from(document.querySelectorAll(".menu-display-category")).map(section => {
      const r=section.getBoundingClientRect();const viewport=section.querySelector(".menu-display-scroll-viewport") as HTMLElement;
      const track=section.querySelector(".menu-display-scroll-track") as HTMLElement;
      return {id:section.getAttribute("data-menu-section"),x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,overflow:track.scrollHeight-(viewport.clientHeight-parseFloat(getComputedStyle(viewport).paddingTop)-parseFloat(getComputedStyle(viewport).paddingBottom)),columns:getComputedStyle(track).gridTemplateColumns};
    }),
    clippedText: Array.from(document.querySelectorAll<HTMLElement>(".menu-display-row-text")).filter(text => text.scrollHeight > text.clientHeight+2 || text.scrollWidth > text.clientWidth+2).map(text => text.innerText),
    itemFont: parseFloat(getComputedStyle(document.querySelector(".menu-display-row-text strong")!).fontSize),
  }));
}

async function main() {
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const context=await browser.newContext({viewport:{width:2160,height:3840}});
  const baseline=process.env.MENU_DISPLAY_FIXTURE ? JSON.parse(readFileSync(process.env.MENU_DISPLAY_FIXTURE,"utf8")) : defaultCategories;
  let categories=baseline;
  const errors:string[]=[];
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==="/api/realtime/token"){await route.fulfill({status:503,contentType:"application/json",body:'{"ok":false}'});return;}
    const data=path==="/api/auth/me"?{actor:{actorId:"menu-layout-test",actorType:"MENU_DISPLAY",label:"メニュー表示"},offlineActors:[]} : path==="/api/menu-display"?{categories,settings:{pageDisplaySeconds:18}}:{};
    await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",error=>errors.push(error.message));
  const results:Record<string,unknown>={};
  async function load(){await page.goto("http://localhost:3120/menu-display",{waitUntil:"domcontentloaded",timeout:120000});await page.locator(".menu-display-row").first().waitFor();await page.evaluate(()=>document.fonts.ready);}
  async function portrait(label:string,width:number,height:number){
    await page.setViewportSize({width,height});await page.locator(".is-portrait").waitFor();
    const m=await measure(page);results[label]=m;
    assert.equal(m.sections.length,2);assert.equal(m.sections[0].id,categories[0].id);assert.equal(m.sections[1].id,categories[1].id);
    assert(m.board.width>width*.93);assert(m.board.bottom>height*.97 && m.board.bottom<=height);
    assert(m.sections[1].y>=m.sections[0].bottom && m.sections[1].bottom<=height);
    assert(Math.abs(m.sections[0].height-m.sections[1].height)<3);
    assert(m.documentWidth<=width+1 && m.documentHeight<=height+1);
    assert(Math.abs(m.logoRatio-2.5)<.03, `Logo/text ratio: ${m.logoRatio}`);
    assert.deepEqual(m.clippedText,[]);assert(m.itemFont>=30);
    return m;
  }
  try{
    await mkdir("tmp/portrait-menu",{recursive:true});
    await load();
    const initial=await portrait("portrait-4k",2160,3840);
    assert(initial.sections.every(section=>section.overflow<=3),JSON.stringify(initial));
    await page.screenshot({path:"tmp/portrait-menu/portrait-4k.png",fullPage:true});
    await page.getByRole("button",{name:"全画面表示",exact:true}).click();
    await page.waitForFunction(()=>Boolean(document.fullscreenElement));
    await portrait("portrait-4k-fullscreen",2160,3840);
    assert.equal(await page.locator(".terminal-banner").count(),0);
    await page.screenshot({path:"tmp/portrait-menu/portrait-4k-fullscreen.png",fullPage:true});
    await page.getByRole("button",{name:"全画面を終了",exact:true}).click();
    await page.waitForFunction(()=>!document.fullscreenElement);
    await portrait("portrait-full-hd",1080,1920);
    await page.screenshot({path:"tmp/portrait-menu/portrait-1080.png",fullPage:true});
    await page.setViewportSize({width:1920,height:1080});
    await page.waitForFunction(()=>!document.querySelector(".is-portrait"));
    const landscape=await measure(page);results.landscape=landscape;
    assert(landscape.sections[1].x>landscape.sections[0].x);assert.equal(landscape.sections[0].y,landscape.sections[1].y);
    assert(landscape.sections.every(section=>section.y>=0&&section.bottom<=1080));
    assert(landscape.documentHeight<=1081);assert(Math.abs(landscape.logoRatio-2.5)<.03);
    await page.screenshot({path:"tmp/portrait-menu/landscape.png",fullPage:true});
    await page.setViewportSize({width:2160,height:3840});await page.locator(".is-portrait").waitFor();
    categories=[category("drinks","First category",defaultCategories[1].menus),category("food","Second category",defaultCategories[0].menus)];
    categories[0].customBadgeText="数量限定";categories[0].customBadgeColor="#b45309";
    await load();await portrait("category-order",2160,3840);
    assert.equal(await page.locator(".menu-display-source-category").count(),0);
    await page.screenshot({path:"tmp/portrait-menu/category-order.png",fullPage:true});
    const sampleImage="data:image/webp;base64,"+(await sharp({create:{width:400,height:300,channels:3,background:"#537f60"}}).webp().toBuffer()).toString("base64");
    categories=defaultCategories.map(group=>({...group,menus:group.menus.map((menu,index)=>({...menu,coverImageDataUrl:index<2?sampleImage:null}))}));
    await load();await portrait("with-photos-4k",2160,3840);
    await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLImageElement>(".menu-display-row-image")).every(img=>img.naturalWidth>0));
    await page.screenshot({path:"tmp/portrait-menu/with-photos-4k.png",fullPage:true});
    await portrait("with-photos-full-hd",1080,1920);
    await page.setViewportSize({width:2160,height:3840});await page.locator(".is-portrait").waitFor();
    categories=[category("food","フード・スイーツ",Array.from({length:20},(_,index)=>item(`チョコレートとキャラメルのスペシャルパンケーキ ${index+1}`,index))),category("drinks","ドリンク",Array.from({length:20},(_,index)=>item(`オーツミルクのキャラメルカフェラテ（ホット） ${index+1}`,index+30)))];
    await load();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll(".menu-display-scroll-track")).every(track=>track.getAnimations().length>0));
    const stress=await measure(page);results.overflow=stress;assert.deepEqual(stress.clippedText,[]);
    assert(stress.sections.every(section=>section.overflow>0));
    const scrolled=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>(".menu-display-scroll-track")).map(track=>{
      const animation=track.getAnimations()[0];animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*.7;
      return {transform:getComputedStyle(track).transform};
    }));
    assert(scrolled.every(track=>track.transform!=="none"));
    assert.deepEqual(errors,[]);
    await writeFile("tmp/portrait-menu/measurements.json",JSON.stringify(results,null,2));
    console.log("Portrait menu browser checks passed: 2160×3840 standard/fullscreen, 1080×1920, landscape rotation, category order, badges, full panel use, unclipped text and animated overflow.");
  }catch(error){await page.screenshot({path:"tmp/portrait-menu/failure.png",fullPage:true});if(await page.locator(".menu-display-columns").count())console.log(JSON.stringify(await measure(page),null,2));else console.log((await page.locator("body").innerText()).slice(0,1000),errors);throw error;}
  finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
