export const CAMERA_CONNECT_TIMEOUT_MS = 5_000;
export const CAMERA_PREPARE_TIMEOUT_MS = 3_000;

export function checkCameraAbort(signal: AbortSignal) {
  if (signal.aborted) throw new Error("撮影がタイムアウトしました。画像なしで会計を続行できます");
}

export async function withCameraTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("撮影がタイムアウトしました。画像なしで会計を続行できます"));
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), timeout]); }
  finally { clearTimeout(timer); }
}
