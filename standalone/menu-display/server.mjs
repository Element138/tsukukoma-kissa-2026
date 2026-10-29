import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const APP_ID = "kissa-local-menu-v1";
const MAX_FEED_BYTES = 4_000_000;
const MAX_IMAGE_BYTES = 200_000;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const text = (value, max = 500) => {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid menu text");
  return value;
};
const optionalText = value => value == null ? null : text(value);
const number = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid menu number");
  return value;
};

// Project onto the display contract. Nothing else from a feed is persisted or served.
export function validateMenu(data) {
  if (!data || !Array.isArray(data.categories) || data.categories.length > 100) throw new Error("Invalid categories");
  let count = 0;
  const categories = data.categories.map(category => {
    if (!Array.isArray(category.menus) || (count += category.menus.length) > 1000) throw new Error("Invalid menu items");
    return {
      id: text(category.id), name: text(category.name),
      customBadgeText: optionalText(category.customBadgeText), customBadgeColor: optionalText(category.customBadgeColor),
      menus: category.menus.map(menu => {
        if (!["AVAILABLE", "INCREASED_WAIT", "PAUSED", "SOLD_OUT"].includes(menu.availability)) throw new Error("Invalid availability");
        if (!Array.isArray(menu.allergens) || menu.allergens.some(key => !["EGG", "MILK", "WHEAT", "SHRIMP", "CRAB", "WALNUT", "PEANUT", "BUCKWHEAT"].includes(key))) throw new Error("Invalid allergens");
        if (typeof menu.allergenDisplayEnabled !== "boolean" || typeof menu.showLowStockBadge !== "boolean") throw new Error("Invalid menu flags");
        return { id: text(menu.id), name: text(menu.name), priceJpy: number(menu.priceJpy), availability: menu.availability,
          coverImageDataUrl: menu.coverImageDataUrl == null ? null : text(menu.coverImageDataUrl, 300_000),
          allergens: menu.allergens, allergenDisplayEnabled: menu.allergenDisplayEnabled,
          customBadgeText: optionalText(menu.customBadgeText), customBadgeColor: optionalText(menu.customBadgeColor),
          showLowStockBadge: menu.showLowStockBadge, remainingUntilCap: menu.remainingUntilCap == null ? null : number(menu.remainingUntilCap) };
      }),
    };
  });
  const seconds = number(data.settings?.pageDisplaySeconds);
  if (seconds < 6 || seconds > 120 || !Array.isArray(data.settings.lastOrders) || data.settings.lastOrders.length > 10000) throw new Error("Invalid settings");
  const lastOrders = data.settings.lastOrders.map(entry => {
    const date = text(entry.date, 10), closesAt = text(entry.closesAt, 40);
    const parsed = new Date(closesAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 9 * 3600_000).toISOString().slice(0, 10) !== date) throw new Error("Invalid closing time");
    return { date, closesAt };
  });
  return { categories, settings: { pageDisplaySeconds: seconds, lastOrders } };
}

