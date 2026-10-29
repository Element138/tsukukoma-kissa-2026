import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { Prisma } from "@prisma/client";

async function main() {
  Object.assign(process.env, parse(readFileSync(".env.local")), { KISSA_TRACE_DB: "0" });
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("schema"), "kissa_cashier_photo_preview");
  const { prisma } = await import("../lib/db");
  const { fail } = await import("../lib/response");
  const suffix = randomUUID().replaceAll("-", "");
  const production = `guard_test_${suffix}`, shadow = `guard_shadow_${suffix}`;
  const fixed = readFileSync("prisma/postdeploy.sql", "utf8");
  const legacy = fixed.replaceAll('::"public"."ActorType"', '::"ActorType"').replaceAll(' SET search_path = pg_catalog, public', '');
  const rollback = new Error("ROLLBACK_TEST_SCHEMAS");
  let reproduced = false, repaired = false;
  try {
    await prisma.$transaction(async tx => {
      const sql = async (query:string) => { if (/"public"\./.test(query)) throw new Error("Test must never touch public objects");return tx.$executeRawUnsafe(query); };
      for (const schema of [production, shadow]) {
        await sql(`CREATE SCHEMA "${schema}"`);
        await sql(`CREATE TYPE "${schema}"."ActorType" AS ENUM ('KITCHEN','POS')`);
      }
      await sql(`CREATE TABLE "${production}"."Actor" ("id" TEXT PRIMARY KEY, "actorType" "${production}"."ActorType" NOT NULL)`);
      await sql(`CREATE TABLE "${production}"."MenuKitchenAssignment" ("kitchenId" TEXT)`);
      await sql(`CREATE TABLE "${production}"."OrderItem" ("kitchenId" TEXT)`);
      await sql(`INSERT INTO "${production}"."Actor" VALUES ('kitchen','KITCHEN'),('pos','POS')`);
      await sql(`SET LOCAL search_path TO "${production}"`);
      async function install(source:string) {
        const adapted=source.replaceAll('"public"',`"${production}"`).replaceAll('pg_catalog, public',`pg_catalog, "${production}"`);
        // Split only outside dollar-quoted function bodies.
        const statements=adapted.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$ LANGUAGE plpgsql[^;]*;|(?:DROP|CREATE) TRIGGER[\s\S]*?;/g)!;
        assert.equal(statements.length,8);
        for (const statement of statements) await sql(statement);
      }
      await install(legacy);
      await sql(`SET LOCAL search_path TO "${shadow}", "${production}"`);
      await sql("SAVEPOINT broken_guard");
      try { await sql(`INSERT INTO "${production}"."MenuKitchenAssignment" VALUES ('kitchen')`); }
      catch(error) { assert.match(String(error),/operator does not exist/);reproduced=true; }
      assert(reproduced,"Legacy guard must reproduce production's enum mismatch");
      await sql("ROLLBACK TO SAVEPOINT broken_guard");
      await install(fixed);
      for (const path of [`"${shadow}", "${production}"`,`"${production}", "${shadow}"`]) {
        await sql(`SET LOCAL search_path TO ${path}`);
        await sql(`INSERT INTO "${production}"."MenuKitchenAssignment" VALUES ('kitchen')`);
        await sql(`UPDATE "${production}"."MenuKitchenAssignment" SET "kitchenId"='kitchen'`);
        await sql(`INSERT INTO "${production}"."OrderItem" VALUES ('kitchen')`);
        await sql(`UPDATE "${production}"."Actor" SET "actorType"='KITCHEN' WHERE "id"='kitchen'`);
        for (const query of [
          `INSERT INTO "${production}"."MenuKitchenAssignment" VALUES ('pos')`,
          `INSERT INTO "${production}"."OrderItem" VALUES ('pos')`,
          `UPDATE "${production}"."Actor" SET "actorType"='POS' WHERE "id"='kitchen'`,
        ]) {
          await sql("SAVEPOINT invalid_actor");
          await assert.rejects(()=>sql(query),/must reference Actor|must remain actorType/);
          await sql("ROLLBACK TO SAVEPOINT invalid_actor");
        }
      }
      repaired=true;throw rollback;
    }, { timeout:30_000 });
  } catch(error) { if(error!==rollback)throw error; }
  assert(reproduced&&repaired);
  const schemas=await prisma.$queryRawUnsafe<unknown[]>(`SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('${production}','${shadow}')`);
  assert.equal(schemas.length,0,"Test schemas must be rolled back completely");
  const originalError=console.error;console.error=()=>{};
  try {
    for(const [message,status,code]of [
      ['PostgresError { code: "42883", message: "operator does not exist: public.ActorType = ActorType" }',503,"DB_SCHEMA_MISMATCH"],
      ['canceling statement due to statement timeout (57014)',503,"DB_TIMEOUT"],
      ['unclassified database error',500,"DB_QUERY_FAILED"],
    ] as const){
      const response=fail(new Prisma.PrismaClientUnknownRequestError(message,{clientVersion:Prisma.prismaVersion.client}));
      assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);
    }
  } finally { console.error=originalError;await prisma.$disconnect(); }
  console.log("Kitchen guard regression passed: exact legacy enum error reproduced; fixed functions work with shadow/public search paths; invalid actor writes still rejected; scratch schemas rolled back; schema errors no longer labeled timeouts.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
