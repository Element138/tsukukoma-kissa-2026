import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { NextRequest } from "next/server";

async function main() {
  Object.assign(process.env, parse(readFileSync(".env.local")), { KISSA_TRACE_DB: "0" });
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("schema"), "kissa_cashier_photo_preview");
  const { prisma } = await import("../lib/db");
  assert.equal((await prisma.$queryRaw<Array<{schema:string}>>`SELECT current_schema() AS schema`)[0].schema, "kissa_cashier_photo_preview");
  const { createSession } = await import("../lib/server/auth");
  const { hashSecret } = await import("../lib/crypto");
  const route = await import("../app/api/admin/menu-last-orders/route");
  const display = await import("../app/api/menu-display/route");
  const prefix = `last-order-test-${randomUUID().slice(0,8)}`;
  const actors = ["ADMIN", "POS", "MENU_DISPLAY"] as const;
  const ids = actors.map(role => `${prefix}-${role}`);
  const tokens: Record<string,string> = {};
  const date = "2199-12-30";
  assert.equal(await prisma.menuDisplayLastOrder.findUnique({where:{jstDate:date}}),null,"Test date must be unused");
  const beforeOrders = await prisma.order.count();
  function req(role?:string, body?:object, origin="http://localhost:3120") {
    return new NextRequest("http://localhost:3120/api/admin/menu-last-orders", {
      method: body ? "PUT" : "GET", headers: {Origin:origin,"Content-Type":"application/json",...(role?{Cookie:`kissa_session=${tokens[role]}`}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
  }
  try {
    for (const [index,role] of actors.entries()) {
      await prisma.actor.create({data:{id:ids[index],actorType:role,label:"Last-order integration test",secretHash:hashSecret(randomUUID())}});
      tokens[role]=(await createSession({id:ids[index],actorType:role})).token;
    }
    assert.equal((await route.GET(req())).status,401);
    assert.equal((await route.GET(req("POS"))).status,403);
    assert.equal((await route.PUT(req("MENU_DISPLAY",{date,time:"16:30"}))).status,403);
    assert.equal((await route.PUT(req("ADMIN",{date,time:"16:30"},"https://evil.example"))).status,403);
    for(const body of [{date:"2020-01-01",time:"16:30"},{date:"2199-02-30",time:"16:30"},{date,time:"24:00"}])assert.equal((await route.PUT(req("ADMIN",body))).status,400);
    const saved=await route.PUT(req("ADMIN",{date,time:"16:30"}));
    assert.equal(saved.status,200,await saved.text());
    let schedule=(await (await route.GET(req("ADMIN"))).json()).data.entries.find((entry:any)=>entry.date===date);
    assert.equal(schedule.time,"16:30");assert.equal(schedule.closesAt,"2199-12-30T07:30:00.000Z");
    assert.equal((await route.PUT(req("ADMIN",{date,time:"17:00"}))).status,200);
    const payload=(await (await display.GET(req("MENU_DISPLAY"))).json()).data;
    assert(Number.isFinite(Date.parse(payload.serverNow)));
    assert.equal(payload.settings.lastOrders.find((entry:any)=>entry.date===date).closesAt,"2199-12-30T08:00:00.000Z");
    // The setting is for display only: POS still receives menu data normally.
    assert.equal((await display.GET(req("POS"))).status,200);
    assert.equal((await route.DELETE(req("ADMIN",{date}))).status,200);
    assert.equal(await prisma.menuDisplayLastOrder.findUnique({where:{jstDate:date}}),null);
    const audits=await prisma.auditLog.findMany({where:{actorId:ids[0],entityType:"menu_last_order"},orderBy:{timestamp:"asc"}});
    assert.deepEqual(audits.map(log=>log.actionType),["MENU_LAST_ORDER_SET","MENU_LAST_ORDER_SET","MENU_LAST_ORDER_REMOVED"]);
    assert.equal((audits[1].beforeJson as any).closesAt,"2199-12-30T07:30:00.000Z");
    assert.equal((audits[2].afterJson as any).closesAt,null);
    assert.equal(await prisma.order.count(),beforeOrders);
    console.log("Isolated Preview integration passed: ADMIN-only schedule CRUD, origin/date validation, server-clock display settings, POS access and audited before/after values. Existing orders unchanged.");
  } finally {
    await prisma.menuDisplayLastOrder.deleteMany({where:{jstDate:date}});
    await prisma.auditLog.deleteMany({where:{actorId:{in:ids}}});
    await prisma.actor.deleteMany({where:{id:{in:ids}}});
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
