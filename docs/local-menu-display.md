# Local Windows menu display

The distribution is a self-contained Windows x64 folder with HTML/JS/CSS, the cafe
logo, local fonts, an initial menu snapshot, and a checksum-verified Node.js LTS
runtime. No npm, Node installation, database credentials, or login is required on
the display PC. All browser requests stay on `http://127.0.0.1:8787/`.

Extract the whole archive into a writable folder. Run `Start-Menu.cmd` to start
the helper and Edge fullscreen, or `Start-Server.cmd` when a screen controller
opens the local URL itself. Run `Stop-Menu.cmd` to stop the helper. The cafe brand
banner stays visible; terminal/status headers and fullscreen buttons are omitted.

The helper attempts a refresh at startup, on page loads, and every 30 seconds.
`GET /api/public/menu-display` supplies only public menu fields, display settings,
and current/future JST last-order times. It is read-only and cached for 15 seconds;
it does not expose orders, actors, audit logs, or write operations. Existing POS,
authenticated display, and admin APIs retain their authorization. Each item's
admin `showOnMenuDisplay` switch defaults to true and filters both display feeds
without changing POS availability.

The viewer and authenticated web page share `MenuDisplayView`, including ordered
category pagination, responsive panels, badges, allergen notices, scrolling and
the last-order overlay. Local update notifications use SSE from the helper; cloud
polling replaces the authenticated application's realtime subscription.

`cache/snapshot.json` is replaced atomically only after validating all fields and
writing every referenced food image. Images are downloaded once by content hash,
validated as WebP, and reused. Failed requests, redirects, malformed data or missing
images retain the last complete snapshot. Restarting the helper checks saved image
integrity; the packaged snapshot remains a fallback. No cache expiry is imposed.
During an outage, availability remains at its last fetched state. Cached closing
times still run in JST; the PC clock must remain correct across offline restarts.

The helper binds to IPv4 loopback, validates Host/Origin, serves an allowlist of
assets, and permits no local write API. Config, snapshots and diagnostic logs are
not directly served. `/health` provides connection status without changing the
normal public screen. Repeated launches reuse the existing helper.

## Build

1. `npm ci`
2. `node scripts/download-menu-runtime.mjs` downloads the official Windows x64
   Node.js 24 LTS ZIP and checks its SHA-256 against the official release list.
   Extract it into `tmp/menu-runtime/extracted/`.
3. `npx tsx scripts/export-menu-display-seed.ts --production-read-only` exports
   only public menu information and food images in a read-only transaction.
4. `node scripts/build-menu-display-pack.mjs --runtime tmp/menu-runtime/extracted/node-v24.VERSION-win-x64`
5. ZIP the generated `output/Kissa-Menu-Windows` folder. Each build requires a
   fresh output directory so an existing user's disk cache cannot be overwritten.

The default `config.json` feed URL points to the production project's public menu
endpoint. Live updates require deployment of this PR to production. Preview
deployments are protected by Vercel Authentication, so the pack deliberately
contains no Preview bypass token or staff credentials. Its bundled snapshot works
offline before the production release. A custom public feed can be selected with
`--feed https://.../api/public/menu-display`.

Tests: `scripts/local-menu-display.test.mjs`, `scripts/public-menu-feed.test.mjs`,
`scripts/menu-display-visibility.test.ts`, and the portrait/branding browser checks.
