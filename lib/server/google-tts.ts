import { AppError } from "@/lib/errors";

const GOOGLE_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const GOOGLE_TTS_VOICE = "ja-JP-Chirp3-HD-Despina";

type GoogleTtsResponse = {
  audioContent?: string;
  error?: {
    message?: string;
  };
};

function getGoogleTtsApiKey() {
  return (
    process.env.GOOGLE_TTS_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();
}

export async function synthesizeJapaneseSpeechMp3(text: string) {
  const apiKey = getGoogleTtsApiKey();
  if (!apiKey) {
    throw new AppError(
      500,
      "GOOGLE_TTS_API_KEY_MISSING",
      "GOOGLE_TTS_API_KEY is missing in environment variables",
    );
  }

  const response = await fetch(`${GOOGLE_TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: "ja-JP",
        name: GOOGLE_TTS_VOICE,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.14,
        pitch: 0,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as GoogleTtsResponse | null;
  if (!response.ok || !payload?.audioContent) {
    throw new AppError(
      502,
      "GOOGLE_TTS_FAILED",
      payload?.error?.message ?? "Google Text-to-Speech request failed",
    );
  }

  return Buffer.from(payload.audioContent, "base64");
}
