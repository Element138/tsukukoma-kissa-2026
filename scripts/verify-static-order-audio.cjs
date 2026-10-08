// Decode the deployment assets with the same browser audio API used for playback.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { tasks, validMp3 } = require('./generate-static-order-audio.cjs');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => { window.audioVerifier = new AudioContext(); });
    const sample = process.argv.includes('--sample');
    const all = sample ? tasks().filter(task => ['number-1.mp3', 'customer-1.mp3', 'number-999.mp3', 'customer-999.mp3'].includes(task.filename)) : [
      ...tasks(), { filename: '../../extreme-long-wait-apology.mp3' },
    ];
    let shortest = Infinity;
    let longest = 0;
    let bytes = 0;
    for (const task of all) {
      const audio = await fs.readFile(path.resolve(__dirname, '../public/audio/order-call/numbers/v2', task.filename));
      if (!validMp3(audio)) throw new Error(`Invalid MPEG frames: ${task.filename}`);
      const result = await page.evaluate(async encoded => {
        const buffer = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const decoded = await window.audioVerifier.decodeAudioData(buffer.buffer);
        let energy = 0;
        let finite = true;
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          for (const value of decoded.getChannelData(channel)) {
            finite = finite && Number.isFinite(value);
            energy += value * value;
          }
        }
        return { duration: decoded.duration, finite, energy, channels: decoded.numberOfChannels };
      }, audio.toString('base64'));
      if (!result.finite || result.energy <= 0 || result.duration <= 0 || result.channels < 1) {
        throw new Error(`Empty or invalid decoded audio: ${task.filename}`);
      }
      bytes += audio.length;
      shortest = Math.min(shortest, result.duration);
      longest = Math.max(longest, result.duration);
    }
    console.log(JSON.stringify({ stage: 'browser-decoded', files: all.length, bytes,
      shortestSeconds: shortest, longestSeconds: longest }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
