import { describe, expect, it } from "vitest";
import {
  buildCitationIndex,
  parseCitations,
} from "./citations";

describe("parseCitations", () => {
  it("splits text into text and citation tokens", () => {
    const tokens = parseCitations("She met Klein (LOTM1 Ch.245) that day.");
    expect(tokens).toEqual([
      { kind: "text", value: "She met Klein " },
      { kind: "citation", book: "LOTM1", chapterNum: 245 },
      { kind: "text", value: " that day." },
    ]);
  });

  it("parses COI citations", () => {
    const tokens = parseCitations("Lumian woke (COI Ch.1) in Cordu.");
    expect(tokens[1]).toEqual({ kind: "citation", book: "COI", chapterNum: 1 });
  });

  it("tolerates a space after Ch. (observed model drift, q05 battery)", () => {
    const tokens = parseCitations("Klein acted (LOTM1 Ch. 7) early.");
    expect(tokens[1]).toEqual({ kind: "citation", book: "LOTM1", chapterNum: 7 });
  });

  it("renders a mid-stream partial token as plain text", () => {
    const tokens = parseCitations("See (LOTM1 Ch.2");
    expect(tokens).toEqual([{ kind: "text", value: "See (LOTM1 Ch.2" }]);
  });

  it("handles two citations on the same chapter", () => {
    const tokens = parseCitations(
      "Twice noted (LOTM1 Ch.245) and again (LOTM1 Ch.245).",
    );
    const cites = tokens.filter((t) => t.kind === "citation");
    expect(cites).toHaveLength(2);
    expect(cites[0]).toEqual({ kind: "citation", book: "LOTM1", chapterNum: 245 });
  });

  it("keeps adjacent punctuation attached", () => {
    const tokens = parseCitations("He won (COI Ch.44). Then left.");
    expect(tokens).toEqual([
      { kind: "text", value: "He won " },
      { kind: "citation", book: "COI", chapterNum: 44 },
      { kind: "text", value: ". Then left." },
    ]);
  });

  it("leaves non-citation parentheticals as text", () => {
    expect(parseCitations("(sic) and (LOTM1 Chapter 5) stay text")).toEqual([
      { kind: "text", value: "(sic) and (LOTM1 Chapter 5) stay text" },
    ]);
  });
});

describe("buildCitationIndex", () => {
  const searchBookPart = {
    type: "tool-searchBook",
    state: "output-available",
    input: { query: "q", books: ["lotm1"] },
    output: {
      results: [
        {
          id: 1,
          bookId: "lotm1",
          chapterNum: 245,
          chapterTitle: "Chapter 245: Confirmation",
          chunkIndex: 0,
          content: "chunk A",
          contextualPrefix: "prefix",
          score: 0.02,
          source: "epub",
        },
        {
          id: 2,
          bookId: "lotm1",
          chapterNum: 245,
          chapterTitle: "Chapter 245: Confirmation",
          chunkIndex: 3,
          content: "chunk B higher relevance",
          contextualPrefix: "prefix",
          score: 0.09,
          source: "epub",
        },
        {
          id: 3,
          bookId: "coi",
          chapterNum: 44,
          chapterTitle: "Chapter 44",
          chunkIndex: 0,
          content: "coi chunk",
          contextualPrefix: "prefix",
          score: 0.05,
          source: "epub",
        },
      ],
    },
  };

  it("correlates citations to the highest-scoring chunk per (book, chapter)", () => {
    const index = buildCitationIndex([searchBookPart] as never[]);
    expect(index.get("LOTM1:245")?.excerpt).toContain("chunk B higher relevance");
    expect(index.get("COI:44")?.chapterTitle).toBe("Chapter 44");
    expect(index.get("LOTM1:999")).toBeUndefined();
  });

  it("indexes summary rows for summary-sourced citations", () => {
    const summaryPart = {
      type: "tool-lookupSummary",
      state: "output-available",
      input: { book: "lotm1", scope: "chapter", chapterNum: 245 },
      output: {
        summaries: [
          {
            level: "chapter",
            bookId: "lotm1",
            rangeStart: 245,
            rangeEnd: 245,
            label: "Chapter 245: Confirmation",
            content: "Klein approves the contract...",
          },
        ],
      },
    };
    const index = buildCitationIndex([summaryPart] as never[]);
    expect(index.get("LOTM1:245")?.excerpt).toContain("Klein approves the contract");
  });

  it("ignores parts with no available output", () => {
    const pending = { type: "tool-searchBook", state: "input-streaming" };
    expect(buildCitationIndex([pending] as never[]).size).toBe(0);
  });
});
