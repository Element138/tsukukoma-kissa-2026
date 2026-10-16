import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { releaseMenuDailyCountsForOrder, resetTodayMenuCount, reserveMenuDailyCountsForOrder } from "../lib/domain/menu-cap";
import { confirmOrderPayment, cancelPendingOrder } from "../lib/domain/orders";

function fixture() {
  const counters = new Map([["menu1:2026-10-16", 7], ["menu1:2026-10-17", 2]]);
  const reservations = [{ orderId: "order1", menuId: "menu1", jstDate: "2026-10-16", quantity: 3, releasedAt: null as Date | null }];
  const order: any = { id: "order1", orderNo: 1, orderStatus: "PENDING", paymentStatus: "AWAITING", confirmedAt: null,
    items: [{menuId:"menu1"},{menuId:"menu1"},{menuId:"menu1"}], events: [], lastMutationVersion: 0 };
  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      if (strings.join("").includes('UPDATE "MenuDailyCount"')) {
        const [quantity, menuId, date, cap] = values, key = `${menuId}:${date}`, count = counters.get(key) ?? 0;
        if (cap !== null && count + quantity > cap) return [];
        counters.set(key,count + quantity); return [{count:count+quantity}];
      }
      return [];
    },
    $executeRaw: async (_: TemplateStringsArray, quantity: number, menuId: string, date: string) => {
      const key=`${menuId}:${date}`;counters.set(key,Math.max(0,(counters.get(key)??0)-quantity));return 1;
    },
    menuDailyCount: {upsert:async({where,update,create}:any)=>{
      const {menuId,jstDate}=where.menuId_jstDate,key=`${menuId}:${jstDate}`;
      if (!counters.has(key)) counters.set(key,create.count);
      else if(update.count===0)counters.set(key,0);
      return {count:counters.get(key)};
    }},
    orderMenuCapReservation: {
      findMany:async({where}:any)=>reservations.filter(row=>row.orderId===where.orderId&&!row.releasedAt).map(row=>({...row})),
      updateMany:async({where,data}:any)=>{let count=0;for(const row of reservations){if(!row.releasedAt&&(!where.orderId||where.orderId===row.orderId)&&row.menuId===where.menuId&&(!where.jstDate||where.jstDate===row.jstDate)){row.releasedAt=data.releasedAt;count++;}}return{count};},
    },
    order: {
      findUnique:async()=>({...order}),
      update:async({data}:any)=>{Object.assign(order,data);return{...order};},
    },
    orderItem:{updateMany:async()=>({count:3})},
    auditLog:{findFirst:async()=>null,create:async()=>({})},
  };
  return {db:db as PrismaClient,counters,reservations,order};
}
test("failed payment releases its own reserved quantities exactly once",async()=>{
  const f=fixture();await confirmOrderPayment(f.db,{orderId:"order1",result:"FAILED",actorId:null,actorType:null});
  assert.equal(f.order.paymentStatus,"FAILED");assert.equal(f.counters.get("menu1:2026-10-16"),4);
  await assert.rejects(confirmOrderPayment(f.db,{orderId:"order1",result:"FAILED",actorId:null,actorType:null}));
  await releaseMenuDailyCountsForOrder(f.db,"order1");assert.equal(f.counters.get("menu1:2026-10-16"),4);
});
test("manual cancellation also releases the reservation",async()=>{
  const f=fixture();await cancelPendingOrder(f.db,{orderId:"order1",actorId:"admin",actorType:"ADMIN"});
  assert.equal(f.counters.get("menu1:2026-10-16"),4);
});
test("release after midnight changes the reservation day, not today's count",async()=>{
  const f=fixture();await releaseMenuDailyCountsForOrder(f.db,"order1");
  assert.equal(f.counters.get("menu1:2026-10-17"),2);assert.equal(f.counters.get("menu1:2026-10-16"),4);
});
test("reset retires prior reservations so later failures do not consume a new customer's slots",async()=>{
  const f=fixture();await resetTodayMenuCount(f.db,"menu1","2026-10-16");
  f.counters.set("menu1:2026-10-16",2);await releaseMenuDailyCountsForOrder(f.db,"order1");
  assert.equal(f.counters.get("menu1:2026-10-16"),2);
});
test("simultaneous repeated releases cannot double-subtract",async()=>{
  const f=fixture();await Promise.all([releaseMenuDailyCountsForOrder(f.db,"order1"),releaseMenuDailyCountsForOrder(f.db,"order1")]);
  assert.equal(f.counters.get("menu1:2026-10-16"),4);
});
test("reservations snapshot quantity/day and apply caps, including menus currently uncapped",async()=>{
  const f=fixture();const params={menuNameById:new Map([["menu1","Coffee"]]),dailyOrderCapById:new Map<string,number|null>([["menu1",9]]),quantitiesByMenuId:new Map([["menu1",2]]),jstDate:"2026-10-16"};
  assert.deepEqual(await reserveMenuDailyCountsForOrder(f.db,params),[{menuId:"menu1",quantity:2,jstDate:"2026-10-16"}]);
  await assert.rejects(reserveMenuDailyCountsForOrder(f.db,params),{code:"MENU_CAP_REACHED"});
  params.dailyOrderCapById.set("menu1",null);await reserveMenuDailyCountsForOrder(f.db,params);assert.equal(f.counters.get("menu1:2026-10-16"),11);
});
