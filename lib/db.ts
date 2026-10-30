import { PrismaClient } from "@prisma/client";
import { resolveRuntimeDatabaseUrl } from "@/lib/runtime-database-url";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaQueryLoggerAttached: boolean | undefined;
}

const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl(process.env.DATABASE_URL);
const traceDbQueries = process.env.KISSA_TRACE_DB !== "0";

const prismaLogs = traceDbQueries
  ? ([
      { emit: "event", level: "query" as const },
      { emit: "stdout", level: "error" as const },
      { emit: "stdout", level: "warn" as const }
    ] as const)
  : (process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]);

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: prismaLogs as any,
    ...(runtimeDatabaseUrl
      ? {
          datasources: {
            db: {
              url: runtimeDatabaseUrl
            }
          }
        }
      : {})
  });

if (traceDbQueries && !global.prismaQueryLoggerAttached) {
  (prisma as any).$on("query", (e: any) => {
    const compactQuery = e.query.replace(/\s+/g, " ").slice(0, 500);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "db-query",
        durationMs: e.duration,
        target: e.target,
        query: compactQuery
      })
    );
  });
  global.prismaQueryLoggerAttached = true;
}

// Reuse one pool across route bundles in warm production processes too.
global.prisma = prisma;
