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
- Kitchen/Waiter process per `OrderItem`, not per `Order`.
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

- `DATABASE_URL` (runtime/pool URL)
- `DIRECT_URL` (direct DB URL for Prisma migrate)
- `SESSION_SECRET`
- `SQUARE_APP_ID`
- `SQUARE_CALLBACK_URL`
- `SQUARE_CALLBACK_SIGNING_KEY`
- `CRON_SECRET` (optional, recommended)

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
- `waiter-1` / `1234`
- `menu-display-main` / `1234`

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
