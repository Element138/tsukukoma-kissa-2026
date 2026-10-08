const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validMp3, tasks } = require('./generate-static-order-audio.cjs');

function frame() {
  // MPEG-2 Layer III, 64 kb/s, 24 kHz: 192 bytes per frame.
  const audio = Buffer.alloc(192);
  audio.set([255, 243, 132, 0]);
  return audio;
}

test('both exact announcement formats are covered for 1 through 2000', () => {
  const all = tasks();
  assert.equal(all.length, 4000);
  assert.equal(new Set(all.map(task => task.filename)).size, 4000);
  assert.deepEqual(all[0], { filename: 'number-1.mp3', text: '1番。' });
  assert.deepEqual(all.at(-1), { filename: 'customer-2000.mp3', text: '2000番のお客様。' });
  assert.equal(all.reduce((sum, task) => sum + [...task.text].length, 0), 29786);
});

test('accept complete MPEG frames and ID3-prefixed MP3s', () => {
  const audio = Buffer.concat([frame(), frame()]);
  assert.equal(validMp3(audio), true);
  const id3 = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
  assert.equal(validMp3(Buffer.concat([id3, audio])), true);
});

test('reject partial files, HTML/error bodies, single frames and trailing junk', () => {
  const audio = Buffer.concat([frame(), frame()]);
  for (const invalid of [Buffer.alloc(0), Buffer.from('Your store is blocked'), frame(),
    audio.subarray(0, audio.length - 1), Buffer.concat([audio, Buffer.from([0])]), Buffer.from('ID3')]) {
    assert.equal(validMp3(invalid), false);
  }
});
