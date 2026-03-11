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
};

export async function apiFetch<T>(input: string, init?: ApiFetchInit): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      const message = json?.error?.message ?? `Request failed: ${res.status}`;
      const code = json?.error?.code;
      throw new ApiError(res.status, message, code);
    }

    return json.data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(408, "Request timed out", "REQUEST_TIMEOUT");
    }

    throw new ApiError(0, "Network error", "NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export function fmtJpy(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(value);
}