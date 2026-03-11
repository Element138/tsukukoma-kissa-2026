export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ApiFetchInit = RequestInit & {
  timeoutMs?: number;
  retry?: number;
};

const TRANSIENT_CODES = new Set([
  "REQUEST_TIMEOUT",
  "NETWORK_ERROR",
  "DB_UNAVAILABLE",
  "DB_UNREACHABLE",
  "DB_POOL_TIMEOUT",
  "DB_TIMEOUT",
  "INTERNAL_ERROR",
]);

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return (
    TRANSIENT_STATUS.has(error.status) ||
    (error.code ? TRANSIENT_CODES.has(error.code) : false)
  );
}

export async function apiFetch<T>(
  input: string,
  init?: ApiFetchInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const maxAttempts = init?.retry ?? (method === "GET" ? 2 : 1);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = init?.timeoutMs ?? 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const code = json?.error?.code;
        const baseMessage =
          json?.error?.message ?? `Request failed: ${res.status}`;
        const message = code ? `${baseMessage} (${code})` : baseMessage;
        throw new ApiError(res.status, message, code);
      }

      return json.data as T;
    } catch (error) {
      let normalized: unknown = error;

      if (error instanceof DOMException && error.name === "AbortError") {
        normalized = new ApiError(
          408,
          "Request timed out (REQUEST_TIMEOUT)",
          "REQUEST_TIMEOUT",
        );
      } else if (!(error instanceof ApiError)) {
        normalized = new ApiError(
          0,
          "Network error (NETWORK_ERROR)",
          "NETWORK_ERROR",
        );
      }

      lastError = normalized;
      if (attempt < maxAttempts && isRetryableError(normalized)) {
        await sleep(250 * attempt);
        continue;
      }

      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError(500, "Unknown request error");
}

export function isAuthError(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 401 || error.status === 403)
  );
}

export function fmtJpy(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}
