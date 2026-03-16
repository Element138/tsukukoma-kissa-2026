import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaQueryLoggerAttached: boolean | undefined;
}

function resolveRuntimeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = new URL(raw);
    const isSupabasePoolerHost = parsed.hostname.includes("pooler.supabase.com");
    const isSessionPoolPort = parsed.port === "" || parsed.port === "5432";

    // Supabase session pool URLs can exhaust backend connections under bursty traffic.
    // Force transaction pooling port at runtime when a Supabase pooler host is used.
    if (isSupabasePoolerHost && isSessionPoolPort) {
      parsed.port = "6543";
    }

    const likelyPooler = parsed.hostname.includes("pooler.") || parsed.port === "6543";

    if (likelyPooler) {
      if (!parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
      }
      if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", "1");
      }
    }

    return parsed.toString();
  } catch {
    return raw;
  }
}

const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl();
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

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
