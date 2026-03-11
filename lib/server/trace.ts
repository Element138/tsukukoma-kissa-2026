import { NextRequest } from "next/server";

type TraceData = Record<string, unknown>;

type TraceFn = (step: string, data?: TraceData) => void;

function compactError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const maybe = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
  return {
    name: typeof maybe.name === "string" ? maybe.name : undefined,
    code: typeof maybe.code === "string" ? maybe.code : undefined,
    message: typeof maybe.message === "string" ? maybe.message : String(error),
    stack: typeof maybe.stack === "string" ? maybe.stack.split("\n").slice(0, 3).join(" | ") : undefined
  };
}

function emitTrace(route: string, traceId: string, step: string, data?: TraceData) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      kind: "request-trace",
      route,
      traceId,
      step,
      ...(data ?? {})
    })
  );
}

export async function withRouteTrace(req: NextRequest, route: string, handler: (trace: TraceFn, traceId: string) => Promise<Response>) {
  const startedAt = Date.now();
  const incoming = req.headers.get("x-kissa-trace-id");
  const traceId = incoming && incoming.length > 0 ? incoming : crypto.randomUUID();

  const trace: TraceFn = (step, data) => {
    emitTrace(route, traceId, step, data);
  };

  trace("request.start", {
    method: req.method,
    path: req.nextUrl.pathname,
    query: req.nextUrl.search,
    userAgent: req.headers.get("user-agent") ?? null
  });

  try {
    const res = await handler(trace, traceId);
    res.headers.set("x-kissa-trace-id", traceId);
    trace("request.end", { status: res.status, elapsedMs: Date.now() - startedAt });
    return res;
  } catch (error) {
    trace("request.crash", { elapsedMs: Date.now() - startedAt, error: compactError(error) });
    throw error;
  }
}

export function traceError(trace: TraceFn, step: string, error: unknown) {
  trace(step, { error: compactError(error) });
}