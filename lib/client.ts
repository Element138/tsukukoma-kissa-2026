export class ApiError extends Error {
  status: number;
  code?: string;
  traceId?: string;

  constructor(status: number, message: string, code?: string, traceId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.traceId = traceId;
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
  "INTERNAL_ERROR"
]);

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const API_ERROR_LABEL_JA: Record<string, string> = {
  UNAUTHORIZED: "認証が必要です",
  FORBIDDEN: "この操作を実行する権限がありません",
  SESSION_MISSING: "ログインが必要です",
  SESSION_INVALID: "セッションが無効です",
  SESSION_REVOKED: "セッションが無効化されています",
  SESSION_EXPIRED: "セッションの有効期限が切れました",
  ACTOR_INACTIVE: "アカウントが無効化されています",
  INVALID_JSON: "リクエスト本文の JSON 形式が不正です",
  VALIDATION_ERROR: "入力内容に誤りがあります",
  REQUEST_TIMEOUT: "リクエストがタイムアウトしました",
  NETWORK_ERROR: "通信エラーが発生しました",
  DB_UNAVAILABLE: "データベースに接続できません",
  DB_UNREACHABLE: "データベースに接続できません",
  DB_POOL_TIMEOUT:
    "データベース接続が混雑しています。時間をおいて再試行してください",
  DB_TIMEOUT: "データベース処理がタイムアウトしました",
  INTERNAL_ERROR: "サーバー内部でエラーが発生しました",
};

function hasJapanese(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function fallbackMessageByStatus(status: number) {
  if (status === 0) {
    return "通信エラーが発生しました";
  }
  if (status === 400) {
    return "リクエスト内容に誤りがあります";
  }
  if (status === 401) {
    return "認証が必要です";
  }
  if (status === 403) {
    return "この操作を実行する権限がありません";
  }
  if (status === 404) {
    return "対象データが見つかりません";
  }
  if (status === 409) {
    return "データの競合が発生しました。再読み込みして再試行してください";
  }
  if (status === 408) {
    return "リクエストがタイムアウトしました";
  }
  if (status >= 500) {
    return "サーバー内部でエラーが発生しました";
  }
  return "エラーが発生しました";
}

function toJapaneseApiErrorMessage(params: {
  status: number;
  code?: string;
  baseMessage: string;
}) {
  const byCode = params.code ? API_ERROR_LABEL_JA[params.code] : undefined;
  if (byCode) {
    return byCode;
  }
  if (hasJapanese(params.baseMessage)) {
    return params.baseMessage;
  }
  return fallbackMessageByStatus(params.status);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newTraceId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function isRetryableError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return TRANSIENT_STATUS.has(error.status) || (error.code ? TRANSIENT_CODES.has(error.code) : false);
}

export async function apiFetch<T>(input: string, init?: ApiFetchInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const maxAttempts = init?.retry ?? (method === "GET" ? 2 : 1);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = init?.timeoutMs ?? 30000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const traceId = newTraceId();

    try {
      const res = await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-kissa-trace-id": traceId,
          ...(init?.headers ?? {})
        },
        cache: "no-store"
      });

      const json = await res.json().catch(() => null);
      const serverTraceId = res.headers.get("x-kissa-trace-id") ?? traceId;

      if (!res.ok || !json?.ok) {
        const code = json?.error?.code;
        const baseMessage = json?.error?.message ?? `Request failed: ${res.status}`;
        const localizedMessage = toJapaneseApiErrorMessage({
          status: res.status,
          code,
          baseMessage,
        });
        const message = `${localizedMessage}${code ? `（コード: ${code}）` : ""} [trace:${serverTraceId}]`;
        throw new ApiError(res.status, message, code, serverTraceId);
      }

      return json.data as T;
    } catch (error) {
      let normalized: unknown = error;

      if (error instanceof DOMException && error.name === "AbortError") {
        normalized = new ApiError(408, `リクエストがタイムアウトしました（コード: REQUEST_TIMEOUT） [trace:${traceId}]`, "REQUEST_TIMEOUT", traceId);
      } else if (!(error instanceof ApiError)) {
        normalized = new ApiError(0, `通信エラーが発生しました（コード: NETWORK_ERROR） [trace:${traceId}]`, "NETWORK_ERROR", traceId);
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

  throw lastError instanceof Error ? lastError : new ApiError(500, "不明なリクエストエラーが発生しました");
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
