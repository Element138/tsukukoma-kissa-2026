# KISSa

KISSa is a backend-first cafe operations system based on the v1.1 spec.
The system-of-record is the backend. `Order` and `OrderItem` are strictly separated.

## Stack

- Next.js (App Router, TypeScript)
- Prisma ORM
- PostgreSQL
- Cookie session auth

## Important runtime behavior

- All terminal actions are API + DB transaction based.
- Kitchen processes per `OrderItem`; counter serves customer orders, with dine-in orders handled at order level.
- Undo is limited to each terminal's last 1 action, with optimistic version checks.
- Audit logs are written for critical operations.
- Payment watchdog cron handles timeout/auto-cancel transitions.

## Kitchen ID model (single source)

- Kitchen unit ID is the same as `Actor.id` where `actorType=KITCHEN`.
- There is no separate Kitchen master table and no separate `kitchenId` field on Actor.
- Kitchen registration flow is only `POST /api/admin/actors` with `actorType="KITCHEN"`.
- `/api/admin/kitchens` is removed.

## Environment variables

Set these in Vercel Project Settings -> Environment Variables:

- `DATABASE_URL` (runtime URL: Supabase transaction pooler `:6543` recommended)
- `DIRECT_URL` (direct DB URL for Prisma migrate, non-pooler `:5432`)
- `SESSION_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `SQUARE_APP_ID`
- `SQUARE_CALLBACK_URL`
- `SQUARE_CALLBACK_SIGNING_KEY`
- `CRON_SECRET` (optional, recommended)

## Realtime transport (ops channels)

- `orders`, `counter`, `menus`, and `kitchen:{id}` are delivered via Supabase Realtime.
- `categories`, `actors`, `assignments`, `audit` continue to use SSE in this phase.
- Apply Prisma migrations so `RealtimeEvent` RLS policy and publication wiring are installed.

## Vercel deployment bootstrap

Current build mode is destructive for DB (by request): each deploy applies `prisma db push --accept-data-loss`, reapplies postdeploy SQL guards, then seeds.



This repo now includes:

- Prisma migration files in `prisma/migrations`
- `vercel-build` script: runs db push + postdeploy SQL + seed + build
- `vercel.json` build command: `npm run vercel-build`

So every deploy can prepare DB schema and seed base actors safely.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:seed`
- `npm run prisma:deploy:seed`
- `npm run vercel-build`

## Initial login accounts (seed)

- `admin` / `admin1234`
- `pos-main` / `1234`
- `kitchen-drink` / `1234`
- `kitchen-food` / `1234`
- `counter-1` / `1234`
- `menu-display-main` / `1234`
- `order-display-main` / `1234`

## Health endpoints

- `/api/health` basic app health
- `/api/health/db` DB connectivity + seed readiness hint

If login returns internal error in production, call `/api/health/db` first.

## Typical cause of "Internal server error" at login

Most common causes:

1. DB schema not migrated (missing tables)
2. `DATABASE_URL` or `DIRECT_URL` missing/misconfigured
3. Seed not executed (no actors)

The app now returns clearer DB-related error codes in API responses:

- `DB_NOT_MIGRATED`
- `DB_UNREACHABLE`
- `DB_AUTH_FAILED`
- `SERVER_MISCONFIG`

## Logo placeholder

- Placeholder SVG: `public/logo-placeholder.svg`
- Replace with final brand logo later (`public/logo.svg`) when ready.

## 2026-10-15 提供フローの変更

調理完了はメニューごとの共有在庫として記録し、提供時にアイテム1個につき在庫を1個消費します。キッチンは注文数にかかわらず事前調理できます。本日の注文数と調理完了数は別に管理します。

カウンターには共有在庫で一部でも提供できるすべてのオーダーを表示します。在庫は表示段階では予約しません。呼び出しは確認後の手動操作で、繰り返し実行できます。提供後の呼び出しはオーダーブックからも実行できます。

リリース時には `20261015000100_shared_ready_stock` のマイグレーション適用が必要です。旧バージョンの操作を停止してから適用し、新バージョンへ切り替えてください。移行は既存の提供待ちアイテムを共有在庫へ移し、未提供アイテムに戻します。提供済みアイテムは保持します。旧仕様の取り消し履歴と自動呼び出し猶予設定は削除します。

動作確認: `npx tsx --test scripts/shared-stock.test.ts`

## レシートの書体

Adobe FontsのWeb用キット`jzl2tov`をブラウザーで読み込んでからPDFを生成します。DNP秀英角ゴシック金はL（400）を使用せず、本文をM（500）、メニュー名・見出し・合計・注文番号をB（600）で使います。Noto Sans JPへのフォールバックはRegularとBoldのみを使い、Lightは使用しません。Adobeのフォントファイルをリポジトリに保存しません。

キット・フォントの読み込み失敗、タイムアウト、ブラウザー起動・PDF出力の失敗時は、従来のPDFKitと同梱Noto Sans JPによる生成へ戻ります。Adobe版の描画待ちは20秒、ブラウザー起動待ちは10秒までとし、外部配信の不調で白紙のレシートを返さない構成です。

サーバー用Chromiumに対応するPlaywrightを固定し、デフォルトのブラウザーコンテキストとページを再利用します。同じワーカー内のPDF生成は直列化し、同時発行が互いのブラウザーを終了させないようにします。正常なAdobe版PDFは同じ内容・用紙サイズについて最大15分・32件まで再利用し、Notoへのフォールバックはキャッシュしません。

余白は小が左右各7 mm・上下各8.5 mm、大が左右各5.75 mm・上下各9 mmです。連続・同時発行の実ブラウザー検証は`npx tsx scripts/repeated-receipts.ts`で実行できます。

`npx tsx scripts/preview-receipts.ts --adobe-only`でAdobe版、`--fallback`で読み込み障害を模擬したNoto版を小・大の両サイズで生成できます。自動テストは`npx tsx --test scripts/receipt-rendering.test.ts`で実行します。ローカルのブラウザー実行ファイルは`RECEIPT_CHROMIUM_EXECUTABLE`で指定でき、Windowsではインストール済みChromeまたはEdgeも利用します。
