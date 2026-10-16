import { spawnSync } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const NPX = isWin ? "npx.cmd" : "npx";

function run(cmd, args, env, options = { allowFailure: false }) {
  console.log(`[vercel-build] run: ${cmd} ${args.join(" ")}`);

  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    env
  });

  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result.status ?? 1;
}

function normalizeBuildDbUrl(raw) {
  if (!raw) {
    return undefined;
  }

  try {
    const url = new URL(raw);

    // Reduce deployment-time failures on managed Postgres with strict timeouts.
    url.searchParams.set("statement_timeout", "0");
    url.searchParams.set("lock_timeout", "60000");
    url.searchParams.set("idle_in_transaction_session_timeout", "0");

    const options = url.searchParams.get("options");
    const enforced = "-c statement_timeout=0 -c lock_timeout=60000 -c idle_in_transaction_session_timeout=0";
    if (!options || !options.includes("statement_timeout")) {
      url.searchParams.set("options", options ? `${options} ${enforced}` : enforced);
    }

    return url.toString();
  } catch {
    return raw;
  }
}

// Preview URLs must not modify a shared production database.
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  run(NPX, ["prisma", "generate"], process.env);
  run(NPX, ["next", "build"], process.env);
  process.exit(0);
}

const directUrl = process.env.DIRECT_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!directUrl && !databaseUrl) {
  console.error("Missing DATABASE_URL/DIRECT_URL");
  process.exit(1);
}

const selectedBuildUrl = directUrl ?? databaseUrl;
const buildDbUrl = normalizeBuildDbUrl(selectedBuildUrl);

if (buildDbUrl?.includes("pooler.")) {
  console.warn("[vercel-build] WARNING: build DB URL appears to be pooler host. DIRECT_URL should be non-pooler if available.");
}

const env = {
  ...process.env,
  DATABASE_URL: buildDbUrl,
  DIRECT_URL: buildDbUrl
};

console.log("[vercel-build] Applying migrations without resetting data.");
run(NPX, ["prisma", "generate"], env);
run(NPX, ["prisma", "migrate", "deploy"], env);

const postDeployStatus = run(
  NPX,
  ["prisma", "db", "execute", "--file", "prisma/postdeploy.sql", "--schema", "prisma/schema.prisma"],
  env,
  { allowFailure: true }
);
if (postDeployStatus !== 0) {
  console.error("[vercel-build] postdeploy.sql failed; deployment stopped.");
  process.exit(postDeployStatus);
}

// Seed initial accounts explicitly; deployments must not reset operational settings.
run(NPX, ["next", "build"], process.env);