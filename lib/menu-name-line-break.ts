export type MenuNameRenderChunk = {
  text: string;
  keepTogether: boolean;
};

const PRIORITY_KEEP_TERMS = [
  "アイス",
  "ホット",
  "ブレンド",
  "コーラ",
  "サンデー",
  "クロック",
  "ムッシュ",
  "コーヒー",
  "ラテ",
  "カフェ",
  "エスプレッソ",
  "アメリカーノ",
  "カプチーノ",
  "モカ",
  "マキアート",
  "フラッペ",
  "スムージー",
  "シェイク",
  "ティー",
  "ミルクティー",
  "レモネード",
  "ソーダ",
  "ジュース",
  "ココア",
  "抹茶",
  "ほうじ茶",
  "紅茶",
  "緑茶",
  "ゆず",
  "レモン",
  "いちご",
  "ストロベリー",
  "ブルーベリー",
  "ラズベリー",
  "マンゴー",
  "ピーチ",
  "バナナ",
  "メロン",
  "パイナップル",
  "オレンジ",
  "アップル",
  "グレープ",
  "ミルク",
  "豆乳",
  "クリーム",
  "ホイップ",
  "チョコ",
  "チョコレート",
  "キャラメル",
  "ハニー",
  "メープル",
  "シロップ",
  "バター",
  "チーズ",
  "クリームチーズ",
  "カスタード",
  "ヨーグルト",
  "ケーキ",
  "タルト",
  "パイ",
  "マフィン",
  "スコーン",
  "ドーナツ",
  "プリン",
  "ゼリー",
  "パフェ",
  "パンケーキ",
  "ワッフル",
  "クレープ",
  "クッキー",
  "ブラウニー",
  "フィナンシェ",
  "マドレーヌ",
  "シフォン",
  "ロールケーキ",
  "ブレンドケーキ",
  "コーラ",
  "サンデー",
  "クロワッサン",
  "デニッシュ",
  "ベーグル",
  "トースト",
  "パン",
  "バゲット",
  "サンド",
  "サンドイッチ",
  "ホットサンド",
  "バーガー",
  "トルティーヤ",
  "ピザ",
  "キッシュ",
  "たまご",
  "エッグ",
  "ベーコン",
  "ハム",
  "ソーセージ",
  "チキン",
  "ツナ",
  "サーモン",
  "アボカド",
  "トマト",
  "レタス",
  "ポテト",
  "コーン",
  "きのこ",
  "あんこ",
  "粒あん",
  "こしあん",
  "きなこ",
  "黒蜜",
  "団子",
  "もち",
  "大福",
  "わらび餅",
];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PRIORITY_KEEP_TERM_REGEX = new RegExp(
  PRIORITY_KEEP_TERMS.map((term) => escapeRegExp(term))
    .sort((a, b) => b.length - a.length)
    .join("|"),
  "g",
);

const LONG_KATAKANA_REGEX = /[ァ-ヶー]{6,}/g;

function splitLongKatakanaChunk(chunk: string) {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < chunk.length) {
    const size = cursor === 0 ? 3 : 4;
    tokens.push(chunk.slice(cursor, cursor + size));
    cursor += size;
  }
  return tokens;
}

function splitByPriorityTerms(text: string) {
  const chunks: MenuNameRenderChunk[] = [];
  const matcher = new RegExp(PRIORITY_KEEP_TERM_REGEX.source, "g");
  let cursor = 0;

  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      chunks.push({ text: text.slice(cursor, start), keepTogether: false });
    }
    chunks.push({ text: match[0], keepTogether: true });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    chunks.push({ text: text.slice(cursor), keepTogether: false });
  }

  return chunks;
}

function splitChunkByLongKatakana(chunk: string) {
  const parts: MenuNameRenderChunk[] = [];
  const matcher = new RegExp(LONG_KATAKANA_REGEX.source, "g");
  let cursor = 0;

  for (const match of chunk.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push({ text: chunk.slice(cursor, start), keepTogether: false });
    }
    for (const token of splitLongKatakanaChunk(match[0])) {
      parts.push({ text: token, keepTogether: false });
    }
    cursor = start + match[0].length;
  }

  if (cursor < chunk.length) {
    parts.push({ text: chunk.slice(cursor), keepTogether: false });
  }

  return parts;
}

export function buildProtectedMenuNameChunks(text: string) {
  return splitByPriorityTerms(text)
    .flatMap((chunk) =>
      chunk.keepTogether ? [chunk] : splitChunkByLongKatakana(chunk.text),
    )
    .filter((chunk) => chunk.text.length > 0);
}
