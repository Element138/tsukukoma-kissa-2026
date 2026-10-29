export const MENU_COVER_MAX_INPUT_BYTES = 1_000_000;
export const MENU_COVER_MAX_STORED_BYTES = 200_000;

export function normalizeMenuCoverUrl(value: string | null | undefined): string | null {
  const source = value?.trim();
  if (!source) return null;
  try {
    const url = new URL(source, "https://menu-cover.local");
    // Blob is unavailable. Never request its old image URLs.
    if (url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com")) return null;
    if (!["https:", "http:", "data:"].includes(url.protocol)) return null;
    if (url.protocol === "data:" && !/^data:image\/(png|jpeg|webp);base64,/i.test(source)) return null;
    return source;
  } catch { return null; }
}
