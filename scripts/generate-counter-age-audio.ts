import { loadEnvConfig } from "@next/env";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ORDER_AGE_MINUTES } from "../lib/order-age";
import { synthesizeJapaneseSpeechMp3 } from "../lib/server/google-tts";

async function main() {
  loadEnvConfig(process.cwd());
  const directory = resolve("public/audio/counter-alerts");
  await mkdir(directory, { recursive: true });
  const prompts = ORDER_AGE_MINUTES.map(minutes => ({ file: `elapsed-from-order-${minutes}`, text: `注文から${minutes}分経過。` }));
  for (const prompt of prompts) {
    const destination = resolve(directory, `${prompt.file}.mp3`);
    try { if ((await readFile(destination)).length > 0) continue; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const audio = await synthesizeJapaneseSpeechMp3(prompt.text);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, audio, { flag: "wx" }); await rename(temporary, destination);
    console.log(`Saved ${prompt.file}.mp3 (${audio.length} bytes)`);
  }
}
main().catch((error: { code?: string; status?: number; name?: string; message?: string }) => {
  let message = error.message ?? "";
  for (const key of [process.env.GOOGLE_TTS_API_KEY, process.env.GOOGLE_CLOUD_API_KEY, process.env.GOOGLE_API_KEY]) {
    if (key) message = message.replaceAll(key, "[redacted]");
  }
  console.error("Counter speech generation failed; credentials omitted.", { code: error.code, status: error.status, message });
  process.exitCode = 1;
});
