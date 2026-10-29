import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Fetch an official Windows x64 LTS runtime and verify its published checksum.
const base = "https://nodejs.org/dist/latest-v24.x/";
const listResponse = await fetch(`${base}SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
if (!listResponse.ok) throw new Error(`Runtime checksums: HTTP ${listResponse.status}`);
const checksums = await listResponse.text();
const match = /^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-x64\.zip)$/m.exec(checksums);
if (!match) throw new Error("No Windows x64 LTS release found");
const [, sha256, filename] = match;
const response = await fetch(`${base}${filename}`, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`Runtime download: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Runtime checksum mismatch");
await mkdir("tmp/menu-runtime", { recursive: true });
await writeFile(`tmp/menu-runtime/${filename}`, bytes);
await writeFile("tmp/menu-runtime/release.json", JSON.stringify({ filename, sha256, source: `${base}${filename}`, directory: filename.slice(0, -4) }, null, 2));
console.log(JSON.stringify({ filename, sha256, bytes: bytes.length }));
