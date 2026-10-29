import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeMenuCoverUrl, MENU_COVER_MAX_STORED_BYTES } from "../lib/menu-cover";
import { compressMenuCover } from "../lib/server/menu-cover-image";

async function main() {
  for (const url of ["https://abc.public.blob.vercel-storage.com/menu-covers/old.jpg", "https://abc.private.blob.vercel-storage.com/x", "https://blob.vercel-storage.com/x"]) assert.equal(normalizeMenuCoverUrl(url), null);
  assert.equal(normalizeMenuCoverUrl(null), null);
  assert.equal(normalizeMenuCoverUrl(" "), null);
  assert.equal(normalizeMenuCoverUrl("javascript:alert(1)"), null);
  assert.equal(normalizeMenuCoverUrl("data:text/html;base64,xxx"), null);
  assert.equal(normalizeMenuCoverUrl(" /api/menu-covers/new "), "/api/menu-covers/new");
  assert.equal(normalizeMenuCoverUrl("https://example.com/image.jpg"), "https://example.com/image.jpg");
  const input = await sharp({ create: { width: 2400, height: 1600, channels: 4, background: { r: 100, g: 140, b: 180, alpha: 0.5 } } }).png().toBuffer();
  const bytes = await compressMenuCover(input);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 1024); assert.equal(metadata.hasAlpha, true);
  assert(bytes.length <= MENU_COVER_MAX_STORED_BYTES);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(compressMenuCover(Buffer.from("not an image")), { code: "INVALID_IMAGE" });
  await assert.rejects(compressMenuCover(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>')), { code: "INVALID_IMAGE" });
  const small = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#334455" } }).jpeg().toBuffer();
  assert.equal((await sharp(await compressMenuCover(small)).metadata()).width, 80);
  console.log("Menu image checks passed: legacy Blob filtering, bounded WebP compression, aspect ratio, transparency, metadata stripping, invalid-image rejection and no upscaling.");
}
main().catch(error => { console.error(error); process.exitCode=1; });
