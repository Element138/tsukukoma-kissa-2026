import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const actorCount = await prisma.actor.count();
    const lineCount = await prisma.line.count();

    return ok({
      db: "ok",
      actorCount,
      lineCount,
      seedLikelyMissing: actorCount === 0
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "DB_NOT_MIGRATED",
            message: "Tables are missing. Run prisma migrate deploy."
          }
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    return fail(error);
  }
}
