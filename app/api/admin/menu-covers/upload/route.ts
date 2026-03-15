import { put } from "@vercel/blob";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";

const MAX_MENU_COVER_FILE_BYTES = 1_000_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function resolveExtension(contentType: string) {
  return EXT_BY_CONTENT_TYPE[contentType] ?? "bin";
}

export async function POST(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new AppError(
        500,
        "BLOB_TOKEN_MISSING",
        "BLOB_READ_WRITE_TOKEN is missing in environment variables",
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new AppError(400, "IMAGE_FILE_REQUIRED", "Image file is required");
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      throw new AppError(
        415,
        "UNSUPPORTED_IMAGE_TYPE",
        "Only PNG/JPEG/WebP images are supported",
      );
    }

    if (file.size <= 0 || file.size > MAX_MENU_COVER_FILE_BYTES) {
      throw new AppError(
        413,
        "IMAGE_TOO_LARGE",
        "Image must be 1MB or smaller",
      );
    }

    const ext = resolveExtension(file.type);
    const pathname = `menu-covers/${crypto.randomUUID()}.${ext}`;
    try {
      const uploaded = await put(pathname, file, {
        token: blobToken,
        access: "private",
        contentType: file.type,
        addRandomSuffix: false,
      });
      return ok({ url: uploaded.url, pathname: uploaded.pathname });
    } catch (error) {
      console.error("menu cover upload to Vercel Blob failed", error);
      throw new AppError(
        502,
        "BLOB_UPLOAD_FAILED",
        error instanceof Error ? error.message : "Blob upload failed",
      );
    }
  } catch (error) {
    return fail(error);
  }
}
