import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { parse } from "dotenv";
import { NextRequest } from "next/server";
import sharp from "sharp";

async function main() {
  Object.assign(process.env, parse(readFileSync(".env.local")), { KISSA_TRACE_DB: "0" });
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("schema"), "kissa_cashier_photo_preview");
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const { prisma } = await import("../lib/db");
  const { createSession } = await import("../lib/server/auth");
  const { hashSecret } = await import("../lib/crypto");
  const upload = await import("../app/api/admin/menu-covers/upload/route");
  const serve = await import("../app/api/menu-covers/[imageId]/route");
  const menus = await import("../app/api/admin/menus/route");
  const display = await import("../app/api/menu-display/route");
  const { compressMenuCover } = await import("../lib/server/menu-cover-image");
  const prefix = `menu-img-test-${randomUUID().slice(0,8)}`;
  const actorIds = ["ADMIN", "POS", "MENU_DISPLAY"].map(role => `${prefix}-${role}`);
  const tokens: Record<string,string> = {};
  let categoryId: string | undefined, menuId: string | undefined, imageId: string | undefined;
  let imageExisted = false;
  const beforeOrders = await prisma.order.count();
  const originalFetch = globalThis.fetch;
  // This feature must never contact Blob (or any external image store).
  globalThis.fetch = (async () => { throw new Error("Unexpected external fetch"); }) as any;
  function req(path: string, role?: string, init?: { method?: string; body?: FormData | string; headers?: Record<string,string> }) {
    return new NextRequest(`http://localhost:3118${path}`, { ...init, headers: { Origin: "http://localhost:3118", ...(role ? { Cookie: `kissa_session=${tokens[role]}` } : {}), ...init?.headers } });
  }
  function form(bytes: Uint8Array, type="image/png") {
    const body=new FormData(); body.set("file",new File([new Uint8Array(bytes)],"test.png",{type})); return body;
  }
  try {
    for (const [index,role] of ["ADMIN","POS","MENU_DISPLAY"].entries()) {
      await prisma.actor.create({ data: { id: actorIds[index], actorType: role as any, label: "Menu image integration test", secretHash: hashSecret(randomUUID()) } });
      tokens[role]=(await createSession({id:actorIds[index],actorType:role as any})).token;
    }
    categoryId=(await prisma.menuCategory.create({data:{name:prefix}})).id;
    menuId=(await prisma.menu.create({data:{name:prefix,priceJpy:500,workloadSeconds:1,categoryId,availability:"PAUSED",coverImageDataUrl:"https://old.public.blob.vercel-storage.com/menu.jpg"}})).id;
    const input=await sharp({create:{width:1200,height:800,channels:3,background:`#${randomUUID().replaceAll("-","").slice(0,6)}`}}).png().toBuffer();
    imageId=createHash("sha256").update(await compressMenuCover(input)).digest("hex");
    imageExisted=Boolean(await prisma.menuCoverImage.findUnique({where:{id:imageId}}));
    assert.equal((await upload.POST(req("/upload",undefined,{method:"POST",body:form(input)}))).status,401);
    assert.equal((await upload.POST(req("/upload","POS",{method:"POST",body:form(input)}))).status,403);
    assert.equal((await upload.POST(req("/upload","ADMIN",{method:"POST",body:form(input),headers:{Origin:"https://evil.example"}}))).status,403);
    assert.equal((await upload.POST(req("/upload","ADMIN",{method:"POST",body:form(Buffer.from("invalid"))}))).status,400);
    assert.equal((await upload.POST(req("/upload","ADMIN",{method:"POST",body:form(input,"text/plain")}))).status,415);
    assert.equal((await upload.POST(req("/upload","ADMIN",{method:"POST",body:form(Buffer.alloc(1000001))}))).status,413);
    const saved=await upload.POST(req("/upload","ADMIN",{method:"POST",body:form(input)}));
    assert.equal(saved.status,200);const {url}=(await saved.json()).data;
    assert.equal(url,`/api/menu-covers/${imageId}`);
    await upload.POST(req("/upload","ADMIN",{method:"POST",body:form(input)}));
    assert.equal(await prisma.menuCoverImage.count({where:{id:imageId}}),1);
    const context={params:Promise.resolve({imageId})};
    const image=await serve.GET(req(url),context);
    assert.equal(image.status,200);assert.equal(image.headers.get("content-type"),"image/webp");
    assert.equal(image.headers.get("access-control-allow-origin"),"*");
    assert.match(image.headers.get("cache-control")!,/immutable/);
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width,1024);
    assert.equal((await serve.GET(req(url,undefined,{headers:{"If-None-Match":`"${imageId}"`}}),context)).status,304);
    assert.equal((await serve.GET(req("/missing"),{params:Promise.resolve({imageId:"0".repeat(64)})})).status,404);
    const legacy=(await (await menus.GET(req("/api/admin/menus","ADMIN"))).json()).data.menus.find((menu:any)=>menu.id===menuId);
    assert.equal(legacy.coverImageDataUrl,null);
    const updated=await menus.PATCH(req("/api/admin/menus","ADMIN",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:menuId,coverImageDataUrl:url})}));
    assert.equal(updated.status,200);
    const shown=(await (await display.GET(req("/api/menu-display","MENU_DISPLAY"))).json()).data.categories.flatMap((category:any)=>category.menus).find((menu:any)=>menu.id===menuId);
    assert.equal(shown.coverImageDataUrl,url);assert.equal(shown.bytes,undefined);
    const audit=await prisma.auditLog.findFirst({where:{actorId:actorIds[0],entityId:menuId},orderBy:{timestamp:"desc"}});
    assert(audit); assert(!JSON.stringify(audit).includes('"bytes"')); assert(!JSON.stringify(audit).includes("data:image"));
    assert.equal(await prisma.order.count(),beforeOrders);
    console.log("PostgreSQL menu image integration passed: ADMIN-only uploads without Blob credentials or external fetches, malformed/oversize rejection, deduplication, WebP serving/ETag, menu saving/display, legacy Blob fallback and metadata-only auditing. Existing orders unchanged.");
  } finally {
    globalThis.fetch=originalFetch;
    await prisma.auditLog.deleteMany({where:{actorId:{in:actorIds}}});
    if(menuId)await prisma.menu.delete({where:{id:menuId}});
    if(categoryId)await prisma.menuCategory.delete({where:{id:categoryId}});
    await prisma.actor.deleteMany({where:{id:{in:actorIds}}});
    if(imageId&&!imageExisted)await prisma.menuCoverImage.deleteMany({where:{id:imageId}});
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
