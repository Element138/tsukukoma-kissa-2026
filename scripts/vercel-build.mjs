import { spawnSync } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const NPX = isWin ? "npx.cmd" : "npx";

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const directUrl = process.env.DIRECT_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!directUrl && !databaseUrl) {
  console.error("Missing DATABASE_URL/DIRECT_URL");
  process.exit(1);
}

// Build-time DB operations must target one URL to avoid mismatch between schema sync and seed.
const buildDbUrl = directUrl ?? databaseUrl;
const env = {
  ...process.env,
  DATABASE_URL: buildDbUrl,
  DIRECT_URL: buildDbUrl
};

console.log("[vercel-build] Schema sync mode: prisma db push --accept-data-loss (destructive changes allowed).");
run(NPX, ["prisma", "generate"], env);
run(NPX, ["prisma", "db", "push", "--accept-data-loss", "--skip-generate"], env);
run(NPX, ["prisma", "db", "execute", "--file", "prisma/postdeploy.sql", "--schema", "prisma/schema.prisma"], env);
run(NPX, ["prisma", "db", "seed"], env);
run(NPX, ["next", "build"], process.env);