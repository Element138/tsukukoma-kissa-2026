import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../lib/db";
import { GET as exportOrders } from "../app/api/order-book/export/route";
import { GET as sales } from "../app/api/sales/route";

test("partial refunds reduce CSV item counts and revenue while preserving served-item history",async()=>{
  const db=prisma as any;
  const original={session:db.session.findUnique,orders:db.order.findMany,menus:db.menu.findMany,incidents:db.paymentIncident.findMany};
  const at=new Date("2026-10-30T03:00:00Z");
  const order={id:"order-refund",orderNo:12,createdAt:at,confirmedAt:at,canceledAt:null,orderStatus:"PARTIALLY_CANCELED",paymentStatus:"PAID",paymentMethod:"SQUARE",totalPriceJpy:300,
    fulfillmentType:"DINE_IN",partySize:1,tableNo:null,ageRangesJson:[],specialNote:null,events:[],excludeFromWaitStats:false,
    items:[{id:"kept",menuId:"coffee",itemNameSnapshot:"Coffee",unitPriceJpy:100,status:"SERVED",servedAt:at,readyAt:null},
      {id:"refunded",menuId:"coffee",itemNameSnapshot:"Coffee",unitPriceJpy:200,status:"CANCELED",servedAt:at,readyAt:null}]};
  db.session.findUnique=async()=>({sessionId:"s",expiresAt:new Date(Date.now()+60000),lastActivityAt:new Date(),actor:{id:"pos",actorType:"POS",isActive:true,lastSeenAt:new Date(),label:"POS"}});
  db.order.findMany=async()=>[order];db.menu.findMany=async()=>[{name:"Coffee",displayOrder:0}];db.paymentIncident.findMany=async()=>[];
  const req=(url:string)=>new NextRequest(url,{headers:{cookie:"kissa_session=test"}});
  try{
    const response=await exportOrders(req("http://localhost/api/order-book/export"));assert.equal(response.status,200);
    const [header,row]=(await response.text()).trim().split(/\r?\n/).map(line=>line.split(","));
    assert.equal(row[header.indexOf("total_price_jpy")],"100");
    assert.equal(row[header.indexOf("item_count")],"1");assert.equal(row[header.indexOf("Coffee")],"1");
    const salesResponse=await sales(req("http://localhost/api/sales?date=2026-10-30"));assert.equal(salesResponse.status,200);
    const report=(await salesResponse.json()).data;
    assert.equal(report.totals.salesJpy,100);assert.equal(report.totals.itemCount,1);
    assert.equal(order.items[1].servedAt,at);assert.equal(order.totalPriceJpy,300);
  }finally{
    db.session.findUnique=original.session;db.order.findMany=original.orders;db.menu.findMany=original.menus;db.paymentIncident.findMany=original.incidents;
  }
});
