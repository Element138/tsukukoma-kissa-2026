export function resolveRuntimeDatabaseUrl(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    const isSupabasePooler = parsed.hostname.includes("pooler.supabase.com");
    if (isSupabasePooler && (parsed.port === "" || parsed.port === "5432")) {
      parsed.port = "6543";
    }
    const likelyPooler = parsed.hostname.includes("pooler.") || parsed.port === "6543";
    if (likelyPooler) {
      parsed.searchParams.set("pgbouncer", "true");
      // Each warm function can otherwise hold several of Supavisor's client slots.
      parsed.searchParams.set("connection_limit", "1");
      // Release idle client slots promptly during deployment overlap.
      parsed.searchParams.set("max_idle_connection_lifetime", "10");
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}
