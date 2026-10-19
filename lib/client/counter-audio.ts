export const COUNTER_AUDIO_START_SOURCE = "/audio/counter-alerts/tone-2.mp3";
export const COUNTER_AUDIO_START_TIMEOUT_MS = 8_000;

// Reuse one media element to retain Safari's user-gesture playback permission.
export class CounterAudioPlayer {
  private audio = new Audio();
  private cache = new Map<string, Promise<string>>();
  private urls = new Map<string, string>();
  private requests = new Set<AbortController>();
  private disposed = false;
  private stopPlayback: (() => void) | null = null;

  unlock() {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try { if (nav.audioSession) nav.audioSession.type = "playback"; } catch { /* Older Safari uses media-element playback. */ }
    // Call play synchronously from the tap, before any fetch/await loses the
    // Safari user gesture. Use a real audible asset instead of a one-sample WAV.
    return this.playSource(COUNTER_AUDIO_START_SOURCE, undefined, COUNTER_AUDIO_START_TIMEOUT_MS,
      "音声の開始を確認できませんでした。Safariを開いたまま、もう一度有効にしてください。");
  }

  private playSource(src: string, signal?: AbortSignal, timeoutMs = 30_000,
    message = "音声を再生できませんでした。もう一度有効にしてください。") {
    if (this.disposed || signal?.aborted) return Promise.reject(new DOMException("Stopped", "AbortError"));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        this.audio.onended = null;
        this.audio.onerror = null;
        this.stopPlayback = null;
        this.audio.pause();
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new DOMException("Stopped", "AbortError"));
      const fail = () => finish(new Error(message));
      const timeout = window.setTimeout(fail, timeoutMs);
      this.stopPlayback = abort;
      this.audio.onended = () => finish();
      this.audio.onerror = fail;
      signal?.addEventListener("abort", abort, { once: true });
      this.audio.src = src;
      try { void this.audio.play().catch(fail); } catch { fail(); }
    });
  }

  private load(src: string) {
    const cached = this.cache.get(src);
    if (cached) return cached;
    const request = new AbortController(); this.requests.add(request);
    let timeout: number;
    const deadline = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        request.abort();
        reject(new Error("音声の読み込みがタイムアウトしました。通信状態を確認して、もう一度有効にしてください。"));
      }, 20_000);
    });
    const download = fetch(src, { cache: "force-cache", signal: request.signal }).then(async response => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("音声を読み込めませんでした");
      const blob = await response.blob();
      if (this.disposed || request.signal.aborted || !blob.size) throw new Error("音声を読み込めませんでした");
      const url = URL.createObjectURL(blob); this.urls.set(src, url);
      return url;
    });
    const promise = Promise.race([download, deadline]).catch(error => { this.cache.delete(src); throw error; }).finally(() => {
      window.clearTimeout(timeout!); this.requests.delete(request);
    });
    this.cache.set(src, promise);
    return promise;
  }

  async preload(sources: readonly string[]) { await Promise.all(sources.map(src => this.load(src))); }

  async play(sources: readonly string[], signal: AbortSignal) {
    // Prepare speech before starting the tone, avoiding a network gap afterward.
    const urls = await Promise.all(sources.map(src => this.load(src)));
    for (const url of urls) {
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      await this.playSource(url, signal);
    }
  }

  prune(keep: ReadonlySet<string>) {
    for (const [src, url] of this.urls) if (!keep.has(src)) {
      URL.revokeObjectURL(url); this.urls.delete(src); this.cache.delete(src);
    }
  }

  dispose() {
    this.disposed = true; this.stopPlayback?.(); this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load();
    for (const request of this.requests) request.abort();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.cache.clear(); this.urls.clear();
  }
}
