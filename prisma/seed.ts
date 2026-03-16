import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      menuDisplayPageSeconds: 18,
    },
    update: {},
  });

  console.log("Seed completed (master data untouched)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
