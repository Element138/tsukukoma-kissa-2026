import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../lib/crypto";

const prisma = new PrismaClient();

const baseActors = [
  {
    id: "admin",
    actorType: "ADMIN" as const,
    label: "管理者",
    secret: "admin1234",
    kitchenDisplayOrder: 0,
  },
  {
    id: "pos-main",
    actorType: "POS" as const,
    label: "POS",
    secret: "1234",
    kitchenDisplayOrder: 0,
  },
  {
    id: "kitchen-drink",
    actorType: "KITCHEN" as const,
    label: "ドリンク",
    secret: "1234",
    kitchenDisplayOrder: 0,
  },
  {
    id: "kitchen-food",
    actorType: "KITCHEN" as const,
    label: "フード",
    secret: "1234",
    kitchenDisplayOrder: 1,
  },
  {
    id: "counter-1",
    actorType: "WAITER" as const,
    label: "カウンター",
    secret: "1234",
    kitchenDisplayOrder: 0,
  },
  {
    id: "menu-display-main",
    actorType: "MENU_DISPLAY" as const,
    label: "メニュー表示",
    secret: "1234",
    kitchenDisplayOrder: 0,
  },
  {
    id: "order-display-main",
    actorType: "ORDER_DISPLAY" as const,
    label: "注文表示",
    secret: "1234",
    kitchenDisplayOrder: 0,
  },
];

async function main() {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      menuDisplayPageSeconds: 18,
      counterReadyGraceMinutes: 3,
    },
    update: {},
  });

  for (const actor of baseActors) {
    await prisma.actor.upsert({
      where: { id: actor.id },
      create: {
        id: actor.id,
        actorType: actor.actorType,
        label: actor.label,
        secretHash: hashSecret(actor.secret),
        isActive: true,
        kitchenEnabled: actor.actorType === "KITCHEN",
        kitchenDisplayOrder: actor.kitchenDisplayOrder,
      },
      update: {
        actorType: actor.actorType,
        label: actor.label,
        isActive: true,
        kitchenEnabled: actor.actorType === "KITCHEN",
        kitchenDisplayOrder: actor.kitchenDisplayOrder,
      },
    });
  }

  console.log("Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
