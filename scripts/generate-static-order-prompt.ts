import { loadEnvConfig } from "@next/env";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { synthesizeJapaneseSpeechMp3 } from "../lib/server/google-tts";

async function main() {
  loadEnvConfig(process.cwd());
  const destination = resolve("public/audio/order-call/extreme-long-wait-apology.mp3");
  try {
    if ((await readFile(destination)).length > 0) {
      console.log("Existing static apology preserved.");
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const audio = await synthesizeJapaneseSpeechMp3("大変長らくお待たせして、申し訳ございませんでした。");
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, audio, { flag: "wx" });
  await rename(temporary, destination);
  console.log(`Static apology saved: ${audio.length} bytes.`);
}
main().catch(() => { console.error("Static apology generation failed."); process.exitCode = 1; });
