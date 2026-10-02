import type { UIMessage } from "ai";
import type { BookId } from "@/lib/rag/types";

/**
 * Citation parsing + correlator (ticket 013). The model emits inline
 * citations in the pinned format `(LOTM1 Ch.N)` / `(COI Ch.N)`; the parser
 * tolerates the observed drift variant `(LOTM1 Ch. N)` (space after Ch. —
 * q05 battery). Incomplete trailing tokens render as plain text (stream-safe).
 */

export type CitationToken =
  | { kind: "text"; value: string }
  | { kind: "citation"; book: "LOTM1" | "COI"; chapterNum: number };

const CITATION_RE = /\((LOTM1|COI) Ch\.\s?(\d+)\)/g;

const BOOK_ID: Record<"LOTM1" | "COI", BookId> = {
  LOTM1: "lotm1",
  COI: "coi",
};

export function parseCitations(text: string): CitationToken[] {
  const tokens: CitationToken[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ kind: "text", value: text.slice(last, idx) });
    tokens.push({
      kind: "citation",
      book: m[1] as "LOTM1" | "COI",
      chapterNum: Number(m[2]),
    });
    last = idx + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", value: text.slice(last) });
  return tokens;
}

export type CitationInfo = {
  chapterTitle: string | null;
  excerpt: string | null;
};

export type CitationIndex = Map<string, CitationInfo>;

const citeKey = (bookLabel: "LOTM1" | "COI", chapterNum: number) =>
  `${bookLabel}:${chapterNum}`;

type ToolPartLike = {
  type: string;
  state?: string;
  output?: unknown;
};

function excerptOf(content: string, max = 200): string {
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

/**
 * Index from a message's tool parts to the ground a citation pill can show:
 * searchBook results keyed by exact (book, chapterNum) — highest score wins
 * — and lookupSummary rows keyed by every chapter they cover.
 */
export function buildCitationIndex(
  parts: UIMessage["parts"],
): CitationIndex {
  const index: CitationIndex = new Map();

  for (const part of parts as ToolPartLike[]) {
    if (part.state !== "output-available") continue;

    if (part.type === "tool-searchBook") {
      const results =
        (part.output as { results?: Array<{ bookId: string; chapterNum: number; chapterTitle: string; content: string; score: number }> })
          ?.results ?? [];
      for (const r of results) {
        const label = r.bookId === "coi" ? "COI" : "LOTM1";
        const key = citeKey(label, r.chapterNum);
        const prev = index.get(key);
        if (!prev || r.score > (prev as CitationInfo & { _score?: number })._score!) {
          index.set(key, {
            chapterTitle: r.chapterTitle,
            excerpt: excerptOf(r.content),
            ...({ _score: r.score } as object),
          });
        }
      }
    }

    if (part.type === "tool-lookupSummary") {
      const summaries =
        (part.output as { summaries?: Array<{ level: string; bookId: string; rangeStart: number; rangeEnd: number; label: string; content: string }> })
          ?.summaries ?? [];
      for (const s of summaries) {
        const label = s.bookId === "coi" ? "COI" : "LOTM1";
        for (let ch = s.rangeStart; ch <= s.rangeEnd && ch <= s.rangeStart + 200; ch++) {
          const key = citeKey(label, ch);
          if (!index.has(key)) {
            index.set(key, { chapterTitle: s.label, excerpt: excerptOf(s.content) });
          }
        }
      }
    }
  }

  for (const [key, value] of index) {
    const { _score, ...rest } = value as CitationInfo & { _score?: number };
    void _score;
    index.set(key, rest);
  }

  return index;
}
