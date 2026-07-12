import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

type LoginOptionRow = {
  id: string;
  actorType: string;
  label: string;
};

export async function GET() {
  try {
    const actors = await prisma.$queryRaw<LoginOptionRow[]>`
      SELECT "id", "actorType"::text AS "actorType", "label"
      FROM "Actor"
      WHERE "isActive" = true
      ORDER BY "actorType" ASC, "kitchenDisplayOrder" ASC, "label" ASC, "id" ASC
    `;

    return ok({
      actors: actors.map((actor) => ({
        id: actor.id,
        actorType: actor.actorType,
        label: actor.label
      }))
    });
  } catch (error) {
    return fail(error);
  }
}
