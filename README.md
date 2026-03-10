# KISSa

KISSa は、要件定義 Version 1.1 (2026-03-10) を元にした **Backend 正本** のカフェ運用システムです。  
`Order` と `OrderItem` を分離し、調理・配膳は item 単位、会計・受取は order 単位で扱います。

## 技術構成

- Next.js App Router (TypeScript)
- Prisma ORM
- PostgreSQL (本番想定)
- Cookie セッション認証 (端末IDログイン、10分タイムアウト)
- 監査ログ + ハッシュチェーン
- 端末別 Undo (最後の1操作のみ)

## 主要機能

- POS: 注文入力、決済開始、Square App Switch 深リンク生成、決済スキップ理由記録
- Kitchen: ライン別 queued item 表示、ready、Undo、ライン有効/無効、強制再割当
- Waiter: dine-in ready item 配膳、takeout 全品ready時の受渡、Undo
- Menu Display: カテゴリ別メニュー、価格、30分中央値リードタイム表示
- Order Book: 検索/フィルタ、CSV、特記事項編集、再印字stub
- Admin: メニュー/カテゴリ/ライン/割当/端末ID管理、強制ログアウト、一括削除
- Audit Log: 全重要操作記録、フィルタ、CSV

## データ永続化

- `DATABASE_URL` を PostgreSQL に接続して利用
- Prisma schema: [`prisma/schema.prisma`](./prisma/schema.prisma)

## 起動手順

1. 依存導入

```bash
npm install
```

2. 環境変数設定

```bash
cp .env.example .env
```

3. マイグレーション・Seed

```bash
npx prisma migrate dev --name init
npm run prisma:seed
```

4. 開発起動

```bash
npm run dev
```

## 初期ログイン

- admin / `admin1234`
- pos-main / `1234`
- kitchen-drink-1 / `1234`
- kitchen-food-1 / `1234`
- waiter-1 / `1234`
- menu-display-main / `1234`

## Vercel デプロイ前提

1. Vercel にプロジェクト連携
2. `DATABASE_URL` など環境変数を Vercel Project Settings に設定
3. `vercel.json` の cron で `/api/cron/payment-watchdog` を毎分実行
4. `npx prisma migrate deploy` を Build/Deploy フローで実行

### クレジットカード登録必須でないストレージ候補

- Supabase Postgres (無料枠)
- Neon Postgres (無料枠)
- Turso (libSQL) は Prisma 構成変更で利用可能

注: プラン要件は時期により変わるため、契約前に「カード必須でないこと」を最終確認してください。

## API 主要エンドポイント

- Auth: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Orders: `/api/orders`, `/api/orders/:id/confirm`, `/api/orders/:id/cancel`, `/api/orders/:id/note`
- Kitchen: `/api/kitchen/queue`, `/api/kitchen/items/:id/ready`, `/api/kitchen/line/toggle`, `/api/kitchen/reassign`
- Waiter: `/api/waiter/targets`, `/api/waiter/serve-item`, `/api/waiter/serve-order`
- Undo: `/api/undo`
- Order Book: `/api/order-book`, `/api/order-book/export`
- Audit: `/api/audit`, `/api/audit/export`
- Admin: `/api/admin/*`
- Square callback: `/api/square/callback`

## 実運用前に「最後に書き足し」必須の箇所

以下は実機・本番環境に合わせた最終追記/置換が必要です。

1. Square関連
- `SQUARE_APP_ID`, `SQUARE_CALLBACK_URL`, `SQUARE_CALLBACK_SIGNING_KEY` の本番値
- App Switch payload の厳密項目（Square仕様と審査要件に合わせる）
- callback の署名検証方式と失敗時再送設計
- 決済失敗/タイムアウト時の運用ルール（誰がどこで再試行するか）

2. プリンター関連
- `RECEIPT_PRINTER_MODE=stub` を実プリンタ実装に置換
- iPad + レシートプリンタ接続方式（AirPrint / メーカーSDK / 中継サーバ）
- レシートレイアウト最終仕様（takeout注文番号の大型印字、フォント、紙幅）
- 再印字権限・監査ログ粒度

3. ストレージ/DB関連
- 本番DBの選定・バックアップ・PITR(時点復旧)の有効化
- 接続プール設定（Vercel関数実行特性に合わせる）
- 監査ログ/注文履歴の保持期間とアーカイブ方針
- 運用監視（DB容量、遅延、失敗率）

4. ネットワーク/可用性関連
- 店舗ネットワーク断時の運用フロー（仕様上オフライン操作は反映しない）
- 端末監視しきい値（offline判定秒数）
- iPad固定運用のMDM/キオスク設定

5. セキュリティ関連
- 端末secret配布・ローテーション手順
- 監査ログの外部保管（改ざん検知の二重化）
- 管理操作（purge等）の多段承認有無

## ロゴ

ロゴはプレースホルダー表示済み。  
本番では `public/logo.svg` を配置し、UIのプレースホルダーを差し替えてください。

