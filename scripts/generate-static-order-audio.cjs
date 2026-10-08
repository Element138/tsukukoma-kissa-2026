// Generate deployment assets, never upload to Blob. Re-running resumes valid files.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadEnvConfig } = require('@next/env');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'public/audio/order-call/numbers/v2');
const LOCK = path.join(ROOT, '.next/cache/static-order-audio.lock');
const VOICE = 'ja-JP-Chirp3-HD-Despina';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function validMp3(audio) {
  // Check every MPEG Layer III frame, not merely a nonempty response.
  let offset = 0;
  if (audio.subarray(0, 3).toString() === 'ID3') {
    if (audio.length < 10) return false;
    offset = 10 + ((audio[6] & 127) << 21) + ((audio[7] & 127) << 14)
      + ((audio[8] & 127) << 7) + (audio[9] & 127);
    if (audio[5] & 16) offset += 10;
  }
  let frames = 0;
  while (offset + 4 <= audio.length) {
    const header = audio.readUInt32BE(offset);
    if ((header >>> 21) !== 2047) return false;
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const rateIndex = (header >>> 12) & 15;
    const sampleIndex = (header >>> 10) & 3;
    if (version === 1 || layer !== 1 || rateIndex === 0 || rateIndex === 15 || sampleIndex === 3) return false;
    const rates = version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const size = Math.floor((version === 3 ? 144 : 72) * rates[rateIndex] * 1000 / sampleRate) + ((header >>> 9) & 1);
    if (offset + size > audio.length) return false;
    offset += size;
    frames++;
  }
  return frames >= 2 && offset === audio.length;
}

function tasks() {
  return Array.from({ length: 2000 }, (_, i) => ['number', 'customer'].map(part => ({
    filename: `${part}-${i + 1}.mp3`,
    text: part === 'number' ? `${i + 1}番。` : `${i + 1}番のお客様。`,
  }))).flat();
}

async function readValid(filename) {
  try {
    const audio = await fs.readFile(path.join(OUTPUT, filename));
    return validMp3(audio) ? audio : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const all = tasks();
  const missing = [];
  for (const task of all) if (!await readValid(task.filename)) missing.push(task);
  console.log(JSON.stringify({ stage: 'inventory', files: all.length, missing: missing.length,
    characters: missing.reduce((sum, task) => sum + [...task.text].length, 0) }));
  if (process.argv.includes('--dry-run')) return;
  if (process.argv.includes('--verify')) {
    if (missing.length) throw new Error(`Verification failed: ${missing.length} missing or invalid files`);
    console.log('All 4000 MP3 files have complete valid MPEG frames.');
    return;
  }
  loadEnvConfig(ROOT);
  const key = (process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (missing.length && !key) throw new Error('Google TTS credential unavailable');
  await fs.mkdir(OUTPUT, { recursive: true });
  await fs.mkdir(path.dirname(LOCK), { recursive: true });
  // Exclusive lock prevents accidentally running two quota-consuming batches.
  const lock = await fs.open(LOCK, 'wx');
  try {
    await lock.writeFile(String(process.pid));
    let interval = 310; // ~194/min, no bursts; Google publishes 200/min for Chirp 3.
    let nextStart = 0;
    let cooldown = 0;
    let gate = Promise.resolve();
    let index = 0;
    let completed = 0;
    let attempts = 0;
    let submittedCharacters = 0;
    let stopError;
    const started = Date.now();
    async function permit() {
      const previous = gate;
      let release;
      gate = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        while (Date.now() < Math.max(nextStart, cooldown)) {
          await sleep(Math.max(nextStart, cooldown) - Date.now());
        }
        if (stopError) throw stopError;
        if (attempts >= 4800 || submittedCharacters >= 40000) throw new Error('Batch retry/character safety budget reached');
        nextStart = Date.now() + interval;
        attempts++;
      } finally { release(); }
    }
    async function generate(task) {
      for (let retry = 0; retry < 6; retry++) {
        await permit();
        submittedCharacters += [...task.text].length;
        let response;
        try {
          response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ input: { text: task.text }, voice: { languageCode: 'ja-JP', name: VOICE },
              audioConfig: { audioEncoding: 'MP3', speakingRate: 1.14, pitch: 0 } }),
            signal: AbortSignal.timeout(30000),
          });
        } catch {
          if (retry === 5) throw new Error('TTS network retry limit');
          await sleep(Math.min(30000, 1000 * 2 ** retry) + Math.random() * 500);
          continue;
        }
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.audioContent) {
          const audio = Buffer.from(payload.audioContent, 'base64');
          if (!validMp3(audio)) throw new Error('TTS returned an invalid or truncated MP3');
          const destination = path.join(OUTPUT, task.filename);
          const temporary = `${destination}.${process.pid}.tmp`;
          await fs.writeFile(temporary, audio, { flag: 'wx' });
          await fs.rename(temporary, destination);
          return;
        }
        if (response.status !== 429 && response.status < 500) throw new Error(`TTS HTTP ${response.status}: ${payload?.error?.status || 'request rejected'}`);
        if (retry === 5) throw new Error(`TTS HTTP ${response.status}: retry limit`);
        const value = response.headers.get('retry-after');
        const serverDelay = value ? (/^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) : 0;
        if (response.status === 429) interval = Math.min(2400, interval * 2);
        const delay = Math.max(Number.isFinite(serverDelay) ? serverDelay : 0, response.status === 429 ? 60000 : 1000 * 2 ** retry);
        cooldown = Math.max(cooldown, Date.now() + delay + Math.random() * 1000);
        console.log(JSON.stringify({ stage: 'backoff', status: response.status, requestsPerMinute: Math.floor(60000 / interval) }));
      }
    }
    async function worker() {
      while (!stopError && index < missing.length) {
        const task = missing[index++];
        try {
          await generate(task);
          completed++;
          if (completed % 100 === 0 || completed === missing.length) console.log(JSON.stringify({
            stage: 'progress', completed, total: missing.length, attempts,
            elapsedSeconds: Math.round((Date.now() - started) / 1000),
          }));
        } catch (error) { stopError = error; }
      }
    }
    await Promise.all(Array.from({ length: 8 }, () => worker()));
    if (stopError) throw stopError;
    const entries = [];
    for (const task of all) {
      const audio = await readValid(task.filename);
      if (!audio) throw new Error(`Final verification failed: ${task.filename}`);
      entries.push({ filename: task.filename, bytes: audio.length, sha256: createHash('sha256').update(audio).digest('hex') });
    }
    await fs.writeFile(path.join(OUTPUT, 'manifest.json'), JSON.stringify({
      voice: VOICE, speakingRate: 1.14, pitch: 0, maxOrderNumber: 2000,
      generatedAt: new Date().toISOString(), files: entries,
    }, null, 2) + '\n');
    console.log(JSON.stringify({ stage: 'verified', files: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), attempts, submittedCharacters }));
  } finally {
    await lock.close();
    await fs.unlink(LOCK);
  }
}

if (require.main === module) main().catch(error => {
  // Never log provider responses or request URLs containing credentials.
  console.error(error.code === 'EEXIST' ? 'Batch lock exists; check for another running generator before retrying.' : error.message);
  process.exitCode = 1;
});
module.exports = { validMp3, tasks };
