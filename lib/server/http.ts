import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";

export async function parseJson<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const payload = await req.json().catch(() => {
    throw new AppError(400, "INVALID_JSON", "リクエスト本文の JSON 形式が不正です");
  });

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "入力内容に誤りがあります",
    );
  }

  return parsed.data;
}

export function parseSearchParams<T extends z.ZodTypeAny>(url: URL, schema: T): z.infer<T> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams.entries()) {
    raw[k] = v;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "クエリパラメータに誤りがあります",
    );
  }

  return parsed.data;
}


