import type { MenuDisplayPayload } from "../../components/menu-display-view";
import { validateMenu } from "./contract.mjs";

type Snapshot = {
  version: 1;
  data: MenuDisplayPayload;
  images: Record<string, string>;
  clockOffsetMs: number;
  fetchedAt: string;
};
export type FileMenuConfig = {
  feedUrl: string;
  logo: string;
  seed: { data: MenuDisplayPayload; fetchedAt: string };
};

const MAX_IMAGE = 200_000;
const MAX_FEED = 4_000_000;

async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > max) throw new Error("Menu download failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error("Menu download too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length);let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function verifyImage(dataUrl: string, expectedHash?: string) {
  if (!/^data:image\/webp;base64,[a-zA-Z0-9+/]+=*$/.test(dataUrl) || dataUrl.length > 270_000) throw new Error("Invalid saved image");
  const raw = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  if (!raw.length || raw.length > MAX_IMAGE || raw.slice(0, 4) !== "RIFF" || raw.slice(8, 12) !== "WEBP") throw new Error("Invalid WebP");
  if (expectedHash) {
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== expectedHash) throw new Error("Image checksum mismatch");
  }
}

async function toDataUrl(bytes: Uint8Array) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Image conversion failed"));
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: "image/webp" }));
  });
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kissa-menu-file-v1", 1);
    let expired = false;
    const timer = window.setTimeout(() => { expired = true; reject(new Error("Browser storage unavailable")); }, 2000);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots"); };
    request.onsuccess = () => { window.clearTimeout(timer);if (expired) request.result.close();else resolve(request.result); };
    request.onerror = () => { window.clearTimeout(timer);reject(request.error); };
    request.onblocked = () => { window.clearTimeout(timer);expired = true;reject(new Error("Browser storage blocked")); };
  });
}

async function storage(key: string, value?: Snapshot): Promise<Snapshot | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", value ? "readwrite" : "readonly");
      const request = value ? tx.objectStore("snapshots").put(value, key) : tx.objectStore("snapshots").get(key);
      let result: Snapshot | undefined;
      request.onsuccess = () => { result = value ?? request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Browser storage failed"));
    });
  } finally { db.close(); }
}

export function createFileMenuStore(config: FileMenuConfig, onUpdate: () => void) {
  const feed = new URL(config.feedUrl);
  const key = `kissa-menu-file-v1:${feed.href}`;
  let current: Snapshot = { version: 1, data: validateMenu(config.seed.data), images: {}, fetchedAt: config.seed.fetchedAt, clockOffsetMs: 0 };
  let rendered = current.data;
  let inFlight: Promise<void> | null = null;
  let lastRetrievedAt: string | null = null;

  function imageHash(source: string) {
    const url = new URL(source, feed.origin);
    if (url.origin !== feed.origin || url.search || url.hash || !/^\/api\/menu-covers\/[a-f0-9]{64}$/.test(url.pathname)) throw new Error("Unsupported menu image");
    return url.pathname.split("/").at(-1)!;
  }
  async function materialize(snapshot: Snapshot) {
    const result = validateMenu(snapshot.data);
    for (const category of result.categories) for (const menu of category.menus) {
      if (!menu.coverImageDataUrl) continue;
      if (menu.coverImageDataUrl.startsWith("data:")) await verifyImage(menu.coverImageDataUrl);
      else {
        const hash = imageHash(menu.coverImageDataUrl), saved = snapshot.images[hash];
        if (!saved) throw new Error("Incomplete saved menu");
        await verifyImage(saved, hash);
        menu.coverImageDataUrl = saved;
      }
    }
    return result;
  }
  const initialized = (async () => {
    const candidates: Snapshot[] = [];
    try { const saved = await storage(key);if (saved && typeof saved === "object") candidates.push(saved); } catch {}
    try { const raw = localStorage.getItem(key);if (raw) { const saved = JSON.parse(raw);if (saved && typeof saved === "object") candidates.push(saved); } } catch {}
    candidates.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
    for (const saved of candidates) {
      try {
        if (saved.version !== 1 || !Number.isFinite(saved.clockOffsetMs) || !Number.isFinite(Date.parse(saved.fetchedAt)) || !saved.images || typeof saved.images !== "object") throw new Error("Invalid saved menu");
        rendered = await materialize(saved);current = saved;lastRetrievedAt = saved.fetchedAt;onUpdate();return;
      } catch { /* Keep the bundled menu if stored data is incomplete. */ }
    }
    rendered = await materialize(current);
  })();

  async function refresh() {
    await initialized;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20_000);
      const request = { mode: "cors" as const, credentials: "omit" as const, cache: "no-store" as const, redirect: "error" as const, signal: controller.signal };
      try {
        const response = await fetch(feed.href, request);
        const payload = JSON.parse(new TextDecoder().decode(await readLimited(response, MAX_FEED)));
        if (payload.ok !== true) throw new Error("Invalid menu response");
        const data = validateMenu(payload.data);
        const images: Record<string, string> = {};
        const required = new Map<string, string>();
        for (const category of data.categories) for (const menu of category.menus) {
          if (menu.coverImageDataUrl && !menu.coverImageDataUrl.startsWith("data:")) required.set(imageHash(menu.coverImageDataUrl), new URL(menu.coverImageDataUrl, feed.origin).href);
        }
        if (required.size > 250) throw new Error("Too many menu images");
        const entries = Array.from(required.entries());let index = 0, totalBytes = 0;
        await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
          while (index < entries.length) {
            const [hash, url] = entries[index++];
            let image = current.images[hash];
            if (image) { try { await verifyImage(image, hash); } catch { image = ""; } }
            if (!image) {
              // Older immutable image responses may predate the public CORS header.
              const download = new URL(url);download.searchParams.set("viewer", "file-v1");
              image = await toDataUrl(await readLimited(await fetch(download.href, request), MAX_IMAGE));
            }
            await verifyImage(image, hash);
            totalBytes += image.length;
            if (totalBytes > 30_000_000) throw new Error("Menu image cache too large");
            images[hash] = image;
          }
        }));
        const date = Date.parse(response.headers.get("date") ?? "");
        const age = Math.max(0, Number(response.headers.get("age")) || 0) * 1000;
        const next: Snapshot = { version: 1, data, images, fetchedAt: new Date().toISOString(), clockOffsetMs: Number.isFinite(date) ? date + age - Date.now() : current.clockOffsetMs };
        const nextRendered = await materialize(next);
        // One database transaction preserves the previous complete snapshot if a write fails.
        try { await storage(key, next); }
        catch { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Storage-denying controllers still get live data and the bundled offline fallback. */ } }
        rendered = nextRendered;current = next;lastRetrievedAt = next.fetchedAt;onUpdate();
      } catch {
        // Network, validation or image failure leaves the last complete menu visible.
        controller.abort();
      } finally { window.clearTimeout(timer);inFlight = null; }
    })();
    return inFlight;
  }
  return {
    loadData: async (): Promise<MenuDisplayPayload> => { await initialized;return { ...rendered, serverNow: new Date(Date.now() + current.clockOffsetMs).toISOString() }; },
    refresh,
    getLastRetrievedAt: () => lastRetrievedAt,
  };
}
