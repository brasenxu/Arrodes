import { describe, it, expect, vi } from "vitest";
import { MediaWikiClient } from "../src/lib/mediawiki";
import { wikiSearch, wikiCategoryMembers, wikiGetPage, wikiVolumeTimeline } from "../src/tools/wiki";

function mockClient(response: unknown): MediaWikiClient {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
  return new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 100, refillPerSecond: 1000 } });
}

describe("wikiSearch", () => {
  it("returns [{ title, snippet }] from query.search results", async () => {
    const client = mockClient({
      query: {
        search: [
          { title: "Klein Moretti", snippet: "Klein is <b>the</b> main protagonist..." },
          { title: "Audrey Hall", snippet: "Audrey is a noblewoman..." },
        ],
      },
    });
    const r = await wikiSearch(client, { query: "Klein", limit: 5 });
    expect(r).toEqual([
      { title: "Klein Moretti", snippet: "Klein is <b>the</b> main protagonist..." },
      { title: "Audrey Hall", snippet: "Audrey is a noblewoman..." },
    ]);
  });

  it("returns [] when query.search is empty", async () => {
    const client = mockClient({ query: { search: [] } });
    const r = await wikiSearch(client, { query: "asdfasdf", limit: 5 });
    expect(r).toEqual([]);
  });
});

describe("wikiCategoryMembers", () => {
  it("accepts bare category names and prefixes 'Category:' automatically", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ query: { categorymembers: [] } }), { status: 200 }),
    );
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });
    await wikiCategoryMembers(client, { category: "Events", limit: 50 });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("cmtitle")).toBe("Category:Events");
  });

  it("does not double-prefix when caller already passes 'Category:'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ query: { categorymembers: [] } }), { status: 200 }),
    );
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });
    await wikiCategoryMembers(client, { category: "Category:Events", limit: 50 });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("cmtitle")).toBe("Category:Events");
  });

  it("maps MediaWiki 'ns' field to type: page/subcat/file", async () => {
    const client = mockClient({
      query: {
        categorymembers: [
          { pageid: 1, ns: 0, title: "Battle of Backlund" },
          { pageid: 2, ns: 14, title: "Category:Battles" },
          { pageid: 3, ns: 6, title: "File:Klein.png" },
        ],
      },
    });
    const r = await wikiCategoryMembers(client, { category: "Events", limit: 50 });
    expect(r).toEqual([
      { title: "Battle of Backlund", type: "page" },
      { title: "Category:Battles", type: "subcat" },
      { title: "File:Klein.png", type: "file" },
    ]);
  });
});

describe("wikiGetPage", () => {
  it("fetches full wikitext when no section given", async () => {
    const client = mockClient({ parse: { title: "Klein_Moretti", wikitext: "Klein is ..." } });
    const r = await wikiGetPage(client, { title: "Klein_Moretti", full: false });
    expect(r).toEqual({ title: "Klein_Moretti", section: null, body: "Klein is ...", truncated: false });
  });

  it("truncates body to 8000 chars by default and sets truncated: true", async () => {
    const longText = "a".repeat(10000);
    const client = mockClient({ parse: { title: "Long", wikitext: longText } });
    const r = await wikiGetPage(client, { title: "Long", full: false });
    expect(r.body.length).toBe(8000);
    expect(r.truncated).toBe(true);
  });

  it("returns full body when full=true regardless of length", async () => {
    const longText = "b".repeat(10000);
    const client = mockClient({ parse: { title: "Long", wikitext: longText } });
    const r = await wikiGetPage(client, { title: "Long", full: true });
    expect(r.body.length).toBe(10000);
    expect(r.truncated).toBe(false);
  });

  it("passes integer section verbatim to the API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ parse: { wikitext: "section content" } }), { status: 200 }));
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });
    const r = await wikiGetPage(client, { title: "X", section: 2, full: false });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("section")).toBe("2");
    expect(r.section).toBe("2");
  });

  it("resolves string section via prop=sections lookup before fetching wikitext", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        parse: { sections: [
          { toclevel: 1, level: "2", line: "Overview", number: "1", index: "1", byteoffset: 0, anchor: "Overview", fromtitle: "X" },
          { toclevel: 1, level: "2", line: "Timeline of Major Events", number: "2", index: "2", byteoffset: 500, anchor: "Timeline_of_Major_Events", fromtitle: "X" },
        ] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ parse: { wikitext: "timeline content" } }), { status: 200 }));
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });
    const r = await wikiGetPage(client, { title: "X", section: "Timeline of Major Events", full: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get("section")).toBe("2");
    expect(r.body).toBe("timeline content");
  });

  it("throws when string section does not match any line", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        parse: { sections: [{ toclevel: 1, level: "2", line: "Overview", number: "1", index: "1", byteoffset: 0, anchor: "Overview", fromtitle: "X" }] },
      }), { status: 200 }));
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });
    await expect(
      wikiGetPage(client, { title: "X", section: "NonExistentHeading", full: false }),
    ).rejects.toThrow(/section.*not found/i);
  });
});

describe("wikiVolumeTimeline", () => {
  it("resolves volume page via search, fetches timeline section when present", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        query: { search: [{ title: "Volume_4:_Undying", snippet: "..." }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        parse: { sections: [
          { toclevel: 1, level: "2", line: "Overview", number: "1", index: "1", byteoffset: 0, anchor: "Overview", fromtitle: "X" },
          { toclevel: 1, level: "2", line: "Timeline of Major Events", number: "2", index: "2", byteoffset: 500, anchor: "Timeline_of_Major_Events", fromtitle: "X" },
        ] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        parse: { wikitext: "Chapter 1: ... Chapter 2: ..." },
      }), { status: 200 }));
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });

    const r = await wikiVolumeTimeline(client, { volume: 4 });
    expect(r.title).toBe("Volume_4:_Undying");
    expect(r.section).toBe("2");
    expect(r.section_found).toBe(true);
    expect(r.body).toBe("Chapter 1: ... Chapter 2: ...");
  });

  it("falls back to full page when no timeline section matches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        query: { search: [{ title: "Volume_9:_Pale_Emperor", snippet: "..." }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        parse: { sections: [{ toclevel: 1, level: "2", line: "Overview", number: "1", index: "1", byteoffset: 0, anchor: "Overview", fromtitle: "X" }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        parse: { wikitext: "full volume body" },
      }), { status: 200 }));
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });

    const r = await wikiVolumeTimeline(client, { volume: 9 });
    expect(r.section_found).toBe(false);
    expect(r.section).toBeNull();
    expect(r.body).toBe("full volume body");
  });

  it("throws when no search hit starts with Volume_N:", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      query: { search: [{ title: "SomeOtherPage", snippet: "..." }] },
    }), { status: 200 }));
    const client = new MediaWikiClient({ fetch: fetchMock, rateLimit: { capacity: 10, refillPerSecond: 100 } });
    await expect(wikiVolumeTimeline(client, { volume: 4 })).rejects.toThrow(/Volume_4/);
  });
});
