import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { createRequire } from "node:module";
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name);return i < 0 ? fallback : args[i + 1]; };
const destination = resolve(option("--out", "output/Kissa-Menu-Windows"));
const feedUrl = option("--feed", "https://tsukukoma-kissa-2026.vercel.app/api/public/menu-display");
const seed = option("--seed", "tmp/menu-display-seed.json");
const runtime = option("--runtime", null);
if (!runtime) throw new Error("--runtime must point to an extracted official Windows x64 Node.js distribution (including LICENSE)");
const feed = new URL(feedUrl);
if (feed.protocol !== "https:" && !(args.includes("--test") && feed.hostname === "127.0.0.1")) throw new Error("HTTPS feed required");
// Refuse to overwrite a previous pack/cache: each build gets a fresh directory.
try { await access(destination);throw new Error("Output directory already exists; choose a fresh --out directory"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(join(destination, "assets"), { recursive: true });
for (const file of ["index.html", "server.mjs", "contract.mjs", "Launch.ps1", "Stop.ps1", "Start-Menu.cmd", "Start-Server.cmd", "Stop-Menu.cmd", "README.txt"]) await cp(`standalone/menu-display/${file}`, join(destination, file));
await mkdir(join(destination, "images"));await cp("public/images/cafe-logo.svg", join(destination, "images/cafe-logo.svg"));
await mkdir(join(destination, "fonts"));
for (const file of ["NotoSansJP-Regular.otf", "NotoSansJP-Bold.otf", "OFL-Noto-Sans-JP.txt"]) await cp(`public/fonts/${file}`, join(destination, "fonts", file));
await mkdir(join(destination, "runtime"));
await cp(join(runtime, "node.exe"), join(destination, "runtime/node.exe"));
await cp(join(runtime, "LICENSE"), join(destination, "runtime/LICENSE.txt"));
await cp(seed, join(destination, "seed.json"));
await writeFile(join(destination, "config.json"), JSON.stringify({ feedUrl: feed.href, port: 8787 }, null, 2));
const result = await build({
  entryPoints: ["standalone/menu-display/client.tsx"], bundle: true, minify: true, platform: "browser", format: "iife", target: "es2022", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, legalComments: "external", metafile: true, outfile: join(destination, "assets/menu.js"),
});
if (Object.keys(result.metafile.inputs).some(path => /next\/|supabase|lib\/server|lib\/db/.test(path.replaceAll("\\", "/")))) throw new Error("Unexpected server/auth dependency in the local viewer");
const tailwind = require("../tailwind.config.js");
const css = await postcss([tailwindcss({ ...tailwind, content: ["./components/menu-display-view.tsx", "./components/dashboard-shell.tsx", "./components/loading-screen.tsx", "./standalone/menu-display/*.{html,tsx}"] }), autoprefixer]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
await writeFile(join(destination, "assets/menu.css"), css.css + "\n" + await readFile("standalone/menu-display/local.css", "utf8"));
const react = require("react/package.json"), reactDOM = require("react-dom/package.json");
await writeFile(join(destination, "assets/THIRD-PARTY.txt"), `React ${react.version}\n${await readFile(join(dirname(require.resolve("react/package.json")), "LICENSE"), "utf8")}\nReact DOM ${reactDOM.version}\n${await readFile(join(dirname(require.resolve("react-dom/package.json")), "LICENSE"), "utf8")}`);
console.log(`Standalone Windows pack built: ${destination}`);
