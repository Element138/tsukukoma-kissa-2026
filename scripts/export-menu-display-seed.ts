import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

async function main() {
  if (!process.argv.includes("--production-read-only")) throw new Error("Explicit --production-read-only is required");
  const configured = parse(readFileSync(".env"));
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const url = new URL(configured[key]);
    if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") throw new Error("Production public schema required");
    url.searchParams.set("schema", "public");configured[key] = url.href;
  }
  Object.assign(process.env, configured, { KISSA_TRACE_DB: "0" });
  const { prisma } = await import("../lib/db");
  const { getMenuDisplayData } = await import("../lib/server/menu-display-data");
  try {
    const seed = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      // A pooled connection may inherit a previous client's search_path. Keep
      // unqualified metadata probes local to this read-only transaction.
      await tx.$executeRawUnsafe('SET LOCAL search_path TO "public"');
      const [{ schema, lastOrders }] = await tx.$queryRawUnsafe<Array<{schema:string;lastOrders:boolean}>>(`SELECT current_schema() AS schema, to_regclass('"MenuDisplayLastOrder"') IS NOT NULL AS "lastOrders"`);
      if (schema !== "public") throw new Error("Expected public production schema");
      const [{ visibility }] = await tx.$queryRawUnsafe<Array<{visibility:boolean}>>(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Menu' AND column_name = 'showOnMenuDisplay') AS visibility`);
      const data = await getMenuDisplayData(tx, lastOrders, visibility);
      let images = 0;
      for (const category of data.categories) for (const menu of category.menus) {
        const match = /^\/api\/menu-covers\/([a-f0-9]{64})$/.exec(menu.coverImageDataUrl ?? "");
        if (match) {
          const image = await tx.menuCoverImage.findUnique({ where: { id: match[1] }, select: { bytes: true } });
          menu.coverImageDataUrl = image ? `data:image/webp;base64,${Buffer.from(image.bytes).toString("base64")}` : null;
          if (image) images++;
        } else if (!menu.coverImageDataUrl?.startsWith("data:image/webp;base64,")) menu.coverImageDataUrl = null;
      }
      console.log(JSON.stringify({ readOnly: true, categories: data.categories.length, menus: data.categories.reduce((n, category) => n + category.menus.length, 0), images }));
      return { fetchedAt: new Date().toISOString(), data };
    }, { timeout: 20_000 });
    writeFileSync("tmp/menu-display-seed.json", JSON.stringify(seed));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
