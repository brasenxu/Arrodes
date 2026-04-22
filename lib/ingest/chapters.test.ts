import { describe, test, expect } from "vitest";
import {
  parseChapterNumber,
  isChapterSection,
  extractSectionTitle,
  cleanChapterBody,
} from "./chapters";

describe("parseChapterNumber", () => {
  test("LOTM format: 'Chapter N: Title'", () => {
    expect(parseChapterNumber("Chapter 1: Crimson")).toBe(1);
    expect(parseChapterNumber("Chapter 245: Audience")).toBe(245);
    expect(parseChapterNumber("Chapter 1394: End")).toBe(1394);
  });

  test("LOTM format: 'Chapter N' no colon", () => {
    expect(parseChapterNumber("Chapter 1")).toBe(1);
  });

  test("COI double-numbered: 'Chapter N - M: Title'", () => {
    expect(parseChapterNumber("Chapter 1 - 1: Curse")).toBe(1);
    expect(parseChapterNumber("Chapter 245 - 245: Revelation")).toBe(245);
    expect(parseChapterNumber("Chapter 1179 - 1179: Final")).toBe(1179);
  });

  test("Chinese format '第N章'", () => {
    expect(parseChapterNumber("第1章")).toBe(1);
    expect(parseChapterNumber("第100章: 标题")).toBe(100);
    expect(parseChapterNumber("第 245 章")).toBe(245);
  });

  test("leading whitespace tolerated", () => {
    expect(parseChapterNumber("   Chapter 7: Clown")).toBe(7);
  });

  test("non-chapter titles return null", () => {
    expect(parseChapterNumber("Cover")).toBeNull();
    expect(parseChapterNumber("Information")).toBeNull();
    expect(parseChapterNumber("Author's Afterword")).toBeNull();
    expect(parseChapterNumber("")).toBeNull();
    expect(parseChapterNumber("https://i.imgur.com/cover.jpg")).toBeNull();
  });
});

describe("isChapterSection", () => {
  test("matches chapter titles", () => {
    expect(isChapterSection("Chapter 1: X")).toBe(true);
    expect(isChapterSection("Chapter 100 - 100: Y")).toBe(true);
    expect(isChapterSection("第5章")).toBe(true);
  });

  test("rejects front matter", () => {
    expect(isChapterSection("Cover")).toBe(false);
    expect(isChapterSection("Information")).toBe(false);
    expect(isChapterSection("")).toBe(false);
  });
});

describe("extractSectionTitle", () => {
  test("pulls from <h1>", () => {
    expect(extractSectionTitle("<h1>Chapter 716: Island and Ruins</h1><p>Body</p>"))
      .toBe("Chapter 716: Island and Ruins");
  });

  test("pulls from <h2> if no <h1>", () => {
    expect(extractSectionTitle("<h2>Chapter 1: Crimson</h2>")).toBe("Chapter 1: Crimson");
  });

  test("falls back to first non-empty text", () => {
    expect(extractSectionTitle("<div>Cover</div>")).toBe("Cover");
  });

  test("strips HTML entities", () => {
    expect(extractSectionTitle("<h1>Chapter&nbsp;1:&nbsp;Crimson</h1>"))
      .toBe("Chapter 1: Crimson");
  });

  test("empty html returns empty string", () => {
    expect(extractSectionTitle("")).toBe("");
  });
});

describe("cleanChapterBody", () => {
  test("strips HTML tags", () => {
    const html = "<h1>Chapter 1: X</h1><p>Klein opened his eyes.</p>";
    expect(cleanChapterBody(html, "Chapter 1: X")).toBe("Klein opened his eyes.");
  });

  test("strips duplicated leading title (probe quirk: <h1> title repeated in body)", () => {
    const html =
      "<h1>Chapter 716: Island and Ruins</h1>" +
      "<p>Chapter 716: Island and Ruins</p>" +
      "<p>The fog rolled in.</p>";
    expect(cleanChapterBody(html, "Chapter 716: Island and Ruins"))
      .toBe("The fog rolled in.");
  });

  test("preserves paragraph breaks between <p> blocks", () => {
    const html =
      "<h1>Chapter 2: Y</h1>" +
      "<p>First paragraph.</p>" +
      "<p>Second paragraph.</p>";
    expect(cleanChapterBody(html, "Chapter 2: Y")).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
  });

  test("collapses \\r\\n to \\n", () => {
    const html = "<h1>Chapter 3: Z</h1><p>Line1\r\nLine2</p>";
    expect(cleanChapterBody(html, "Chapter 3: Z")).toBe("Line1 Line2");
  });

  test("strips leading/trailing whitespace and blank lines", () => {
    const html = "<h1>Chapter 4: A</h1><p>   </p><p>Body.</p><p>   </p>";
    expect(cleanChapterBody(html, "Chapter 4: A")).toBe("Body.");
  });

  test("decodes &nbsp; to space", () => {
    const html = "<h1>Chapter 5: B</h1><p>Klein&nbsp;smiled.</p>";
    expect(cleanChapterBody(html, "Chapter 5: B")).toBe("Klein smiled.");
  });

  test("title match is exact — does not strip mid-body occurrences", () => {
    const html =
      "<h1>Chapter 7: Memory</h1>" +
      "<p>He remembered. Chapter 7: Memory was written on the wall.</p>";
    expect(cleanChapterBody(html, "Chapter 7: Memory")).toBe(
      "He remembered. Chapter 7: Memory was written on the wall.",
    );
  });

  test("<br> becomes single newline", () => {
    const html = "<h1>Chapter 8: C</h1><p>A<br>B<br>C</p>";
    expect(cleanChapterBody(html, "Chapter 8: C")).toBe("A\nB\nC");
  });
});
