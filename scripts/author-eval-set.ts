/**
 * One-off (ticket 014, reopening Task 21): patches data/eval/eval-set.jsonl
 * ground truth authored from INDEPENDENT evidence (events pipeline, chapter
 * summaries, lexical text search — not the embedding retrieval being scored).
 * Evidence sources are recorded per entry in `notes`.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PATH = "data/eval/eval-set.jsonl";

// Chapters where the concept/event first appears, from independent pipelines.
const AUTHORING: Record<string, { chapters?: number[]; status: "verified" | "draft"; note: string }> = {
  Q007: {
    status: "draft",
    note: "Candidates [777,884,1013,1032] from '22 pathways' text hits; full list answer spans late volumes — needs human verification.",
  },
  Q008: {
    chapters: [207, 210],
    status: "verified",
    note: "Authored 2026-10-02: earliest lotm1 explanatory chapters for Beyonder Characteristics (lexical text search).",
  },
  Q009: {
    chapters: [1224],
    status: "verified",
    note: "Authored 2026-10-02: earliest lotm1 Uniqueness-for-Sequence-0 explanation (lexical search; ch.15 hit is the generic word, not the concept).",
  },
  Q010: {
    chapters: [1224, 1271],
    status: "verified",
    note: "Authored 2026-10-02: earliest lotm1 Outer Deity discussion chapters (lexical search).",
  },
  Q011: {
    chapters: [60],
    status: "verified",
    note: "Authored 2026-10-02: ch.60 'Second Blasphemy Slate' — the slate's introduction (lexical search).",
  },
  Q012: {
    chapters: [57, 126],
    status: "verified",
    note: "Authored 2026-10-02: ch.57 = digestion-through-acting doctrine; ch.126 = first complete digestion (summaries + lexical).",
  },
  Q014: {
    chapters: [5, 6, 7],
    status: "verified",
    note: "Authored 2026-10-02: Audrey first appears ch.5, pathway offered ch.6, codename Justice ch.7 (summaries + events pipeline).",
  },
  Q015: {
    chapters: [5, 6, 7],
    status: "verified",
    note: "Authored 2026-10-02: Alger first appears ch.5, formula trade ch.6, codename Hanged Man ch.7 (summaries + events pipeline).",
  },
  Q016: {
    chapters: [4, 10],
    status: "verified",
    note: "Authored 2026-10-02: earliest Roselle mentions in lotm1 (lexical search).",
  },
  Q017: {
    status: "draft",
    note: "Candidates [8,14,104,109] (early Amon mentions); the Amon–Fool-pathway relationship explanation is late-corpus — needs human verification.",
  },
  Q019: {
    chapters: [60, 61],
    status: "verified",
    note: "Authored 2026-10-02: the Second Blasphemy Slate chapters show the Fool pathway ladder (lexical search).",
  },
  Q020: {
    status: "draft",
    note: "Needs wiki lore_pathway('Tyrant') cross-check for the Uniqueness holder — human verification.",
  },
  Q021: {
    chapters: [76, 79],
    status: "verified",
    note: "Authored 2026-10-02: formula discussion ch.76, side-effects murmuring ch.79 (lexical search).",
  },
  Q022: {
    status: "draft",
    note: "Sleepless hits from ch.9 are generic; Leonard's codename in the question may be canon-miswritten (not an early Tarot member) — human verification.",
  },
  Q023: {
    status: "draft",
    note: "Seven-gods listing candidates [60,61,62]; hidden Sequence 0s span late volumes — needs human verification.",
  },
  Q024: {
    chapters: [6, 7],
    status: "verified",
    note: "Authored 2026-10-02: ch.6 = first gathering, ch.7 = call signs + founding ('founding members' snippet, events pipeline).",
  },
  Q025: {
    chapters: [6, 7],
    status: "verified",
    note: "Authored 2026-10-02: Audrey joins at the first gathering (summaries + events pipeline).",
  },
  Q026: {
    chapters: [295],
    status: "verified",
    note: "Authored 2026-10-02: 'drank the Magician potion' / sequence 7 at ch.295 (events pipeline).",
  },
  Q027: {
    chapters: [34, 35],
    status: "verified",
    note: "Authored 2026-10-02: ch.34-35 = the meeting chapters where the Roselle-diary exchange begins (summaries; ch.35 mission snippet).",
  },
  Q028: {
    chapters: [483],
    status: "verified",
    note: "Authored 2026-10-02: Gehrman Sparrow first assumed as bounty-hunter cover for the sea voyage (events pipeline).",
  },
  Q029: {
    status: "draft",
    note: "First-prayer phrasing candidates [6,7,33,58,61]; exact quote needs human verification.",
  },
  Q030: {
    chapters: [67],
    status: "verified",
    note: "Authored 2026-10-02: ch.67 'Response' = Klein's reply chapter to Justice's first private exchange (lexical search).",
  },
  Q031: {
    status: "draft",
    note: "Amon-to-Klein dialogue candidates [104,109,112,113]; first SPOKEN words need human verification.",
  },
  Q032: {
    status: "draft",
    note: "Hanged Man first appears ch.6-7; the past-discussion chapter needs human verification.",
  },
  Q033: {
    chapters: [58, 61],
    status: "verified",
    note: "Authored 2026-10-02: invocation first recited ch.58 (Klein, above the fog) and ch.61 (Audrey) (lexical search).",
  },
  Q034: {
    chapters: [6, 7, 33, 34, 35, 36, 58, 59],
    status: "verified",
    note: "Authored 2026-10-02: first 8 distinct meeting chapters (events pipeline, entity 'Tarot Club'). 'Every meeting' exceeds top-8 — recall is a lower bound by design.",
  },
  Q035: {
    chapters: [1, 7, 215, 264, 483, 633, 722, 732, 1290],
    status: "verified",
    note: "Authored 2026-10-02: identity first-use chapters (events pipeline identity_assume). 9 expected — recall@8 caps at 8/9 by design.",
  },
  Q036: {
    chapters: [126, 180, 428, 586, 601, 660, 883, 946, 1137],
    status: "verified",
    note: "Authored 2026-10-02: digestion chapters in order (events pipeline). 9 expected — recall@8 caps at 8/9 by design.",
  },
  Q037: {
    status: "draft",
    note: "Sealed-artifact designation sweep needs a corpus regex pass — not authored here; human verification.",
  },
  Q038: {
    status: "draft",
    note: "Outer-deity name list candidates [1224,1271]; full list not independently confirmed — human verification.",
  },
  Q039: {
    chapters: [210, 664, 750, 1137, 1176, 1216, 1267],
    status: "verified",
    note: "Authored 2026-10-02: first Seq-5+ advance chapters per character (events pipeline; Ince 210, Klein 664, Soest 750, Klein 1137/1267, Colin 1176, Waite 1216).",
  },
  Q040: {
    status: "draft",
    note: "Seq-0 candidates from events: lotm1 [822,1272,1352,1377,1380,1381], coi [494,1089,1140,1166]; noisy (org rows + failed attempts) — needs human verification.",
  },
};

const lines = readFileSync(PATH, "utf8")
  .split("\n")
  .map((l) => {
    const t = l.trim();
    if (!t || t.startsWith("//")) return l;
    const e = JSON.parse(t);
    const spec = AUTHORING[e.id];
    if (spec) {
      if (spec.chapters) e.expected_chapters = spec.chapters;
      e.status = spec.status;
      e.notes = e.notes ? `${e.notes} | ${spec.note}` : spec.note;
      if (e.id === "Q035") {
        // 007's flagged error: Benson Moretti is Klein's brother, not an identity.
        e.expected_entities = e.expected_entities.filter(
          (n: string) => n !== "Benson Moretti",
        );
        e.notes = `${e.notes} | Removed 'Benson Moretti' from expected_entities per ticket 007's flag.`;
      }
      if (e.id === "Q039") e.reading_position = { lotm1: 1432, coi: null };
      if (e.id === "Q040") e.reading_position = { lotm1: 1432, coi: 1181 };
    }
    return JSON.stringify(e);
  });

writeFileSync(PATH, lines.join("\n") + "\n");
console.log("patched eval-set.jsonl");
