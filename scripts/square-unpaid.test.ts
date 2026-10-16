import test from "node:test";
import assert from "node:assert/strict";
import { inspectSquareBeforeClosing } from "../lib/domain/square-unpaid";
const input={orderId:"order1",amountJpy:420,locationId:"location1",launchedAt:new Date(Date.now()-60_000)};
async function usingPayments(payments:any[], fn:()=>Promise<void>, extra?:{cursor?:string;fail?:boolean;respond?:(url:string)=>unknown}){
  const old=global.fetch,token=process.env.SQUARE_ACCESS_TOKEN;
  process.env.SQUARE_ACCESS_TOKEN="test-private";
  global.fetch=async url=>{if(extra?.fail)throw Error("network");return Response.json(extra?.respond ? extra.respond(String(url)) : {payments,cursor:extra?.cursor});};
  try{await fn();}finally{global.fetch=old;if(token===undefined)delete process.env.SQUARE_ACCESS_TOKEN;else process.env.SQUARE_ACCESS_TOKEN=token;}
}
const payment={id:"payment1",order_id:"transaction1",status:"COMPLETED",location_id:"location1",note:"[KISSa:order1]",total_money:{amount:420,currency:"JPY"}};
test("unpaid-close discovers a completed payment even when its callback was lost",async()=>{
  await usingPayments([payment],async()=>assert.deepEqual(await inspectSquareBeforeClosing(input),{kind:"completed",transactionId:"transaction1"}));
});
test("processing payments block an unpaid closure",async()=>{
  await usingPayments([{...payment,status:"APPROVED"}],async()=>{await assert.rejects(inspectSquareBeforeClosing(input),{code:"SQUARE_STILL_PENDING"});});
});
test("empty completed search permits staff-attested closure after the propagation grace",async()=>{
  await usingPayments([],async()=>assert.deepEqual(await inspectSquareBeforeClosing(input),{kind:"unpaid"}));
  await usingPayments([],async()=>{await assert.rejects(inspectSquareBeforeClosing({...input,launchedAt:new Date()}),{code:"SQUARE_SEARCH_PENDING"});});
});
test("API outage and incomplete pagination never mean unpaid",async()=>{
  await usingPayments([],async()=>{await assert.rejects(inspectSquareBeforeClosing(input),{code:"SQUARE_UNAVAILABLE"});},{fail:true});
  await usingPayments([],async()=>{await assert.rejects(inspectSquareBeforeClosing(input),{code:"SQUARE_SEARCH_INCOMPLETE"});},{cursor:"another-page"});
});
test("multiple matching completed payments block closure instead of choosing one",async()=>{
  await usingPayments([payment,{...payment,id:"payment2",order_id:"transaction2"}],async()=>{await assert.rejects(inspectSquareBeforeClosing(input),{code:"SQUARE_CONFLICT"});});
});
test("another KISSa order with the same amount is not automatically matched",async()=>{
  await usingPayments([{...payment,note:"[KISSa:another-order]"}],async()=>assert.deepEqual(await inspectSquareBeforeClosing(input),{kind:"unpaid"}));
});
test("an unmarked same-amount payment stays ambiguous",async()=>{
  await usingPayments([{...payment,note:"",order_id:undefined}],async()=>{await assert.rejects(inspectSquareBeforeClosing(input),{code:"SQUARE_SEARCH_AMBIGUOUS"});});
});

test("missing total amount cannot hide a potentially matching unmarked payment",async()=>{
  for (const amount_money of [{amount:420,currency:"JPY"},undefined]) {
    await usingPayments([{...payment,note:"",order_id:undefined,total_money:undefined,amount_money}],async()=>{
      await assert.rejects(inspectSquareBeforeClosing(input),{code:"SQUARE_SEARCH_AMBIGUOUS"});
    });
  }
});

test("known transactions are read from Square and only terminal unsuccessful payments permit closure",async()=>{
  for (const status of ["COMPLETED","FAILED","CANCELED","APPROVED"]) {
    await usingPayments([],async()=>{
      const result=inspectSquareBeforeClosing({...input,transactionId:"transaction1"});
      if(status==="APPROVED") await assert.rejects(result,{code:"SQUARE_STILL_PENDING"});
      else assert.deepEqual(await result,status==="COMPLETED"?{kind:"completed",transactionId:"transaction1"}:{kind:"unpaid"});
    },{respond:url=>url.includes("/orders/")?{order:{id:"transaction1",location_id:"location1",tenders:[{payment_id:"payment1"}]}}:{payment:{...payment,status}}});
  }
});
