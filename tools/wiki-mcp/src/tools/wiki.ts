import type { MediaWikiClient } from "../lib/mediawiki";
import { resolveSectionIndex, type MediaWikiSection } from "../lib/sections";
import type {
  WikiSearchInputT,
  WikiCategoryMembersInputT,
  WikiGetPageInputT,
  WikiVolumeTimelineInputT,
} from "../schemas";

export interface WikiSearchResult {
  title: string;
  snippet: string;
}

export async function wikiSearch(
  client: MediaWikiClient,
  input: WikiSearchInputT,
): Promise<WikiSearchResult[]> {
  const res = await client.get<{ query?: { search?: { title: string; snippet: string }[] } }>({
    action: "query",
    list: "search",
    srsearch: input.query,
    srlimit: input.limit,
  });
  const hits = res.query?.search ?? [];
  return hits.map((h) => ({ title: h.title, snippet: h.snippet }));
}

export interface WikiCategoryMember {
  title: string;
  type: "page" | "subcat" | "file";
}

const NS_TO_TYPE: Record<number, WikiCategoryMember["type"]> = {
  0: "page",
  6: "file",
  14: "subcat",
};

export async function wikiCategoryMembers(
  client: MediaWikiClient,
  input: WikiCategoryMembersInputT,
): Promise<WikiCategoryMember[]> {
  const title = input.category.startsWith("Category:")
    ? input.category
    : `Category:${input.category}`;
  const res = await client.get<{
    query?: { categorymembers?: { ns: number; title: string }[] };
  }>({
    action: "query",
    list: "categorymembers",
    cmtitle: title,
    cmlimit: input.limit,
  });
  const members = res.query?.categorymembers ?? [];
  return members.map((m) => ({
    title: m.title,
    type: NS_TO_TYPE[m.ns] ?? "page",
  }));
}

const DEFAULT_MAX_CHARS = 8000;

export interface WikiGetPageResult {
  title: string;
  section: string | null;
  body: string;
  truncated: boolean;
}

export async function wikiGetPage(
  client: MediaWikiClient,
  input: WikiGetPageInputT,
): Promise<WikiGetPageResult> {
  let sectionIndex: string | null = null;

  if (input.section !== undefined) {
    if (typeof input.section === "number" || /^\d+$/.test(input.section)) {
      sectionIndex = String(input.section);
    } else {
      const secRes = await client.get<{ parse?: { sections?: MediaWikiSection[] } }>({
        action: "parse",
        page: input.title,
        prop: "sections",
      });
      const sections = secRes.parse?.sections ?? [];
      const resolved = resolveSectionIndex(sections, input.section);
      if (resolved.notFound) {
        throw new Error(`Section "${input.section}" not found on page "${input.title}"`);
      }
      sectionIndex = resolved.index;
    }
  }

  const params: Record<string, string | number | undefined> = {
    action: "parse",
    page: input.title,
    prop: "wikitext",
  };
  if (sectionIndex !== null) params.section = sectionIndex;

  const res = await client.get<{ parse?: { wikitext?: string } }>(params);
  const full = res.parse?.wikitext ?? "";
  const truncated = !input.full && full.length > DEFAULT_MAX_CHARS;
  const body = truncated ? full.slice(0, DEFAULT_MAX_CHARS) : full;
  return { title: input.title, section: sectionIndex, body, truncated };
}

export interface WikiVolumeTimelineResult extends WikiGetPageResult {
  section_found: boolean;
}

export async function wikiVolumeTimeline(
  client: MediaWikiClient,
  input: WikiVolumeTimelineInputT,
): Promise<WikiVolumeTimelineResult> {
  const hits = await wikiSearch(client, { query: `Volume ${input.volume}:`, limit: 5 });
  const volumeHit = hits.find((h) =>
    new RegExp(`^Volume[_ ]${input.volume}:`, "i").test(h.title),
  );
  if (!volumeHit) {
    throw new Error(`Could not find a Volume_${input.volume} page via search`);
  }

  const secRes = await client.get<{ parse?: { sections?: MediaWikiSection[] } }>({
    action: "parse",
    page: volumeHit.title,
    prop: "sections",
  });
  const sections = secRes.parse?.sections ?? [];
  const timelineMatch = resolveSectionIndex(sections, /timeline/i, { matchMode: "regex" });

  if (timelineMatch.index) {
    const page = await wikiGetPage(client, {
      title: volumeHit.title,
      section: Number(timelineMatch.index),
      full: false,
    });
    return { ...page, section_found: true };
  }

  const page = await wikiGetPage(client, { title: volumeHit.title, full: false });
  return { ...page, section_found: false };
}
