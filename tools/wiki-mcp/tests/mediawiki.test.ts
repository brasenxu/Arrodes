import { describe, it, expect, vi } from "vitest";
import { MediaWikiClient } from "../src/lib/mediawiki";

describe("MediaWikiClient", () => {
  it("sends a User-Agent header identifying the project", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ parse: { wikitext: "hello" } }), { status: 200 })
    );
    const client = new MediaWikiClient({ fetch: fetchMock });

    await client.get({ action: "parse", page: "Klein_Moretti" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("User-Agent")).toMatch(/^Arrodes-WikiMCP\//);
  });

  it("builds a URL against https://lordofthemysteries.fandom.com/api.php with format=json&formatversion=2", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const client = new MediaWikiClient({ fetch: fetchMock });

    await client.get({ action: "query", list: "search", srsearch: "Klein" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://lordofthemysteries.fandom.com/api.php");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("formatversion")).toBe("2");
    expect(url.searchParams.get("action")).toBe("query");
    expect(url.searchParams.get("list")).toBe("search");
    expect(url.searchParams.get("srsearch")).toBe("Klein");
  });

  it("throws on non-2xx response with status in message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("nope", { status: 500 })
    );
    const client = new MediaWikiClient({ fetch: fetchMock });

    await expect(client.get({ action: "parse", page: "x" })).rejects.toThrow(/500/);
  });

  it("throws on MediaWiki error field in JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "missingtitle", info: "The page does not exist." } }),
        { status: 200 }
      )
    );
    const client = new MediaWikiClient({ fetch: fetchMock });

    await expect(client.get({ action: "parse", page: "DoesNotExist" })).rejects.toThrow(
      /missingtitle/
    );
  });

  it("rate-limits: with bucket capacity 2, three rapid calls take at least the refill interval", async () => {
    // Fresh Response per call — Response bodies are single-use, so a shared
    // mockResolvedValue Response would throw on the second consumer.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );
    const client = new MediaWikiClient({
      fetch: fetchMock,
      rateLimit: { capacity: 2, refillPerSecond: 10 }, // 100ms per token
    });

    const start = Date.now();
    await Promise.all([
      client.get({ action: "query" }),
      client.get({ action: "query" }),
      client.get({ action: "query" }),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // one token refill (~100ms) minus clock slack
  });
});
