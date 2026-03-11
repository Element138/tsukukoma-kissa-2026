import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function resolveRuntimeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = new URL(raw);
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

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
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

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}