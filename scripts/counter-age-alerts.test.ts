import test from "node:test";
import assert from "node:assert/strict";
import { dueCounterAlerts, counterAlertSources, counterOrderNumberSources } from "../lib/counter-age-alerts";
import { orderAgeTone } from "../lib/order-age";

const now = Date.parse("2026-10-17T01:00:00Z");
const order = (id: string, orderNo: number, minutes: number) => ({ id, orderNo, createdAt: new Date(now - minutes * 60_000).toISOString() });

test("colors switch exactly at 10, 25, and 40 minutes", () => {
  assert.equal(orderAgeTone(599),"safe"); assert.equal(orderAgeTone(600),"warn");
  assert.equal(orderAgeTone(1499),"warn"); assert.equal(orderAgeTone(1500),"danger");
  assert.equal(orderAgeTone(2399),"danger"); assert.equal(orderAgeTone(2400),"critical");
});
test("only currently displayed eligible orders generate alerts", () => {
  const displayed=[order("new",1,9.99),order("ten",2,10),order("almost",3,24.99),order("due",4,25)];
  assert.deepEqual(dueCounterAlerts(displayed,now,{}).map(a=>a.orderNo),[4]);
  assert.deepEqual(dueCounterAlerts([],now,{}),[]);
});
test("old orders catch up once at the highest threshold, then advance without repeats", () => {
  const old=order("old",1,26);
  assert.equal(dueCounterAlerts([old],now,{})[0].minutes,25);
  const history={old:{minutes:25,at:now}};
  assert.deepEqual(dueCounterAlerts([old],now,history),[]);
  assert.equal(dueCounterAlerts([old],now+14*60_000,history)[0].minutes,40);
});
test("simultaneous events are ordered deterministically and each has its own tone", () => {
  const due=dueCounterAlerts([order("b",2,25),order("a",1,10),order("c",3,40)],now,{});
  assert.deepEqual(due.map(a=>a.orderNo),[2,3]);
  assert.deepEqual(due.map(a=>counterAlertSources(a)[0]),[2,3].map(i=>`/audio/counter-alerts/tone-${i}.mp3`));
  assert.equal(counterAlertSources(due[0])[2],"/audio/counter-alerts/elapsed-from-order-25.mp3");
});
test("cached order numbers are reused; larger numbers use the existing TTS route", () => {
  assert.deepEqual(counterOrderNumberSources(177),["/audio/order-call/numbers/v2/number-177.mp3"]);
  assert.deepEqual(counterOrderNumberSources(2001),["/api/order-display/audio/number/2001"]);
  assert.throws(()=>counterOrderNumberSources(0));
});
