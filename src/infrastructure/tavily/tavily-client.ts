import { z } from "zod";
import { DailyCap } from "../rate-limit";
import { noteSearchCall } from "../request-log";

// Tavily web search, restricted to agricultural sources a farmer can trust.
// Only the farmer's question is sent; never farm names, fields, or records.

export type TavilyResult = { title: string; url: string; content: string };

export class TavilyUnavailableError extends Error {
  constructor(message = "Tavily search is unavailable.") {
    super(message);
    this.name = "TavilyUnavailableError";
  }
}

export const TRUSTED_DOMAINS = [
  "fao.org",
  "cabi.org",
  "plantwiseplus.org",
  "iita.org",
  "cimmyt.org",
  "ipm.ucanr.edu",
  "extension.umn.edu",
  "extension.psu.edu",
  "extension.org",
  "agriculture.gov.au",
];

const TAVILY_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;
const MAX_CONTENT_CHARS = 1_200;
const DEFAULT_DAILY_LIMIT = 200;

function tavilyDailyLimit(): number {
  const raw = process.env.TAVILY_DAILY_LIMIT?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

export const searchBudget = new DailyCap(tavilyDailyLimit);

const responseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      url: z.string().nullish(),
      content: z.string().nullish(),
    }),
  ),
});

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export async function searchTavily(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new TavilyUnavailableError("Tavily is not configured.");
  if (!searchBudget.take().allowed) {
    throw new TavilyUnavailableError("Daily search limit reached.");
  }
  noteSearchCall();

  let response: Response;
  try {
    response = await fetch(TAVILY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: MAX_RESULTS,
        include_answer: false,
        include_domains: TRUSTED_DOMAINS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Network error or timeout. The original error is not kept: it can
    // carry request details.
    throw new TavilyUnavailableError("Tavily did not respond.");
  }
  if (!response.ok) {
    throw new TavilyUnavailableError(`Tavily returned ${response.status}.`);
  }

  const parsed = responseSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new TavilyUnavailableError("Tavily returned an invalid response.");
  }

  return parsed.data.results
    .flatMap((result) => {
      const url = result.url?.trim();
      const content = result.content?.trim();
      if (!url || !content || !/^https?:\/\//.test(url)) return [];
      return [
        {
          title: result.title?.trim() || url,
          url,
          content: content.slice(0, MAX_CONTENT_CHARS),
        },
      ];
    })
    .slice(0, MAX_RESULTS);
}
