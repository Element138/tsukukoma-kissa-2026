import sharp from "sharp";
import { AppError } from "@/lib/errors";
import { MENU_COVER_MAX_STORED_BYTES } from "@/lib/menu-cover";

export async function compressMenuCover(input: Uint8Array) {
  try {
    const image = sharp(input, { limitInputPixels: 16_000_000, animated: false }).rotate();
    const metadata = await image.metadata();
    if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format)) throw new Error("Unsupported decoded image format");
    for (const [size, quality] of [[1024, 80], [1024, 60], [768, 60], [512, 50]] as const) {
      const bytes = await image.clone().resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer();
      if (bytes.length <= MENU_COVER_MAX_STORED_BYTES) return bytes;
    }
  } catch { throw new AppError(400, "INVALID_IMAGE", "画像を読み込めません。PNG・JPEG・WebPの画像を選択してください"); }
  throw new AppError(413, "IMAGE_TOO_LARGE", "画像を十分に圧縮できません。小さい画像を選択してください");
}
