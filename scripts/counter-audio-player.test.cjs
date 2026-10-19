const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const timers = new Map();
  const audios = [];
  const urls = new Set();
  let next = 0;
  let fetchImpl = () => new Promise(() => {});
  class Audio {
    src = ''; onended = null; onerror = null; paused = false;
    playCalls = 0;
    playImpl = () => new Promise(() => {});
    constructor() { audios.push(this); }
    play() { this.playCalls++; return this.playImpl(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  const module = { exports: {} };
  const navigator = { audioSession: { type: 'auto' } };
  const source = fs.readFileSync('lib/client/counter-audio.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Audio, navigator, AbortController, DOMException,
    fetch: (...args) => fetchImpl(...args),
    URL: {
      createObjectURL: () => { const url = `blob:audio-${++next}`; urls.add(url); return url; },
      revokeObjectURL: url => urls.delete(url),
    },
    window: {
      setTimeout: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
      clearTimeout: id => timers.delete(id),
    },
  });
  return {
    ...module.exports, audios, timers, urls, navigator,
    setFetch: impl => { fetchImpl = impl; },
    expire: ms => { for (const timer of [...timers.values()]) if (timer.ms === ms) timer.callback(); },
  };
}

test('unlock calls real MP3 playback within the tap and finishes on ended even if play() never settles', async () => {
  const f = fixture(); const player = new f.CounterAudioPlayer();
  const pending = player.unlock();
  assert.equal(f.audios[0].playCalls, 1);
  assert.equal(f.audios[0].src, '/audio/counter-alerts/tone-2.mp3');
  assert.equal(f.navigator.audioSession.type, 'playback');
  f.audios[0].onended(); await pending;
  assert.equal(f.timers.size, 0);
});

test('stalled Safari play rejects within eight seconds, stops media, and allows a fresh retry', async () => {
  const f = fixture(); const player = new f.CounterAudioPlayer();
  let rejectPlay;
  f.audios[0].playImpl = () => new Promise((_, reject) => { rejectPlay = reject; });
  const pending = player.unlock();
  const rejection = assert.rejects(pending, /音声の開始を確認できませんでした/);
  f.expire(8000); await rejection;
  assert.equal(f.audios[0].paused, true);
  assert.equal(f.audios[0].onended, null);
  assert.equal(f.timers.size, 0);
  const rejectOriginal = rejectPlay;
  const retry = player.unlock();
  rejectOriginal(new Error('late failure'));
  f.audios[0].onended(); await retry;
  assert.equal(f.audios[0].playCalls, 2);
  player.dispose();
});

test('play rejection, media error and disposal release pending startup rather than leaving a spinner', async () => {
  for (const failure of ['reject', 'event', 'dispose']) {
    const f = fixture(); const player = new f.CounterAudioPlayer();
    if (failure === 'reject') f.audios[0].playImpl = () => Promise.reject(new Error('NotAllowedError'));
    const pending = player.unlock(); const rejection = assert.rejects(pending);
    if (failure === 'event') f.audios[0].onerror();
    if (failure === 'dispose') player.dispose();
    await rejection; assert.equal(f.timers.size, 0);
  }
});

test('preload has a hard deadline even if fetch ignores abort, and late completion cannot leak a blob URL', async () => {
  const f = fixture(); const player = new f.CounterAudioPlayer();
  let complete; let signal;
  f.setFetch((_, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve; }); });
  const pending = player.preload(['/audio/test.mp3']);
  const rejection = assert.rejects(pending, /タイムアウト/);
  f.expire(20000); await rejection;
  assert.equal(signal.aborted, true);
  complete({ ok: true, headers: { get: () => 'audio/mpeg' }, blob: async () => ({ size: 20 }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.urls.size, 0);
  assert.equal(f.timers.size, 0);
});

test('preloaded alert clips still play serially on the same unlocked media element', async () => {
  const f = fixture(); const player = new f.CounterAudioPlayer();
  const startup = player.unlock(); f.audios[0].onended(); await startup;
  f.setFetch(async () => ({ ok: true, headers: { get: () => 'audio/mpeg' }, blob: async () => ({ size: 20 }) }));
  await player.preload(['/tone.mp3', '/number.mp3']);
  const playback = player.play(['/tone.mp3', '/number.mp3'], new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.audios[0].playCalls, 2);
  f.audios[0].onended();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.audios[0].playCalls, 3);
  f.audios[0].onended(); await playback;
  assert.equal(f.audios.length, 1);
  player.dispose(); assert.equal(f.urls.size, 0);
});
