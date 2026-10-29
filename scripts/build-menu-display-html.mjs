import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { menuDisplayFonts } from "./menu-display-fonts.mjs";
import { validateMenu } from "../standalone/menu-display/contract.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name);return index < 0 ? fallback : args[index + 1]; };
const output = resolve(option("--out", "output/Kissa-Menu-HTML/Menu.html"));
const feed = new URL(option("--feed", "https://tsukukoma-kissa-2026.vercel.app/api/public/menu-display"));
if (feed.protocol !== "https:") throw new Error("HTTPS public feed required");
try { await access(output);throw new Error("Choose a fresh --out file; existing distributions are preserved"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const seed = JSON.parse(await readFile(option("--seed", "tmp/menu-display-seed.json"), "utf8"));
seed.data = validateMenu(seed.data);
for (const category of seed.data.categories) for (const menu of category.menus) if (menu.coverImageDataUrl && !menu.coverImageDataUrl.startsWith("data:image/webp;base64,")) throw new Error("Offline snapshot must embed every food image");
const logo = `data:image/svg+xml;base64,${(await readFile("public/images/cafe-logo.svg")).toString("base64")}`;
const bundle = await build({ entryPoints: ["standalone/menu-display/file-client.tsx"], bundle: true, write: false, minify: true, platform: "browser", format: "iife", jsx: "automatic", target: "es2022", define: { "process.env.NODE_ENV": '"production"' }, legalComments: "inline", metafile: true });
if (Object.keys(bundle.metafile.inputs).some(file => /next\/|supabase|lib\/server|lib\/db|server\.mjs/.test(file.replaceAll("\\", "/")))) throw new Error("Unexpected helper/server/auth dependency");
const config = JSON.stringify({ feedUrl: feed.href, logo, seed }).replaceAll("<", "\\u003c");
const fonts = await menuDisplayFonts();
const theme = require("../tailwind.config.js");
const styles = await postcss([tailwindcss({ ...theme, content: ["./components/menu-display-view.tsx", "./components/dashboard-shell.tsx", "./components/loading-screen.tsx", "./standalone/menu-display/file-client.tsx"] }), autoprefixer]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
const licenses = [
  await readFile(join(dirname(require.resolve("react/package.json")), "LICENSE"), "utf8"),
  await readFile(join(dirname(require.resolve("react-dom/package.json")), "LICENSE"), "utf8"),
  await readFile("standalone/menu-display/licenses/DM-Sans-OFL.txt", "utf8"),
  await readFile("standalone/menu-display/licenses/Zen-Kaku-Gothic-New-OFL.txt", "utf8"),
].join("\n\n").replaceAll("-->", "-- >");
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src ${feed.origin}">
<title>喫茶「翡翠」</title><style>${fonts.css}\n${styles.css}\n.file-menu-last-retrieved{position:fixed;top:8px;right:12px;z-index:20;color:#94a3b8;font-size:clamp(9px,.65vw,14px);font-weight:400;line-height:1.3;pointer-events:none}</style></head>
<body><div id="root"></div><script id="menu-config" type="application/json">${config}</script>
<script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>
<!-- Third-party font and software licenses\n${licenses}\n--></body></html>`;
await mkdir(dirname(output), { recursive: true });await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), embeddedFontFiles: fonts.files, fonts: ["DM Sans", "Zen Kaku Gothic New"], helperRequired: false }));
