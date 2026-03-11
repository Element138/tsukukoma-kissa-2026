import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

async function main() {
  const beverageCategory = await prisma.menuCategory.upsert({
    where: { id: "7cb786af-3743-406f-ab43-0b59595c78b4" },
    create: {
      id: "7cb786af-3743-406f-ab43-0b59595c78b4",
      name: "Beverage",
      displayOrder: 1,
      isActive: true
    },
    update: {
      name: "Beverage",
      displayOrder: 1,
      isActive: true
    }
  });

  const foodCategory = await prisma.menuCategory.upsert({
    where: { id: "f649d8dd-4558-4f78-a0d2-ec2eb877f5e7" },
    create: {
      id: "f649d8dd-4558-4f78-a0d2-ec2eb877f5e7",
      name: "Food",
      displayOrder: 2,
      isActive: true
    },
    update: {
      name: "Food",
      displayOrder: 2,
      isActive: true
    }
  });

  const menus = [
    {
      id: "b7ab2a6b-eb5a-40ed-8eca-cc1dc65db6df",
      name: "Blend Coffee",
      priceJpy: 450,
      workloadSeconds: 180,
      categoryId: beverageCategory.id,
      displayOrder: 1
    },
    {
      id: "bcf1ee6e-7751-4c08-bad8-0a2187f78ea2",
      name: "Iced Tea",
      priceJpy: 480,
      workloadSeconds: 150,
      categoryId: beverageCategory.id,
      displayOrder: 2
    },
    {
      id: "16126f9f-87f9-4f4e-8b41-75560801e984",
      name: "Egg Sandwich",
      priceJpy: 780,
      workloadSeconds: 420,
      categoryId: foodCategory.id,
      displayOrder: 1
    },
    {
      id: "391487fa-8539-40fd-a1cd-e64b212db722",
      name: "Napolitan",
      priceJpy: 980,
      workloadSeconds: 540,
      categoryId: foodCategory.id,
      displayOrder: 2
    }
  ];

  for (const menu of menus) {
    await prisma.menu.upsert({
      where: { id: menu.id },
      create: {
        ...menu,
        availability: "AVAILABLE",
        isActive: true,
        showLeadTime: true
      },
      update: {
        name: menu.name,
        priceJpy: menu.priceJpy,
        workloadSeconds: menu.workloadSeconds,
        categoryId: menu.categoryId,
        displayOrder: menu.displayOrder,
        availability: "AVAILABLE",
        isActive: true,
        showLeadTime: true
      }
    });
  }

  const actors = [
    {
      id: "admin",
      actorType: "ADMIN",
      label: "Admin",
      secret: "admin1234",
      kitchenEnabled: true,
      kitchenDisplayOrder: 0
    },
    {
      id: "pos-main",
      actorType: "POS",
      label: "POS Main",
      secret: "1234",
      kitchenEnabled: true,
      kitchenDisplayOrder: 0
    },
    {
      id: "kitchen-drink",
      actorType: "KITCHEN",
      label: "Drink Kitchen",
      secret: "1234",
      kitchenEnabled: true,
      kitchenDisplayOrder: 1
    },
    {
      id: "kitchen-food",
      actorType: "KITCHEN",
      label: "Food Kitchen",
      secret: "1234",
      kitchenEnabled: true,
      kitchenDisplayOrder: 2
    },
    {
      id: "waiter-1",
      actorType: "WAITER",
      label: "Waiter #1",
      secret: "1234",
      kitchenEnabled: true,
      kitchenDisplayOrder: 0
    },
    {
      id: "menu-display-main",
      actorType: "MENU_DISPLAY",
      label: "Menu Display",
      secret: "1234",
      kitchenEnabled: true,
      kitchenDisplayOrder: 0
    }
  ] as const;

  for (const actor of actors) {
    await prisma.actor.upsert({
      where: { id: actor.id },
      create: {
        id: actor.id,
        actorType: actor.actorType,
        label: actor.label,
        secretHash: hashSecret(actor.secret),
        kitchenEnabled: actor.kitchenEnabled,
        kitchenDisplayOrder: actor.kitchenDisplayOrder,
        isActive: true,
        online: false
      },
      update: {
        actorType: actor.actorType,
        label: actor.label,
        secretHash: hashSecret(actor.secret),
        kitchenEnabled: actor.kitchenEnabled,
        kitchenDisplayOrder: actor.kitchenDisplayOrder,
        isActive: true
      }
    });
  }

  await prisma.menuKitchenAssignment.upsert({
    where: {
      menuId_kitchenId: {
        menuId: "b7ab2a6b-eb5a-40ed-8eca-cc1dc65db6df",
        kitchenId: "kitchen-drink"
      }
    },
    create: {
      menuId: "b7ab2a6b-eb5a-40ed-8eca-cc1dc65db6df",
      kitchenId: "kitchen-drink",
      enabled: true
    },
    update: { enabled: true }
  });

  await prisma.menuKitchenAssignment.upsert({
    where: {
      menuId_kitchenId: {
        menuId: "bcf1ee6e-7751-4c08-bad8-0a2187f78ea2",
        kitchenId: "kitchen-drink"
      }
    },
    create: {
      menuId: "bcf1ee6e-7751-4c08-bad8-0a2187f78ea2",
      kitchenId: "kitchen-drink",
      enabled: true
    },
    update: { enabled: true }
  });

  for (const menuId of ["16126f9f-87f9-4f4e-8b41-75560801e984", "391487fa-8539-40fd-a1cd-e64b212db722"]) {
    await prisma.menuKitchenAssignment.upsert({
      where: {
        menuId_kitchenId: { menuId, kitchenId: "kitchen-food" }
      },
      create: {
        menuId,
        kitchenId: "kitchen-food",
        enabled: true
      },
      update: { enabled: true }
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
