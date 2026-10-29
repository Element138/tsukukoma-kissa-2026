import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

async function main() {
  Object.assign(process.env, parse(readFileSync(".env.local")), { KISSA_TRACE_DB: "0" });
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("schema"), "kissa_cashier_photo_preview");
  const { prisma } = await import("../lib/db");
  assert.equal((await prisma.$queryRaw<Array<{schema:string}>>`SELECT current_schema() AS schema`)[0].schema,"kissa_cashier_photo_preview");
  const { createSession } = await import("../lib/server/auth");
  const { hashSecret } = await import("../lib/crypto");
  const route = await import("../app/api/admin/menus/route");
  const display = await import("../app/api/menu-display/route");
  const { getMenuDisplayData } = await import("../lib/server/menu-display-data");
  const prefix=`visibility-test-${randomUUID().slice(0,8)}`;
  const ids=[`${prefix}-ADMIN`,`${prefix}-POS`];const tokens:Record<string,string>={};
  let categoryId:string|undefined, menuId:string|undefined;
  const count=await prisma.order.count();
  function req(role:string, body?:object){return new NextRequest("http://localhost:3120/api/admin/menus",{method:body?"PATCH":"GET",headers:{Origin:"http://localhost:3120",Cookie:`kissa_session=${tokens[role]}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});}
  try {
    for(const[index,role]of ["ADMIN","POS"].entries()){
      await prisma.actor.create({data:{id:ids[index],actorType:role as "ADMIN"|"POS",label:prefix,secretHash:hashSecret(randomUUID())}});
      tokens[role]=(await createSession({id:ids[index],actorType:role as "ADMIN"|"POS"})).token;
    }
    categoryId=(await prisma.menuCategory.create({data:{name:prefix}})).id;
    const menu=await prisma.menu.create({data:{categoryId,name:prefix,priceJpy:200,workloadSeconds:1,availability:"PAUSED"}});menuId=menu.id;
    assert.equal(menu.showOnMenuDisplay,true);
    const isShown=async()=> (await getMenuDisplayData()).categories.flatMap(category=>category.menus).some(menu=>menu.id===menuId);
    assert.equal(await isShown(),true);
    assert.equal((await route.PATCH(req("POS",{id:menuId,showOnMenuDisplay:false}))).status,403);
    assert.equal((await route.PATCH(req("POS",{id:menuId,showOnMenuDisplay:false,availability:"PAUSED"}))).status,403);
    assert.equal((await route.PATCH(req("ADMIN",{id:menuId,showOnMenuDisplay:"false"}))).status,400);
    assert.equal((await route.PATCH(req("ADMIN",{id:menuId,showOnMenuDisplay:false}))).status,200);
    assert.equal(await isShown(),false);
    const shown=(await(await display.GET(req("POS"))).json()).data.categories.flatMap((category:any)=>category.menus);
    assert(!shown.some((menu:any)=>menu.id===menuId));
    const pos=(await(await route.GET(req("POS"))).json()).data.menus.find((menu:any)=>menu.id===menuId);
    assert.equal(pos.showOnMenuDisplay,false);assert.equal(pos.isActive,true);assert.equal(pos.availability,"PAUSED");
    assert.equal((await route.PATCH(req("ADMIN",{id:menuId,showOnMenuDisplay:true}))).status,200);
    assert.equal(await isShown(),true);
    const audits=await prisma.auditLog.findMany({where:{actorId:ids[0],entityId:menuId},orderBy:{timestamp:"asc"}});
    assert.equal(audits.length,2);assert.equal((audits[0].beforeJson as any).showOnMenuDisplay,true);assert.equal((audits[0].afterJson as any).showOnMenuDisplay,false);
    assert.equal(await prisma.order.count(),count);
    console.log("Isolated Preview visibility checks passed: default on, ADMIN-only toggles, display exclusion/restoration, unchanged POS availability/active state, audit before/after records and existing orders preserved.");
  } finally {
    await prisma.auditLog.deleteMany({where:{actorId:{in:ids}}});
    if(menuId)await prisma.menu.delete({where:{id:menuId}});
    if(categoryId)await prisma.menuCategory.delete({where:{id:categoryId}});
    await prisma.actor.deleteMany({where:{id:{in:ids}}});await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
