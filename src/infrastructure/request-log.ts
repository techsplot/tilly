import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelRole } from "./nebius/nebius-client";

// One structured log line per model-backed request. It holds only numbers
// and labels: never the message, prompts, model output, farm or field
// names, cookies, or IPs.

type RequestLog = {
  calls: Array<{ role: ModelRole; thinking: boolean }>;
  searchCalls: number;
};

const storage = new AsyncLocalStorage<RequestLog>();

// Called by the Nebius client for every model call it makes.
export function noteModelCall(role: ModelRole, thinking: boolean): void {
  storage.getStore()?.calls.push({ role, thinking });
}

// Called by the Tavily client for every search. The query is never logged.
export function noteSearchCall(): void {
  const log = storage.getStore();
  if (log) log.searchCalls += 1;
}

export async function withRequestLog(
  route: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const log: RequestLog = { calls: [], searchCalls: 0 };
  const start = Date.now();
  let status = 500;
  try {
    const response = await storage.run(log, handler);
    status = response.status;
    return response;
  } finally {
    const extraction = log.calls.filter((call) => call.role === "extraction");
    console.info(
      JSON.stringify({
        event: "request",
        route,
        status,
        durationMs: Date.now() - start,
        models: [...new Set(log.calls.map((call) => call.role))],
        modelCalls: log.calls.length,
        // A fast extraction call that was asked again with thinking on.
        thinkingRetry:
          extraction.some((call) => !call.thinking) &&
          extraction.some((call) => call.thinking),
        searchCalls: log.searchCalls,
      }),
    );
  }
}

/**
 * Logs a server error. In production only its type and status are kept:
 * database errors can quote farm and field names, and model and JSON
 * errors can quote what the farmer or the model wrote.
 */
export function logError(context: string, error: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    console.error(context, error);
    return;
  }
  const summary: Record<string, unknown> = {
    event: "error",
    context,
    error: error instanceof Error ? error.name : typeof error,
  };
  if (typeof error === "object" && error !== null) {
    if ("status" in error && typeof error.status === "number")
      summary.status = error.status;
    if ("code" in error && typeof error.code === "string")
      summary.code = error.code;
  }
  console.error(JSON.stringify(summary));
}
