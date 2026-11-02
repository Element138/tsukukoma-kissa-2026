const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyOrderAudioAssets } = require('./verify-order-audio-assets.cjs');
const cache = new Map();
function cachedRead(file, encoding) {
  const key = file + ':' + (encoding || 'buffer');
  if (!cache.has(key)) cache.set(key, fs.readFileSync(file, encoding));
  return cache.get(key);
}
test('deployment contains every exact manifest clip from 1 through 2000', () => {
  assert.equal(verifyOrderAudioAssets(process.cwd(), cachedRead).verifiedOrderAudioFiles, 4000);
});
test('packaging that drops number-1255 fails before deployment', () => {
  assert.throws(() => verifyOrderAudioAssets(process.cwd(), (file, encoding) => {
    if (path.basename(file) === 'number-1255.mp3') throw new Error('ENOENT');
    return cachedRead(file, encoding);
  }), /Missing order audio asset: number-1255\.mp3/);
});
test('corrupted customer-1255 also blocks the build', () => {
  assert.throws(() => verifyOrderAudioAssets(process.cwd(), (file, encoding) => {
    if (path.basename(file) === 'customer-1255.mp3') return Buffer.from('invalid mp3');
    return cachedRead(file, encoding);
  }), /Corrupt order audio asset: customer-1255\.mp3/);
});
