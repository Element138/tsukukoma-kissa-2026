const SILENT_WAV = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

// Reuse one media element to retain Safari's user-gesture playback permission.
export class CounterAudioPlayer {
  private audio = new Audio();
  private cache = new Map<string, Promise<string>>();
  private urls = new Map<string, string>();
  private requests = new Set<AbortController>();
  private disposed = false;

  async unlock() {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try { if (nav.audioSession) nav.audioSession.type = "playback"; } catch { /* Older Safari uses media-element playback. */ }
    this.audio.src = SILENT_WAV;
    await this.audio.play(); this.audio.pause();
  }

  private load(src: string) {
    const cached = this.cache.get(src);
    if (cached) return cached;
    const request = new AbortController(); this.requests.add(request);
    const timeout = window.setTimeout(() => request.abort(), 20_000);
    const promise = fetch(src, { cache: "force-cache", signal: request.signal }).then(async response => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("音声を読み込めませんでした");
      const blob = await response.blob();
      if (this.disposed || !blob.size) throw new Error("音声を読み込めませんでした");
      const url = URL.createObjectURL(blob); this.urls.set(src, url);
      return url;
    }).catch(error => { this.cache.delete(src); throw error; }).finally(() => {
      window.clearTimeout(timeout); this.requests.delete(request);
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
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          window.clearTimeout(timeout); signal.removeEventListener("abort", abort);
          this.audio.onended = null; this.audio.onerror = null;
        };
        const abort = () => { this.audio.pause(); cleanup(); reject(new DOMException("Stopped", "AbortError")); };
        const fail = () => { this.audio.pause(); cleanup(); reject(new Error("音声を再生できませんでした。もう一度有効にしてください。")); };
        const timeout = window.setTimeout(fail, 30_000);
        this.audio.onended = () => { cleanup(); resolve(); };
        this.audio.onerror = fail; signal.addEventListener("abort", abort, { once: true });
        this.audio.src = url; void this.audio.play().catch(fail);
      });
    }
  }

  prune(keep: ReadonlySet<string>) {
    for (const [src, url] of this.urls) if (!keep.has(src)) {
      URL.revokeObjectURL(url); this.urls.delete(src); this.cache.delete(src);
    }
  }

  dispose() {
    this.disposed = true; this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load();
    for (const request of this.requests) request.abort();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.cache.clear(); this.urls.clear();
  }
}
