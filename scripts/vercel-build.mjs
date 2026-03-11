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

// For build-time DB operations, force one URL to avoid migrate/seed targeting different DBs.
const buildDbUrl = directUrl ?? databaseUrl;
const env = {
  ...process.env,
  DATABASE_URL: buildDbUrl,
  DIRECT_URL: buildDbUrl
};

console.log("[vercel-build] Using destructive DB reset mode (data will be dropped).");
run(NPX, ["prisma", "generate"], env);
run(NPX, ["prisma", "migrate", "reset", "--force", "--skip-generate", "--skip-seed"], env);
run(NPX, ["prisma", "db", "seed"], env);
run(NPX, ["next", "build"], process.env);