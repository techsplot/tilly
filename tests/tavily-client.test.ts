import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRUSTED_DOMAINS,
  TavilyUnavailableError,
  isTavilyConfigured,
  searchBudget,
  searchTavily,
} from "../src/infrastructure/tavily/tavily-client";

const API_KEY = "tvly-test-key-123";

function tavilyResponse(results: unknown[], status = 200) {
  return new Response(JSON.stringify({ results }), { status });
}

describe("searchTavily", () => {
  beforeEach(() => {
    vi.stubEnv("TAVILY_API_KEY", API_KEY);
    vi.stubEnv("TAVILY_DAILY_LIMIT", "");
    vi.stubGlobal("fetch", vi.fn());
    searchBudget.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is configured only when a key is set", () => {
    expect(isTavilyConfigured()).toBe(true);
    vi.stubEnv("TAVILY_API_KEY", " ");
    expect(isTavilyConfigured()).toBe(false);
  });

  it("searches trusted domains with bearer auth and maps the results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      tavilyResponse([
        {
          title: "Aphids on vegetables",
          url: "https://ipm.ucanr.edu/aphids",
          content: "Check leaf undersides.",
        },
      ]),
    );

    const results = await searchTavily("how do I control aphids?");

    expect(results).toEqual([
      {
        title: "Aphids on vegetables",
        url: "https://ipm.ucanr.edu/aphids",
        content: "Check leaf undersides.",
      },
    ]);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      query: "how do I control aphids?",
      include_domains: TRUSTED_DOMAINS,
      include_answer: false,
    });
  });

  it("drops results without a url or content and truncates content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      tavilyResponse([
        { title: "No url", url: null, content: "text" },
        { title: "No content", url: "https://fao.org/a", content: "" },
        { title: "Not http", url: "javascript:alert(1)", content: "x" },
        { title: null, url: "https://fao.org/b", content: "y".repeat(2000) },
      ]),
    );

    const results = await searchTavily("q");

    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("https://fao.org/b");
    expect(results[0]!.content).toHaveLength(1200);
  });

  it.each([
    ["a 500 status", () => Promise.resolve(tavilyResponse([], 500))],
    ["a network error", () => Promise.reject(new Error(`fail ${API_KEY}`))],
    ["an invalid body", () => Promise.resolve(new Response("not json"))],
  ])(
    "throws TavilyUnavailableError on %s, without the key",
    async (_label, reply) => {
      vi.mocked(fetch).mockImplementationOnce(reply);
      const error = await searchTavily("q").catch((caught) => caught);
      expect(error).toBeInstanceOf(TavilyUnavailableError);
      expect(String(error.message)).not.toContain(API_KEY);
    },
  );

  it("refuses without calling Tavily over the daily limit", async () => {
    vi.stubEnv("TAVILY_DAILY_LIMIT", "1");
    vi.mocked(fetch).mockResolvedValue(tavilyResponse([]));
    await searchTavily("first");
    await expect(searchTavily("second")).rejects.toBeInstanceOf(
      TavilyUnavailableError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses without calling Tavily when no key is set", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    await expect(searchTavily("q")).rejects.toBeInstanceOf(
      TavilyUnavailableError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
