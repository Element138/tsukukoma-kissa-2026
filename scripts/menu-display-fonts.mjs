import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postcss from "postcss";

// Reuse Next's actual self-hosted font build, including every Japanese subset and
// all configured weights, rather than substituting another Japanese typeface.
export async function menuDisplayFonts() {
  const faces = [], variables = new Map(), files = new Set();
  for (const file of await readdir(".next/static/css")) {
    if (!file.endsWith(".css")) continue;
    const css = await readFile(join(".next/static/css", file), "utf8");
    const root = postcss.parse(css);
    root.walkDecls(decl => { if (["--font-dm-sans", "--font-zen-kaku"].includes(decl.prop)) variables.set(decl.prop, decl.value); });
    root.walkAtRules("font-face", rule => {
      let family = "";
      rule.walkDecls("font-family", decl => { family = decl.value; });
      if (/DM Sans|Zen Kaku Gothic New/.test(family)) faces.push(rule.toString());
    });
  }
  if (variables.size !== 2 || !faces.length) throw new Error("Run npm run build first to generate the web display's exact fonts");
  let css = faces.join("\n");
  const references = [...new Set([...css.matchAll(/url\((?:["'])?\/_next\/static\/media\/([^)'"\s]+)(?:["'])?\)/g)].map(match => match[1]))];
  for (const file of references) {
    if (!/^[a-zA-Z0-9.-]+\.woff2$/.test(file)) throw new Error("Unexpected font asset");
    const data = `data:font/woff2;base64,${(await readFile(join(".next/static/media", file))).toString("base64")}`;
    css = css.replaceAll(`/_next/static/media/${file}`, data);files.add(file);
  }
  if (css.includes("/_next/")) throw new Error("Font assets could not be embedded");
  return { css: css + `\n:root{${[...variables].map(([name, value]) => `${name}:${value}`).join(";")}}`, files: files.size };
}
