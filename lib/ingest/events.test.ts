import { describe, expect, it } from "vitest";
import {
  passesEntityTypeGate,
  passesKeywordGate,
  parseEventJson,
  EventResolver,
  detectTarotSessionContext,
  type ResolverEntity,
} from "./events";

describe("detectTarotSessionContext", () => {
  it("fires on Grey Fog setting cue alone", () => {
    const r = detectTarotSessionContext(
      "The four of them sat above the Grey Fog around the long table.",
    );
    expect(r.inSession).toBe(true);
    expect(r.cues).toContain("above-the-Grey-Fog");
  });

  it("fires on ≥2 distinct codenames in proper-noun position", () => {
    const r = detectTarotSessionContext(
      'The Hanged Man inclined his head. "I agree," said Justice quietly.',
    );
    expect(r.inSession).toBe(true);
    expect(r.cues.some((c) => c.endsWith("codenames-in-use"))).toBe(true);
  });

  it("does not double-count Justice inside Miss Justice", () => {
    const r = detectTarotSessionContext(
      "Miss Justice nodded gracefully and resumed her seat.",
    );
    // Only "Miss Justice" should match (not also bare "Justice"). One codename
    // alone should NOT trigger session-in-progress.
    expect(r.inSession).toBe(false);
  });

  it("fires on explicit Tarot Club mention", () => {
    const r = detectTarotSessionContext(
      "Klein resolved to share the diary pages with the Tarot Club next session.",
    );
    expect(r.inSession).toBe(true);
    expect(r.cues).toContain("Tarot-Club-named");
  });

  it("does NOT fire on a single codename in non-session narration", () => {
    const r = detectTarotSessionContext(
      "Klein, also known as The Fool to a select few, sipped his coffee in his Backlund apartment.",
    );
    expect(r.inSession).toBe(false);
  });

  it("does NOT fire on ordinary narrative prose", () => {
    const r = detectTarotSessionContext(
      "The grey fog swirled gently around the long mahogany table. Klein adjusted his cuff.",
    );
    // "grey fog" alone (without "above the Grey Fog") shouldn't fire.
    expect(r.inSession).toBe(false);
  });
});

describe("passesKeywordGate", () => {
  it("matches sequence_advance keywords", () => {
    expect(passesKeywordGate("Klein advanced to Sequence 7.")).toBe(true);
    expect(passesKeywordGate("He drank the Magician potion.")).toBe(true);
    expect(passesKeywordGate("The Sequence 5 ascension was complete.")).toBe(true);
  });

  it("matches digestion keywords", () => {
    expect(passesKeywordGate("Klein had finished digesting the Faceless potion.")).toBe(true);
    expect(passesKeywordGate("Fully digested at last.")).toBe(true);
  });

  it("matches meeting keywords", () => {
    expect(passesKeywordGate("The Tarot Club gathered above the Grey Fog.")).toBe(true);
    expect(passesKeywordGate("He summoned the members.")).toBe(true);
  });

  it("matches organization_join keywords", () => {
    expect(passesKeywordGate("Audrey was inducted into the Club.")).toBe(true);
    expect(passesKeywordGate("She joined the Nighthawks.")).toBe(true);
    expect(passesKeywordGate("Klein became a member of the team.")).toBe(true);
  });

  it("matches battle keywords (original + augmented)", () => {
    expect(passesKeywordGate("They fought through the night.")).toBe(true);
    expect(passesKeywordGate("Klein clashed with the Demoness.")).toBe(true);
    expect(passesKeywordGate("The blade stabbed deep.")).toBe(true);
    expect(passesKeywordGate("She slashed at the demon.")).toBe(true);
    expect(passesKeywordGate("Klein unleashed a barrage of spells.")).toBe(true);
    expect(passesKeywordGate("The Hunter was wounded badly.")).toBe(true);
    expect(passesKeywordGate("The convoy was ambushed at dawn.")).toBe(true);
  });

  it("matches death keywords", () => {
    expect(passesKeywordGate("Bishop Utopia died in the skirmish.")).toBe(true);
    expect(passesKeywordGate("He had been slain.")).toBe(true);
    expect(passesKeywordGate("The deceased priest left no will.")).toBe(true);
  });

  it("matches identity_assume keywords", () => {
    expect(passesKeywordGate("Posing as Sherlock Moriarty, he met the client.")).toBe(true);
    expect(passesKeywordGate("He took the identity of Gehrman Sparrow.")).toBe(true);
    expect(passesKeywordGate("She called herself Daly.")).toBe(true);
  });

  it("matches identity_reveal keywords", () => {
    expect(passesKeywordGate("Klein's true identity was revealed.")).toBe(true);
    expect(passesKeywordGate('"I am Klein Moretti," he said.')).toBe(true);
  });

  it("rejects narrative chunks with no event signals", () => {
    expect(
      passesKeywordGate(
        "The grey fog swirled gently around the long mahogany table. Klein adjusted his cuff and looked out at the rooftops of Backlund.",
      ),
    ).toBe(false);
    expect(
      passesKeywordGate(
        "She sipped her tea and considered the painting on the wall. The afternoon light through the bay window was warm.",
      ),
    ).toBe(false);
  });

  it("does not match the false-positive verb 'engaged' alone", () => {
    expect(
      passesKeywordGate("She engaged the coachman in conversation about the weather."),
    ).toBe(false);
  });
});

