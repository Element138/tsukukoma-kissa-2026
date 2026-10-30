import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeDatabaseUrl } from "../lib/runtime-database-url";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("Supabase runtime uses transaction pooling with one short-lived idle connection", () => {
  for (const port of ["", ":5432", ":6543"]) {
    const url = new URL(resolveRuntimeDatabaseUrl(`postgresql://user:password@aws-1-region.pooler.supabase.com${port}/postgres?sslmode=require&connection_limit=25&max_idle_connection_lifetime=300`)!);
    assert.equal(url.port, "6543");
    assert.equal(url.searchParams.get("connection_limit"), "1");
    assert.equal(url.searchParams.get("max_idle_connection_lifetime"), "10");
    assert.equal(url.searchParams.get("pgbouncer"), "true");
    assert.equal(url.searchParams.get("sslmode"), "require");
    assert.equal(url.username, "user");
    assert.equal(url.password, "password");
    assert.equal(url.pathname, "/postgres");
  }
});

test("direct connections and missing/invalid configuration are preserved", () => {
  const direct = "postgresql://user:password@db.example.com:5432/postgres?connection_limit=3";
  assert.equal(resolveRuntimeDatabaseUrl(direct), direct);
  assert.equal(resolveRuntimeDatabaseUrl(undefined), undefined);
  assert.equal(resolveRuntimeDatabaseUrl("invalid"), "invalid");
});

test("production route module reloads share one Prisma connection pool", () => {
  let clients = 0;
  const sharedGlobal = {};
  class FakePrismaClient { constructor() { clients += 1; } }
  const source = readFileSync(new URL("../lib/db.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const load = () => {
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(compiled, {
      exports, global: sharedGlobal,
      process: { env: { NODE_ENV: "production", KISSA_TRACE_DB: "0" } },
      require: (id: string) => id === "@prisma/client" ? { PrismaClient: FakePrismaClient } : { resolveRuntimeDatabaseUrl },
    });
    return exports.prisma;
  };
  assert.equal(load(), load());
  assert.equal(clients, 1);
});
