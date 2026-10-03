import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt";

describe("SYSTEM_PROMPT (ticket 011)", () => {
  it("is byte-stable across calls (implicit-cache prerequisite)", () => {
    // Same reference identity: a static const, not a function rebuild.
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    const a = JSON.stringify(SYSTEM_PROMPT);
    const b = JSON.stringify(SYSTEM_PROMPT);
    expect(a).toBe(b);
  });

  it("pins the citation format exactly", () => {
    expect(SYSTEM_PROMPT).toContain("(LOTM1 Ch.N)");
    expect(SYSTEM_PROMPT).toContain("(COI Ch.N)");
  });

  it("routes all four tools", () => {
    expect(SYSTEM_PROMPT).toContain("lookupSummary");
    expect(SYSTEM_PROMPT).toContain("lookupEntity");
    expect(SYSTEM_PROMPT).toContain("aggregateEvents");
    expect(SYSTEM_PROMPT).toContain("searchBook");
  });

  it("forbids past-position speculation and training-data fallback", () => {
    expect(SYSTEM_PROMPT).toContain("reading position");
    expect(SYSTEM_PROMPT).toContain("Don't fall back to training-data knowledge");
  });

  it("does not contain a glossary block (spoiler-unsafe by design)", () => {
    // Ruling (2026-10-02): 011's buildGlossary is dropped — a glossary loaded
    // once per instance cannot be position-gated, and entity rows include
    // late-reveal identities. Alias mapping stays in the position-gated
    // lookupEntity tool.
    expect(SYSTEM_PROMPT.toLowerCase()).not.toContain("glossary");
  });
});