describe("passesEntityTypeGate", () => {
  it("passes if chunk has at least one character mention", () => {
    expect(
      passesEntityTypeGate(new Set(["character", "location"])),
    ).toBe(true);
  });
  it("passes if chunk has at least one organization mention", () => {
    expect(passesEntityTypeGate(new Set(["organization"]))).toBe(true);
  });
  it("rejects chunks with only locations/artifacts/pathways", () => {
    expect(
      passesEntityTypeGate(new Set(["location", "artifact", "pathway"])),
    ).toBe(false);
  });
  it("rejects chunks with no mentions at all", () => {
    expect(passesEntityTypeGate(new Set())).toBe(false);
  });
});

const SAMPLE_CHUNK =
  'Klein advanced to Sequence 7. "I am the Magician now," he muttered. The Tarot Club had not yet been told.';

describe("parseEventJson", () => {
  it("parses a valid sequence_advance event", () => {
    const json = JSON.stringify([
      {
        entity_canonical_name: "Klein Moretti",
        event_type: "sequence_advance",
        snippet: "Klein advanced to Sequence 7.",
        extra: { sequence: 7, pathway: "Fool" },
      },
    ]);
    const out = parseEventJson(json, SAMPLE_CHUNK);
    expect(out).toHaveLength(1);
    expect(out[0].event_type).toBe("sequence_advance");
    expect(out[0].extra).toEqual({ sequence: 7, pathway: "Fool" });
  });

  it("drops events with unknown event_type", () => {
    const json = JSON.stringify([
      {
        entity_canonical_name: "Klein Moretti",
        event_type: "marriage",
        snippet: "Klein advanced to Sequence 7.",
      },
    ]);
    expect(parseEventJson(json, SAMPLE_CHUNK)).toHaveLength(0);
  });

  it("drops events whose snippet is not in the chunk text", () => {
    const json = JSON.stringify([
      {
        entity_canonical_name: "Klein Moretti",
        event_type: "sequence_advance",
        snippet: "Klein flew to the moon.",
      },
    ]);
    expect(parseEventJson(json, SAMPLE_CHUNK)).toHaveLength(0);
  });

  it("tolerates Haiku wrapping the array in markdown fences", () => {
    const json = "```json\n" + JSON.stringify([
      { entity_canonical_name: "Klein Moretti", event_type: "sequence_advance", snippet: "advanced to Sequence 7" },
    ]) + "\n```";
    expect(parseEventJson(json, SAMPLE_CHUNK)).toHaveLength(1);
  });

  it("returns empty array for empty / malformed JSON", () => {
    expect(parseEventJson("[]", SAMPLE_CHUNK)).toEqual([]);
    expect(parseEventJson("not json at all", SAMPLE_CHUNK)).toEqual([]);
  });

  it("strips a <thinking>...</thinking> scratchpad before parsing", () => {
    const raw =
      "<thinking>\n- Candidates: [Klein, Audrey]\n- attendees: [1, 2, 3]\n</thinking>\n\n" +
      JSON.stringify([
        {
          entity_canonical_name: "Klein Moretti",
          event_type: "sequence_advance",
          snippet: "Klein advanced to Sequence 7.",
          extra: { sequence: 7 },
        },
      ]);
    const out = parseEventJson(raw, SAMPLE_CHUNK);
    expect(out).toHaveLength(1);
    expect(out[0].event_type).toBe("sequence_advance");
  });

  it("defaults extra to {} when omitted", () => {
    const json = JSON.stringify([
      { entity_canonical_name: "Klein Moretti", event_type: "death", snippet: "advanced to Sequence 7" },
    ]);
    const out = parseEventJson(json, SAMPLE_CHUNK);
    expect(out[0].extra).toEqual({});
  });
});

const ENTITIES_FIXTURE: ResolverEntity[] = [
  { id: 1, canonicalName: "Klein Moretti", entityType: "character", aliases: ["Klein", "Sherlock Moriarty"] },
  { id: 2, canonicalName: "Tarot Club", entityType: "organization", aliases: [] },
  { id: 3, canonicalName: "Backlund", entityType: "location", aliases: [] },
];

describe("EventResolver", () => {
  it("resolves a known canonical name", () => {
    const r = new EventResolver(ENTITIES_FIXTURE);
    expect(r.resolve("Klein Moretti", "sequence_advance")).toEqual({ id: 1, entityType: "character" });
  });

  it("resolves a known alias to its canonical entity", () => {
    const r = new EventResolver(ENTITIES_FIXTURE);
    expect(r.resolve("Sherlock Moriarty", "identity_assume")).toEqual({ id: 1, entityType: "character" });
  });

  it("returns null for unknown entities (no novel creation)", () => {
    const r = new EventResolver(ENTITIES_FIXTURE);
    expect(r.resolve("Unknown Person", "death")).toBeNull();
  });

  it("rejects type-purity violations: location subject of sequence_advance", () => {
    const r = new EventResolver(ENTITIES_FIXTURE);
    expect(r.resolve("Backlund", "sequence_advance")).toBeNull();
  });

  it("allows organization as meeting subject", () => {
    const r = new EventResolver(ENTITIES_FIXTURE);
    expect(r.resolve("Tarot Club", "meeting")).toEqual({ id: 2, entityType: "organization" });
  });

  it("allows character as meeting subject (attendee fallback)", () => {
    const r = new EventResolver(ENTITIES_FIXTURE);
    expect(r.resolve("Klein Moretti", "meeting")).toEqual({ id: 1, entityType: "character" });
  });
});
