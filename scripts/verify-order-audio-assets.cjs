const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function verifyOrderAudioAssets(root = process.cwd(), read = fs.readFileSync) {
  const dir = path.join(root, 'public/audio/order-call/numbers/v2');
  const manifest = JSON.parse(read(path.join(dir, 'manifest.json'), 'utf8'));
  const entries = new Map(manifest.files.map(entry => [entry.filename, entry]));
  if (manifest.maxOrderNumber !== 2000 || manifest.files.length !== 4000 || entries.size !== 4000) {
    throw new Error('Order-number audio manifest must contain both clips for all numbers 1–2000');
  }
  let bytes = 0;
  for (let number = 1; number <= 2000; number++) {
    for (const part of ['number', 'customer']) {
      const filename = `${part}-${number}.mp3`;
      const expected = entries.get(filename);
      if (!expected) throw new Error(`Missing order audio manifest entry: ${filename}`);
      let data;
      try { data = read(path.join(dir, filename)); }
      catch { throw new Error(`Missing order audio asset: ${filename}`); }
      if (data.length !== expected.bytes || createHash('sha256').update(data).digest('hex') !== expected.sha256) {
        throw new Error(`Corrupt order audio asset: ${filename}`);
      }
      bytes += data.length;
    }
  }
  return { verifiedOrderAudioFiles: 4000, bytes };
}

if (require.main === module) {
  try { console.log(JSON.stringify(verifyOrderAudioAssets())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyOrderAudioAssets };
