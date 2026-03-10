export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    const message = json?.error?.message ?? `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return json.data as T;
}

export function fmtJpy(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(value);
}