async function readLimited(response, limit) {
  if (!response.ok) throw new Error(`Remote HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Response too large");
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > limit) throw new Error("Response too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

export async function startMenuServer({ root, config, port = config.port ?? 8787, open = false, fetchImpl = fetch, pollMs = 30_000, allowHttpFeed = false }) {
  root = resolve(root);
  const feed = new URL(config.feedUrl);
  if ((feed.protocol !== "https:" && !(allowHttpFeed && feed.protocol === "http:" && feed.hostname === "127.0.0.1")) || feed.username || feed.password) throw new Error("An HTTPS public menu feed is required");
  const cacheRoot = join(root, "cache");
  const manifestPath = join(cacheRoot, "snapshot.json");
  const clients = new Set();
  let snapshot = null, inFlight = null, lastAttempt = 0, lastError = null;
  let lastSuccess = null;
  const log = async message => {
    console.log(message);
    // Bound the diagnostic file; it is never part of the display's normal UI.
    try { await atomicWrite(join(cacheRoot, "status.log"), `${new Date().toISOString()} ${message}\n`); } catch {}
  };
  async function imageToDisk(source, fromSeed = false) {
    if (!source) return null;
    let bytes, expectedHash;
    if (/^data:image\/webp;base64,/.test(source)) bytes = Buffer.from(source.split(",")[1], "base64");
    else if (/^\/cache\/images\/[a-f0-9]{64}\.webp$/.test(source)) {
      bytes = await readFile(join(root, source.slice(1))); expectedHash = source.split("/").at(-1).slice(0, -5);
    } else {
      const image = new URL(source, feed.origin);
      if (fromSeed || image.origin !== feed.origin || !/^\/api\/menu-covers\/[a-f0-9]{64}$/.test(image.pathname) || image.search || image.hash) throw new Error("Unsupported food image URL");
      expectedHash = image.pathname.split("/").at(-1);
      const cachedPath = join(cacheRoot, "images", `${expectedHash}.webp`);
      if (existsSync(cachedPath)) {
        bytes = await readFile(cachedPath);
      } else {
        const response = await fetchImpl(image, { signal: AbortSignal.timeout(8_000), redirect: "error" });
        bytes = await readLimited(response, MAX_IMAGE_BYTES);
      }
    }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error("Invalid WebP image");
    const hash = digest(bytes);
    if (expectedHash && hash !== expectedHash) throw new Error("Image integrity mismatch");
    const path = join(cacheRoot, "images", `${hash}.webp`);
    if (!existsSync(path)) await atomicWrite(path, bytes);
    return `/cache/images/${hash}.webp`;
  }
  async function commit(data, metadata, fromSeed = false) {
    const projected = validateMenu(data);
    // Commit the manifest only after every referenced image is available on disk.
    for (const category of projected.categories) for (const menu of category.menus) menu.coverImageDataUrl = await imageToDisk(menu.coverImageDataUrl, fromSeed);
    const next = { version: 1, data: projected, ...metadata };
    await atomicWrite(manifestPath, JSON.stringify(next));
    const changed = !snapshot || JSON.stringify(snapshot.data) !== JSON.stringify(next.data);
    snapshot = next; lastSuccess = next.fetchedAt; lastError = null;
    if (changed) for (const client of clients) client.write("data: updated\n\n");
  }
  async function refresh(force = false) {
    if (inFlight) return inFlight;
    if (!force && Date.now() - lastAttempt < 5_000) return;
    lastAttempt = Date.now();
    inFlight = (async () => {
      try {
        const response = await fetchImpl(feed, { headers: snapshot?.feedUrl === feed.href && snapshot?.etag ? { "If-None-Match": snapshot.etag } : {}, signal: AbortSignal.timeout(8_000), redirect: "error" });
        const date = Date.parse(response.headers.get("date") ?? "");
        const age = Math.max(0, Number(response.headers.get("age")) || 0) * 1000;
        const clockOffsetMs = Number.isFinite(date) ? date + age - Date.now() : snapshot?.clockOffsetMs ?? 0;
        if (response.status === 304) {
          if (!snapshot || snapshot.feedUrl !== feed.href) throw new Error("Unexpected 304");
          await commit(snapshot.data, { fetchedAt: new Date().toISOString(), clockOffsetMs, etag: snapshot.etag, feedUrl: feed.href });
          return;
        }
        const body = JSON.parse((await readLimited(response, MAX_FEED_BYTES)).toString("utf8"));
        if (body.ok !== true) throw new Error("Invalid feed response");
        await commit(body.data, { fetchedAt: new Date().toISOString(), clockOffsetMs, etag: response.headers.get("etag"), feedUrl: feed.href });
      } catch (error) {
        lastError = error.message;
        await log(`Refresh failed; retaining saved menu: ${error.message}`);
      } finally { inFlight = null; }
    })();
    return inFlight;
  }
  const assetTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".otf": "font/otf", ".webp": "image/webp" };
  const server = createServer(async (req, res) => {
    try {
      // Bind and validate loopback; do not expose the disk cache on the LAN or to DNS rebinding.
      const address = server.address();
      const host = `127.0.0.1:${address.port}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) { res.writeHead(403);res.end();return; }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405);res.end();return; }
      const path = new URL(req.url, `http://${host}`).pathname;
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'");
      res.setHeader("Cache-Control", "no-store");
      if (path === "/health") {
        res.setHeader("Content-Type", "application/json");res.end(JSON.stringify({ app: APP_ID, hasSnapshot: Boolean(snapshot), lastSuccess, lastError }));return;
      }
      if (path === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
        res.write(": connected\n\n");clients.add(res);req.on("close", () => clients.delete(res));return;
      }
      if (path === "/api/menu-display") {
        if (!snapshot) await refresh(); else void refresh();
        res.setHeader("Content-Type", "application/json");
        if (!snapshot) { res.writeHead(503);res.end(JSON.stringify({ ok: false }));return; }
        res.end(JSON.stringify({ ok: true, data: { ...snapshot.data, serverNow: new Date(Date.now() + snapshot.clockOffsetMs).toISOString() } }));return;
      }
      const local = path === "/" || path === "/index.html" ? "index.html" : path.slice(1);
      if (!/^(index\.html|assets\/[a-zA-Z0-9._-]+|images\/cafe-logo\.svg|fonts\/[a-zA-Z0-9._-]+|cache\/images\/[a-f0-9]{64}\.webp)$/.test(local)) { res.writeHead(404);res.end();return; }
      const file = join(root, local), extension = local.slice(local.lastIndexOf("."));
      const bytes = await readFile(file);
      res.setHeader("Content-Type", assetTypes[extension] ?? "application/octet-stream");
      if (local.startsWith("cache/images/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { if (!res.headersSent) res.writeHead(404);res.end(); }
  });
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  await new Promise((resolve, reject) => { server.once("error", reject);server.listen(port, "127.0.0.1", resolve); });
  // Acquire the listening port before touching the cache: repeated launches must
  // not introduce another writer while an existing instance is running.
  try {
    const saved = JSON.parse(await readFile(manifestPath, "utf8"));
    if (saved.version !== 1 || !Number.isFinite(saved.clockOffsetMs) || !Number.isFinite(Date.parse(saved.fetchedAt))) throw new Error("Invalid saved snapshot");
    await commit(saved.data, { fetchedAt: saved.fetchedAt, clockOffsetMs: saved.clockOffsetMs, etag: saved.etag ?? null, feedUrl: saved.feedUrl });
  } catch {
    try {
      const seed = JSON.parse(await readFile(join(root, "seed.json"), "utf8"));
      await commit(seed.data, { fetchedAt: seed.fetchedAt, clockOffsetMs: 0, etag: null, feedUrl: null }, true);
    } catch (error) { await log(`No usable initial menu: ${error.message}`); }
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  const timer = setInterval(() => void refresh(), pollMs);
  const heartbeat = setInterval(() => { for (const client of clients) client.write(": keepalive\n\n"); }, 20_000);
  void refresh();
  await log(`Menu display ready at ${origin}`);
  if (open) openBrowser(origin);
  return { origin, refresh: () => refresh(true), close: async () => { clearInterval(timer);clearInterval(heartbeat);for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}

function openBrowser(origin) {
  const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean).map(base => join(base, "Microsoft", "Edge", "Application", "msedge.exe")).find(existsSync);
  if (edge) spawn(edge, ["--kiosk", origin, "--edge-kiosk-type=fullscreen", "--no-first-run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else spawn("rundll32.exe", ["url.dll,FileProtocolHandler", origin], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = dirname(fileURLToPath(import.meta.url));
  try {
    const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
    await startMenuServer({ root, config, open: process.argv.includes("--open") });
  } catch (error) {
    // Repeated launches reuse the running server; they never spawn a second cache writer.
    if (error.code === "EADDRINUSE") {
      const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
      const origin = `http://127.0.0.1:${config.port ?? 8787}`;
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
        if ((await response.json()).app !== APP_ID) throw new Error("Another application uses the configured port");
        if (process.argv.includes("--open")) openBrowser(origin);
      } catch (cause) { console.error(cause.message);process.exitCode = 1; }
    } else { console.error(error.message);process.exitCode = 1; }
  }
}
