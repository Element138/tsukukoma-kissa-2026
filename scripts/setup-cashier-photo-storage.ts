import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { CASHIER_PHOTO_BUCKET, CASHIER_PHOTO_MAX_BYTES } from "../lib/cashier-photo-policy";

// Run explicitly after selecting the intended database and bucket. Never deletes data.
const prisma = new PrismaClient();
const bucket = process.env.CASHIER_PHOTO_BUCKET || CASHIER_PHOTO_BUCKET;
if (!/^[a-z0-9-]{3,63}$/.test(bucket)) throw new Error("Invalid cashier photo bucket name");
const suffix = createHash("sha256").update(bucket).digest("hex").slice(0, 12);

async function main() {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (${bucket}, ${bucket}, false, ${CASHIER_PHOTO_MAX_BYTES}, ARRAY['image/jpeg'])
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = ${CASHIER_PHOTO_MAX_BYTES}, allowed_mime_types = ARRAY['image/jpeg']`;
    const scope = `bucket_id = '${bucket}' AND (SELECT auth.jwt()->>'cashier_photo_bucket') = '${bucket}' AND (SELECT auth.jwt()->>'cashier_photo_path') = name`;
    const policies = [
      { name: `cashier_photo_insert_${suffix}`, sql: `AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (${scope} AND (SELECT auth.jwt()->>'cashier_photo_action') = 'insert')` },
      { name: `cashier_photo_select_${suffix}`, sql: `AS PERMISSIVE FOR SELECT TO authenticated USING (${scope} AND (SELECT auth.jwt()->>'cashier_photo_action') = 'select')` },
      // Restrictive policies also protect this bucket when another application's permissive policies are broad.
      { name: `cashier_photo_guard_insert_${suffix}`, sql: `AS RESTRICTIVE FOR INSERT TO public WITH CHECK (bucket_id <> '${bucket}' OR (${scope} AND (SELECT auth.jwt()->>'cashier_photo_action') = 'insert'))` },
      { name: `cashier_photo_guard_select_${suffix}`, sql: `AS RESTRICTIVE FOR SELECT TO public USING (bucket_id <> '${bucket}' OR (${scope} AND (SELECT auth.jwt()->>'cashier_photo_action') = 'select'))` },
      { name: `cashier_photo_guard_update_${suffix}`, sql: `AS RESTRICTIVE FOR UPDATE TO public USING (bucket_id <> '${bucket}') WITH CHECK (bucket_id <> '${bucket}')` },
      { name: `cashier_photo_guard_delete_${suffix}`, sql: `AS RESTRICTIVE FOR DELETE TO public USING (bucket_id <> '${bucket}')` },
    ];
    for (const policy of policies) {
      await tx.$executeRawUnsafe(`DROP POLICY IF EXISTS "${policy.name}" ON storage.objects`);
      await tx.$executeRawUnsafe(`CREATE POLICY "${policy.name}" ON storage.objects ${policy.sql}`);
    }
  });
  console.log(`Private bucket ${bucket} configured: insert/read only, maximum ${CASHIER_PHOTO_MAX_BYTES} bytes, no expiry.`);
}
main().catch(() => { console.error("Could not configure the cashier photo bucket. Check database privileges."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
