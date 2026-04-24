import { parseEpub } from "@gxl/epub-parser";
import { assignArc, type BookId } from "./arc-map";
import type { ContentKind } from "@/lib/db/schema";

export type ChapterRecord = {
  bookId: BookId;
  volume: number;
  volumeName: string;
  arc: number;
  arcName: string;
  chapterNum: number;
  chapterTitle: string;
  rawText: string;
  contentKind: ContentKind;
};

// Matches "Chapter 1", "Chapter 245 - 245: Title", "第1章", "第 100 章".
// Group 1 captures the Latin chapter number; group 2 the Chinese.
const CHAPTER_NUMBER_RE = /^\s*(?:Chapter\s+(\d+)|第\s*(\d+)\s*章)/i;

export function parseChapterNumber(title: string): number | null {
  const m = CHAPTER_NUMBER_RE.exec(title);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

export function isChapterSection(title: string): boolean {
  return parseChapterNumber(title) !== null;
}

const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;

export function extractSectionTitle(htmlString: string): string {
  const m = HEADING_RE.exec(htmlString);
  if (m) return normaliseTextContent(m[1]).slice(0, 160);
  return normaliseTextContent(htmlString).slice(0, 160);
}

function normaliseTextContent(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#xa0;/gi, " ")
    .replace(/ /g, " ");
}

// \x01 = line break within a paragraph (from <br>).
// \x02 = paragraph boundary (from <p>, <div>, <h*>, <li>, <blockquote> close).
// Using sentinels keeps intentional line breaks from being collapsed into
// spaces when we normalise incidental whitespace out of the HTML source.
const BR_SENTINEL = "\x01";
const P_SENTINEL = "\x02";

export function cleanChapterBody(htmlString: string, chapterTitle: string): string {
  let s = htmlString.replace(/\r\n/g, "\n");

  s = s.replace(/<br\s*\/?>/gi, BR_SENTINEL);
  s = s.replace(
    /<\/(p|div|h[1-6]|li|blockquote|tr|section|article)>/gi,
    P_SENTINEL + P_SENTINEL,
  );

  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  // Collapse all remaining whitespace (incl. solo \n) to a single space.
  s = s.replace(/[^\S\x01\x02]+/g, " ");

  // Sentinels → real line breaks.
  s = s.replace(new RegExp(BR_SENTINEL, "g"), "\n");
  s = s.replace(new RegExp(P_SENTINEL + P_SENTINEL, "g"), "\n\n");

  // Trim whitespace inside each line.
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  // Collapse any run of 2+ newlines (with possible intervening spaces) to exactly \n\n.
  s = s.replace(/\n{2,}/g, "\n\n");

  // Strip repeated leading duplicates of the chapter title. @gxl/epub-parser
  // tends to emit <h1>Title</h1><p>Title</p> — both need to go before ingest.
  s = s.trimStart();
  while (s.startsWith(chapterTitle)) {
    s = s.slice(chapterTitle.length).trimStart();
  }

  return s.trim();
}

type EpubSection = { htmlString: string };

export async function extractChapters(
  epubPath: string,
  bookId: BookId,
): Promise<ChapterRecord[]> {
  const epub = await parseEpub(epubPath, { type: "path" });
  const sections: EpubSection[] = (epub.sections ?? []) as EpubSection[];

  const records: ChapterRecord[] = [];
  const seen = new Set<number>();

  for (const section of sections) {
    const title = extractSectionTitle(section.htmlString);
    const chapterNum = parseChapterNumber(title);
    if (chapterNum === null) continue;

    if (seen.has(chapterNum)) {
      throw new Error(
        `extractChapters(${bookId}): duplicate chapter number ${chapterNum} (title=${title})`,
      );
    }
    seen.add(chapterNum);

    const { volume, volumeName, arc, arcName, contentKind } = assignArc(
      bookId,
      chapterNum,
    );
    const rawText = cleanChapterBody(section.htmlString, title);

    records.push({
      bookId,
      volume,
      volumeName,
      arc,
      arcName,
      chapterNum,
      chapterTitle: title,
      rawText,
      contentKind,
    });
  }

  records.sort((a, b) => a.chapterNum - b.chapterNum);

  // Sanity: chapter numbers should be a contiguous 1..N run. Gaps mean the
  // parser missed a section or the regex misclassified one.
  if (records.length > 0) {
    for (let i = 0; i < records.length; i++) {
      const expected = i + 1;
      if (records[i].chapterNum !== expected) {
        throw new Error(
          `extractChapters(${bookId}): chapter numbering gap at index ${i} — expected ${expected}, got ${records[i].chapterNum}`,
        );
      }
    }
  }

  return records;
}
