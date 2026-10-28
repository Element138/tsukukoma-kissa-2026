import { createHash, createHmac } from "node:crypto";
import { CASHIER_PHOTO_BUCKET, CASHIER_PHOTO_MAX_BYTES } from "@/lib/cashier-photo-policy";
import { AppError } from "@/lib/errors";

export function cashierPhotoBucket() {
  return process.env.CASHIER_PHOTO_BUCKET || CASHIER_PHOTO_BUCKET;
}

function storageRequest(path: string, action: "insert" | "select", objectPath: string, init?: RequestInit) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!url || !key || !secret) throw new AppError(503, "PHOTO_STORAGE_CONFIG", "会計者画像の保存先が設定されていません");
  const at = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    role: "authenticated", aud: "authenticated", iat: at, exp: at + 60,
    sub: objectPath.split("/")[0].split(".")[0],
    cashier_photo_bucket: cashierPhotoBucket(), cashier_photo_path: objectPath, cashier_photo_action: action,
  })}`;
  const token = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  return fetch(`${url}/storage/v1${path}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(8_000),
    headers: { apikey: key, Authorization: `Bearer ${token}`, ...init?.headers },
  });
}

function storagePath(objectPath: string) {
  return `${encodeURIComponent(cashierPhotoBucket())}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

export async function storeCashierPhoto(objectPath: string, bytes: Uint8Array, digest: string) {
  const path = storagePath(objectPath);
  const response = await storageRequest(`/object/${path}`, "insert", objectPath, {
    method: "POST", body: Buffer.from(bytes),
    headers: { "Content-Type": "image/jpeg", "x-upsert": "false", "Cache-Control": "private, no-store" },
  });
  if (response.ok) return;
  // Recover a successful upload whose response/DB commit was lost. Never upsert.
  if ([400, 409].includes(response.status)) {
    const existing = await storageRequest(`/object/authenticated/${path}`, "select", objectPath);
    if (existing.ok && Number(existing.headers.get("content-length") || 0) <= CASHIER_PHOTO_MAX_BYTES) {
      const original = new Uint8Array(await existing.arrayBuffer());
      if (original.length <= CASHIER_PHOTO_MAX_BYTES && createHash("sha256").update(original).digest("hex") === digest) return;
    }
  }
  throw new AppError(503, "PHOTO_STORAGE_UNAVAILABLE", "会計者画像を保存できません。管理者に確認してください");
}

export async function signCashierPhoto(objectPath: string) {
  const response = await storageRequest(`/object/sign/${storagePath(objectPath)}`, "select", objectPath, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }),
  });
  if (!response.ok) throw new AppError(503, "PHOTO_READ_FAILED", "会計者画像を読み込めません");
  const data = await response.json() as { signedURL: string };
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL}/storage/v1${data.signedURL}`;
}
