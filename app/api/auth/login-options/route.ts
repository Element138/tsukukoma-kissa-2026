import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actors = await prisma.actor.findMany({
      where: {
        isActive: true
      },
      select: {
        id: true,
        actorType: true,
        label: true,
        kitchenDisplayOrder: true
      },
      orderBy: [{ actorType: "asc" }, { kitchenDisplayOrder: "asc" }, { label: "asc" }, { id: "asc" }]
    });

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
