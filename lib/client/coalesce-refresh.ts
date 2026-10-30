// A replay batch must not start one HTTP request per invalidation event.
// Keep one request in flight and one trailing refresh for changes during it.
export function coalesceRefresh(refresh: () => Promise<void>) {
  let inFlight: Promise<void> | null = null;
  let queued = false;
  return function reload(): Promise<void> {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = Promise.resolve().then(async () => {
      do {
        queued = false;
        await refresh();
      } while (queued);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
