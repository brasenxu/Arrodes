/**
 * Named-entity extraction for chunked corpus text.
 *
 * Two-phase pipeline per chunk:
 *   Phase A — exact-match regex scan against the alias table.
 *   Phase B — Haiku call for chunks with dialogue OR zero Phase A hits. Returns
 *             JSON [{entity_name, entity_type, role}]. Haiku's role info is
 *             authoritative; Phase A fills in any canonical entity Haiku missed
 *             (with role=null).
 *
 * Prompt caching (1h ephemeral, two breakpoints, Anthropic-native):
 *   1. catalogBlock — NER primer + full entity catalog. Byte-identical across
 *      the entire ingest, so it cache-reads across the whole corpus after the
 *      very first chunk writes it.
 *   2. chapterBlock — chapter header + full raw text. Byte-identical within a
 *      chapter; cache-reads ~N-1 times per chapter after the first chunk in
 *      that chapter warms it.
 *
 * Combined cached prefix is comfortably above Haiku 4.5's 4096-token minimum.
 *
 * Entity resolution: the catalog block instructs Haiku to use canonical names
 * from the seed, so most returned names are already resolvable. Fall-through
 * order: exact canonical → case-insensitive canonical/alias lookup → create a
 * new entity. Creation is race-safe via ON CONFLICT DO UPDATE ... RETURNING id,
 * serialized in-process by a promise-chain mutex so duplicate names arriving
 * from concurrent chunks funnel to the same new row.
 */

import { generateText, type LanguageModel } from "ai";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export type Role = "speaker" | "addressee" | "mentioned";

const ENTITY_TYPES = [
  "character",
  "organization",
  "pathway",
  "artifact",
  "location",
] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

export type NerUsage = {
  noCacheInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  haikuCalls: number;
};

export const zeroNerUsage = (): NerUsage => ({
  noCacheInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  haikuCalls: 0,
});

export function addNerUsage(target: NerUsage, delta: NerUsage): void {
  target.noCacheInputTokens += delta.noCacheInputTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.cacheWriteTokens += delta.cacheWriteTokens;
  target.outputTokens += delta.outputTokens;
  target.haikuCalls += delta.haikuCalls;
}

// ---------------------------------------------------------------------------
// Entity loading + alias index
// ---------------------------------------------------------------------------

export type EntityRecord = {
  id: number;
  canonicalName: string;
  entityType: string;
  aliases: string[];
};

export type AliasIndex = {
  // Regex patterns sorted longest-first. Longest-first + a consumed-range mask
  // prevents "Klein" matching inside a "Klein Moretti" span.
  patterns: Array<{ name: string; regex: RegExp; entityId: number }>;
  // Case-insensitive lookup: lowered name → entityId. Used by the resolver
  // when Haiku returns something that is a known alias under different casing.
  nameLookup: Map<string, number>;
  byId: Map<number, EntityRecord>;
  entities: EntityRecord[];
};

export async function loadEntities(): Promise<EntityRecord[]> {
  const rows = await db
    .select({
      id: schema.entities.id,
      canonicalName: schema.entities.canonicalName,
      entityType: schema.entities.entityType,
      aliases: schema.entities.aliases,
    })
    .from(schema.entities);
  return rows.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    entityType: r.entityType,
    aliases: (r.aliases ?? []) as string[],
  }));
}

export function buildAliasIndex(entities: EntityRecord[]): AliasIndex {
  const patterns: AliasIndex["patterns"] = [];
  const nameLookup = new Map<string, number>();
  const byId = new Map<number, EntityRecord>();

  for (const e of entities) {
    byId.set(e.id, e);
    const names = [e.canonicalName, ...e.aliases];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      nameLookup.set(trimmed.toLowerCase(), e.id);
      // Use lookaround word boundaries (rather than \b) so names ending in or
      // containing punctuation like "Mr." match correctly. Case-sensitive on
      // purpose: LOTM character names are proper nouns and lowercasing "Justice"
      // (Audrey's alias) would false-positive on ordinary English.
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patterns.push({
        name: trimmed,
        regex: new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "g"),
        entityId: e.id,
      });
    }
  }

  patterns.sort((a, b) => b.name.length - a.name.length);
  return { patterns, nameLookup, byId, entities };
}

// Scan chunk content for alias matches. Returns entityId → hit count.
// Longest-first + consumed-range mask prevents "Klein" double-counting inside
// "Klein Moretti" matches.
export function scanAliases(
  content: string,
  index: AliasIndex,
): Map<number, number> {
  const hits = new Map<number, number>();
  const consumed: Array<[number, number]> = [];

  for (const p of index.patterns) {
    p.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.regex.exec(content)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      let overlap = false;
      for (const [s, e] of consumed) {
        if (start < e && end > s) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        consumed.push([start, end]);
        hits.set(p.entityId, (hits.get(p.entityId) ?? 0) + 1);
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Prompt blocks
// ---------------------------------------------------------------------------

const NER_INSTRUCTION_HEADER = `TASK: Extract named entities from a chunk of novel text for a retrieval index.

You are analyzing chunks from "Lord of the Mysteries" (LOTM) and its sequel "Circle of Inevitability" (COI). For each chunk you are shown, identify EVERY named entity (character, organization, pathway, location, or artifact) that is present in the chunk, plus the role that entity plays in the chunk.

SPEAKER IDENTIFICATION ALGORITHM (apply this FIRST, before deciding any role):
Before classifying any entity, scan the chunk for every quoted utterance (text enclosed in "..." or "..."). For each such utterance:
  1. Look in the same sentence, the sentence just before, and the sentence just after for an attribution verb — said, replied, asked, muttered, whispered, chuckled, exclaimed, sighed, snapped, continued, added, began, remarked, observed, declared, hissed, laughed, shouted, murmured, answered, responded, called out, retorted, nodded (when followed by quoted speech), thought, wondered, repeated, interjected.
  2. The named subject of that attribution verb is the SPEAKER of that utterance. Mark them as role="speaker".
  3. If the quoted line contains a direct vocative ("Klein, listen...", "Miss Justice, what do you think?") or the attribution names a target ("said to Klein"), that named entity is the ADDRESSEE — mark role="addressee".

Only after running this algorithm for every quoted utterance do you assign "mentioned" to the remaining named entities.

ROLES (choose exactly one per entity, per chunk):
- "speaker"    — the character whose direct quoted speech appears IN THIS CHUNK (the chunk itself contains the quoted line). Identified by the SPEAKER ALGORITHM above.
- "addressee"  — a character being directly addressed in dialogue WITHIN THIS CHUNK (vocative call, "X said to Y", "Y, listen to me").
- "mentioned"  — any other named entity that is referenced in the chunk but is not speaking or being addressed in this chunk. This is the DEFAULT ONLY AFTER speaker/addressee have been exhausted.

If the chunk is pure narration referencing prior speech (e.g., "After hearing Alger's words, Klein sighed"), treat the characters as "mentioned" — neither is speaking IN THIS CHUNK; the speech happened elsewhere.

ROLE BIAS CORRECTION (important):
"mentioned" is the safest-looking default and is over-used by NER systems. Actively push against this. Under-labeling speakers and addressees is a worse error than over-labeling them; prefer speaker/addressee over mentioned whenever the chunk's quoted lines plausibly support it. If you are 50/50 on whether someone is a speaker or merely mentioned, pick speaker.

HARD SKIP LIST (these strings are NEVER entities, even when capitalized):
- Bare sequence-level references: "Sequence 0", "Sequence 1", "Sequence 2", ..., "Sequence 9", "Sequence 10", "Sequence 0-8", etc. — structural ordinal references, not entities.
- Bare common-noun Beyonder terminology: "Beyonder", "Beyonders", "Beyonder characteristic", "Beyonder power", "potion", "ritual", "digestion", "acting method", "spirit vision", "divination", "spirit body threading" — these are system mechanics, not named entities, even when capitalized as "Beyonder" in the chapter.
- Generic rank/role words standing alone: "Captain", "Bishop", "Professor", "Officer", "Sergeant", "Detective", "Lord", "Lady", "Madam" (unless fused with a name in the chunk: "Captain Dunn" is an entity → resolve via catalog).
- Historical periods that are common nouns or eras not treated as a named entity in the chunk: "Iron Age", "Age of the Gods", "Fourth Epoch", "Tudor Dynasty" — skip UNLESS the chunk treats one specifically as a proper-name subject (e.g., "The Iron Age ended when..." where it is the grammatical focus, not background context). When in doubt, skip.
- Generic plural forms of organizations: "Churches", "Kingdoms", "Orders", "Empires" — plural common nouns, not entities.
- Generic pluralized or possessive suffixes of larger names: if the chunk mentions "Keepers of the Seas", do NOT also return "Keepers" alone — see LONGEST-MATCH.

ROLE EXAMPLES (these are representative, not exhaustive — they illustrate the three role types):

Example 1 — standard attributed dialogue:
Chunk text:
  "We need to move quickly," Klein said. Alger nodded without replying, his eyes on the ocean.
Correct output:
  [{"entity_name":"Klein Moretti","entity_type":"character","role":"speaker"},{"entity_name":"Alger Wilson","entity_type":"character","role":"mentioned"}]

Example 2 — dialogue with a direct addressee:
Chunk text:
  Klein turned to Audrey. "Miss Justice, what do you think of this arrangement?"
Correct output:
  [{"entity_name":"Klein Moretti","entity_type":"character","role":"speaker"},{"entity_name":"Audrey Hall","entity_type":"character","role":"addressee"}]

Example 3 — narration referencing speech that is not in this chunk:
Chunk text:
  After hearing Alger's words, Klein sighed. He had not expected the Hanged Man to be so direct.
Correct output:
  [{"entity_name":"Alger Wilson","entity_type":"character","role":"mentioned"},{"entity_name":"Klein Moretti","entity_type":"character","role":"mentioned"}]

Example 4 — multi-speaker exchange in one chunk:
Chunk text:
  "I disagree," Cattleya said coldly. "The plan is reckless."
  Audrey met her gaze. "We have no better option, Miss Hermit."
Correct output:
  [{"entity_name":"Cattleya","entity_type":"character","role":"speaker"},{"entity_name":"Audrey Hall","entity_type":"character","role":"speaker"}]
(Cattleya is both speaker and addressee of Audrey's line; speaker > addressee per the tiebreaker.)

OUTPUT FORMAT:
Return a JSON array and nothing else. Each element must be an object of the shape:
  {"entity_name": "<string>", "entity_type": "<character|organization|pathway|artifact|location>", "role": "<speaker|addressee|mentioned>"}

Rules for the output:
- No prose, no markdown fences, no commentary — a bare JSON array is the entire response.
- If the chunk contains no named entities at all, return [].
- Return each distinct entity at most once per chunk. If one entity both speaks and is addressed in the chunk, prefer "speaker".
- Do not return pronouns ("he", "she", "they", "it") as entities.
- Do not return common nouns or role words ("the butler", "a soldier", "the officer", "Beyonder", "the old man", "my father", "that bishop") unless the chunk treats them as a proper name for a specific entity.
- Pathway-name vs common-word disambiguation. Many pathway and sequence-title names are also ordinary English words — pathways: Fool, Error, Door, Visionary, Sun, Tyrant, White Tower, Hanged Man, Darkness, Death, Twilight Giant, Demoness, Red Priest, Hermit, Paragon, Wheel of Fortune, Mother, Moon, Abyss, Chained, Black Emperor, Justiciar; sequence titles: Sailor, Prisoner, Apprentice, Hunter, Clown, Seer, Magician, Sleepless, Author, and so on. Return these as pathway entities ONLY when the chunk uses them as a pathway or sequence-title reference — signaled by capitalization in proper-noun position AND by proximity to Beyonder vocabulary ("Sequence", "pathway", "Beyonder", "demigod", "potion", "ritual", "uniqueness", "acting method"). Exclude ordinary-noun usages ("his mother cried", "the sun rose", "the door opened", "his death", "in darkness", "the sailors on deck"). Note on overlaps: "Fool" / "The Fool" resolves to Klein Moretti (Mr. Fool / Tarot Club) — the catalog alias handles this, do not return the Fool Pathway unless the chunk is explicitly discussing the pathway itself. Same treatment for "Hermit" / "The Hermit" → Cattleya, and "Magician" / "The Magician" → Fors Wall.
- VERBATIM RULE (strict): Every entity you return must satisfy ONE of the following: (i) its exact name string appears literally in the chunk text, OR (ii) its canonical_name or one of its aliases in the CANONICAL ENTITIES catalog appears literally in the chunk text (in which case you return the canonical_name). If neither holds, do NOT return the entity — no matter how contextually plausible it seems. Specifically: do NOT fill in taxonomy-adjacent names just because they belong to the same system as something that IS in the chunk. Example: if the chunk names "Author" and "Spectator" (both sequence titles of the Visionary pathway), do NOT also return "Visionary", "Mystery Pryer", or any other Visionary sequence title — only return what the chunk actually contains. Example: if the chunk names "Klein", you may return "Klein Moretti" (the catalog lists "Klein" as an alias) but you may NOT return "Benson Moretti" just because he is Klein's brother.

COMPLETENESS RULE (critical for recall):
Return EVERY distinct named entity in the chunk. Do not omit an entity because it appears only briefly, in a list, or as a minor reference. A chunk mentioning "the Aurora Order, the Trunsoest Empire, and Saint Samuel" should return three entities, not one.

When deciding whether a candidate string is a proper-noun entity, apply this test:
(a) is the string capitalized in proper-noun position (not merely sentence-start, not a heading)? AND
(b) does the chunk treat the string as a specific named referent (a person, org, place, pathway, artifact — not a role word like "the officer" or a common noun like "the cathedral")?
If both hold, include it. If only (a) holds (it is capitalized but used as a common noun like "the Cathedral" referring to a generic cathedral), exclude it. Do NOT include a candidate merely because a similar entity exists elsewhere in the story — the string must be acting as a name in THIS chunk.

ENTITY TYPE EXAMPLES (be generous — include any proper noun that fits any of these):
- character  : named individuals ("Klein Moretti", "Saint Samuel", "Mr. X" when used as a name), including gods by name ("Evernight Goddess", "God of Steam and Machinery"), even if they appear only briefly or in historical/religious references.
- organization: churches, empires, kingdoms, orders, societies, noble/blood families, bureaus, councils ("Aurora Order", "Church of the Evernight Goddess", "Antigonus Family", "MI9", "Tarot Club", "Trunsoest Empire" — empires are usually organizations).
- pathway    : any of the 22 pathway names ("Fool Pathway"), or Sequence 9 title words used to refer to the pathway as an abstraction ("Apprentice", "Seer", "Sailor", "Spectator", "Mystery Pryer", "Prisoner", "Sleepless").
- location   : nations, cities, continents, named geographic features, named buildings, named streets ("Backlund", "Tingen", "East Balam", "Sonia Sea", "Pelican Street", "Saint Samuel Cathedral").
- artifact   : named supernatural items, sealed artifacts by code or name, named books, scriptures, named documents ("Blood-Stained Crown", "Sealed Artifact 0-08", "The Revelation of Evernight's Book of Wisdom", "Letters of the Saints").
    • Sealed-artifact codes: strings of the form N-NN, N-NNN, or letter-number ("0-08", "1-42", "2-049", "X-05") are artifact entities. Return the bare code verbatim including the hyphen. If the chunk writes the longer form "Sealed Artifact 0-08", return the longer form per the longest-match rule; if only "0-08" appears, return "0-08".

NAMING RULES (important — the index depends on this):
1. If an entity present in the chunk also appears in the CANONICAL ENTITIES list below (under its canonical_name or any of its aliases), return the canonical_name verbatim. Example: the chunk says "Sherlock Moriarty" → return "Klein Moretti" (because Sherlock Moriarty is a listed alias of Klein Moretti).
2. If an entity is not in the catalog, return the MOST COMPLETE form of the name that appears in the chunk or surrounding chapter. If the chapter uses "Ian" and "Ian Wright" for the same person, return "Ian Wright". If it uses "Elektra" and the title "Bishop" is not established as part of her name, return "Elektra" — do not add titles that are descriptive rather than part of the name.
3. Do not invent canonicalizations or merge distinct nearby names (e.g., "East Balam" and "West Balam" are separate entities, not a single "Balam Empire" unless the chunk names "Balam Empire" itself).
4. Character nicknames or titles that the chunk uses inline (e.g., "the old professor" as a known character reference) should resolve to the canonical name if one exists; otherwise return what the chunk says.
5. LONGEST-MATCH RULE (critical — prevents double-counting). When a candidate name is a prefix, suffix, or substring of another named entity that ALSO appears in the chunk, return only the longest form. Do not also return the shorter sub-name as a separate entity. Examples:
   - Chunk contains "Sun Brooch" → return "Sun Brooch" only. Do NOT also return "Sun".
   - Chunk contains "Wraith Steve" → return "Wraith Steve" only. Do NOT also return "Steve".
   - Chunk contains "Luke Sammer" → return "Luke Sammer" only. Do NOT also return "Luke".
   - Chunk contains "Earth Mother Lilith" → return "Earth Mother Lilith" only. Do NOT also return "Earth", "Earth Mother", or "Lilith" separately.
   - Chunk contains both "East Balam" AND "West Balam" → return BOTH ("East Balam" and "West Balam" are distinct entities — neither is a sub-string of the other).
   Exception: if the chunk uses both forms to refer to different entities (rare — e.g., "Steve" in one sentence referring to a known character and "Wraith Steve" elsewhere referring to a different individual), return both. This exception should almost never fire; default to the longest-match collapse.

CANONICAL ENTITIES (resolve chunk mentions to these canonical_name values when a match exists under canonical_name or any alias):
`;

// Catalog block: NER instructions + per-entity bullet with aliases. Stable
// byte-for-byte across the whole ingest — this block cache-reads across every
// chunk of every chapter after the very first call of the run.
export function buildCatalogBlock(entities: EntityRecord[]): string {
  const bullets = entities
    .slice()
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
    .map((e) => {
      const aliasPart =
        e.aliases.length > 0 ? ` — aliases: ${e.aliases.join(", ")}` : "";
      return `- ${e.canonicalName} (${e.entityType})${aliasPart}`;
    })
    .join("\n");
  return `${NER_INSTRUCTION_HEADER}${bullets}`;
}

function buildChapterBlock(
  chapter: {
    bookId: string;
    chapterNum: number;
    chapterTitle: string;
    rawText: string;
  },
): string {
  const header = `${chapter.bookId.toUpperCase()} Chapter ${chapter.chapterNum}: ${chapter.chapterTitle}`;
  return `<document title=${JSON.stringify(header)}>\n${chapter.rawText}\n</document>`;
}

function buildChunkQuery(chunkText: string): string {
  return `Now extract entities from this chunk of the document above:\n<chunk>\n${chunkText}\n</chunk>\n\nReturn only the JSON array.`;
}

// ---------------------------------------------------------------------------
// Haiku call + JSON parsing
// ---------------------------------------------------------------------------

type RawHaikuEntity = {
  name: string;
  type: EntityType;
  role: Role | null;
};

function parseHaikuJson(text: string): RawHaikuEntity[] {
  // Haiku is instructed to emit a bare JSON array, but tolerate stray prose
  // or ``` fences — cheaper than one failed run.
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = s.slice(start, end + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: RawHaikuEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.entity_name === "string" ? obj.entity_name.trim() : "";
    if (!name) continue;
    const typeStr = typeof obj.entity_type === "string" ? obj.entity_type.trim().toLowerCase() : "";
    const type: EntityType = (ENTITY_TYPES as readonly string[]).includes(typeStr)
      ? (typeStr as EntityType)
      : "character";
    const roleStr = typeof obj.role === "string" ? obj.role.trim().toLowerCase() : "";
    const role: Role | null =
      roleStr === "speaker" || roleStr === "addressee" || roleStr === "mentioned"
        ? roleStr
        : null;
    out.push({ name, type, role });
  }
  return out;
}

async function extractWithHaiku(opts: {
  model: LanguageModel;
  catalogBlock: string;
  chapterBlock: string;
  chunkText: string;
}): Promise<{ entities: RawHaikuEntity[]; usage: NerUsage }> {
  const { model, catalogBlock, chapterBlock, chunkText } = opts;

  const result = await generateText({
    model,
    // temperature=0 is critical: NER is an extractive task and we want
    // reproducible output between the eval harness and the real corpus run.
    // Without pinning, scoring against ner-gold.jsonl becomes unreliable.
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: catalogBlock,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          {
            type: "text",
            text: chapterBlock,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          {
            type: "text",
            text: buildChunkQuery(chunkText),
          },
        ],
      },
    ],
  });

  const u = result.usage;
  const detailed = u.inputTokenDetails;
  const cacheRead = detailed?.cacheReadTokens ?? 0;
  const cacheWrite = detailed?.cacheWriteTokens ?? 0;
  const noCache =
    detailed?.noCacheTokens ??
    (typeof u.inputTokens === "number"
      ? Math.max(u.inputTokens - cacheRead - cacheWrite, 0)
      : 0);

  return {
    entities: parseHaikuJson(result.text),
    usage: {
      noCacheInputTokens: noCache,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: u.outputTokens ?? 0,
      haikuCalls: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Entity resolver
// ---------------------------------------------------------------------------

// Resolves a Haiku-returned name to an entity_id. In-memory cache seeded from
// the alias index; cache misses insert a new row (or attach to an existing one
// under a concurrency race). Serialized via a promise-chain mutex so two
// concurrent chunks returning the same novel name collapse to one insert.
//
// In dry-run mode, novel names are assigned negative pseudo-IDs instead of
// being written to the DB. Pending rows are tracked in `byId` so sample
// rendering can show the real name rather than a bare `entity#<id>` stub.
export class EntityResolver {
  private nameCache: Map<string, number>;
  private pendingById: Map<number, EntityRecord>;
  private mutex: Promise<void> = Promise.resolve();
  private createdCount = 0;
  private readonly dryRun: boolean;
  private nextPseudoId = -1;

  constructor(aliasIndex: AliasIndex, opts?: { dryRun?: boolean }) {
    this.nameCache = new Map(aliasIndex.nameLookup);
    this.pendingById = new Map();
    this.dryRun = opts?.dryRun ?? false;
  }

  newEntitiesCreated(): number {
    return this.createdCount;
  }

  pendingEntities(): Map<number, EntityRecord> {
    return this.pendingById;
  }

  async resolve(name: string, type: string): Promise<number | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    const hit = this.nameCache.get(key);
    if (hit !== undefined) return hit;

    // Serialize the create path — two chunks returning the same novel name
    // must not race into two separate entities.
    let release: () => void = () => {};
    const next = new Promise<void>((r) => {
      release = r;
    });
    const prev = this.mutex;
    this.mutex = next;
    try {
      await prev;
      const rehit = this.nameCache.get(key);
      if (rehit !== undefined) return rehit;
      const entityType = (ENTITY_TYPES as readonly string[]).includes(type)
        ? (type as EntityType)
        : "character";
      let id: number;
      if (this.dryRun) {
        id = this.nextPseudoId--;
        this.pendingById.set(id, {
          id,
          canonicalName: trimmed,
          entityType,
          aliases: [],
        });
      } else {
        id = await this.insertEntity(trimmed, entityType);
      }
      this.nameCache.set(key, id);
      this.createdCount++;
      return id;
    } finally {
      release();
    }
  }

  private async insertEntity(
    canonicalName: string,
    entityType: EntityType,
  ): Promise<number> {
    // ON CONFLICT DO UPDATE with a no-op assignment forces RETURNING to emit a
    // row whether the insert or the conflict path won. Matches seed-entities.ts
    // conventions (raw SQL; jsonb casts explicit under neon-http).
    const res = (await db.execute(sql`
      INSERT INTO entities (canonical_name, entity_type, aliases, is_spoiler, meta)
      VALUES (${canonicalName}, ${entityType}, '[]'::jsonb, 0, '{}'::jsonb)
      ON CONFLICT (canonical_name) DO UPDATE
        SET canonical_name = EXCLUDED.canonical_name
      RETURNING id
    `)) as unknown as { rows: { id: number }[] };
    const id = res.rows?.[0]?.id;
    if (id == null) {
      throw new Error(`Failed to upsert entity "${canonicalName}"`);
    }
    return id;
  }
}

// ---------------------------------------------------------------------------
// Per-chunk + per-chapter orchestration
// ---------------------------------------------------------------------------

export type ChapterMeta = {
  id: number;
  bookId: string;
  chapterNum: number;
  chapterTitle: string;
  rawText: string;
};

export type ChunkInput = {
  id: number;
  chunkIndex: number;
  content: string;
};

export type MentionRow = {
  entityId: number;
  chunkId: number;
  bookId: string;
  chapterNum: number;
  role: Role | null;
};

export type SampleRow = {
  chunkId: number;
  chunkIndex: number;
  contentPreview: string;
  calledHaiku: boolean;
  mentions: Array<{ canonicalName: string; role: Role | null }>;
};

export type NerChapterResult = {
  chunksProcessed: number;
  mentionsInserted: number;
  usage: NerUsage;
  samples?: SampleRow[];
};

const INTRA_CHAPTER_CONCURRENCY = 3;

// Heuristic: "has dialogue" means the chunk contains a quoted span of ≥8
// characters. The EPUB source uses curly quotes (U+201C/U+201D) almost
// exclusively, but tolerate ASCII "..." as well in case other sources land in
// the corpus. Filters out stray one-word exclamations in quotes and
// typesetting-style quotes around article titles.
const DIALOGUE_RE = /[“"][^“”"]{8,}[”"]/;

function roleRank(role: Role | null): number {
  switch (role) {
    case "speaker":
      return 3;
    case "addressee":
      return 2;
    case "mentioned":
      return 1;
    default:
      return 0;
  }
}

async function extractChunkMentions(opts: {
  chunk: ChunkInput;
  bookId: string;
  chapterNum: number;
  aliasIndex: AliasIndex;
  entityResolver: EntityResolver;
  model: LanguageModel;
  catalogBlock: string;
  chapterBlock: string;
}): Promise<{
  mentions: MentionRow[];
  usage: NerUsage;
  calledHaiku: boolean;
}> {
  const {
    chunk,
    bookId,
    chapterNum,
    aliasIndex,
    entityResolver,
    model,
    catalogBlock,
    chapterBlock,
  } = opts;

  // Phase A — alias scan.
  const aliasHits = scanAliases(chunk.content, aliasIndex);

  // Phase B — Haiku only for chunks with dialogue (role info is the point) or
  // zero alias hits (we may have missed something non-canonical).
  const shouldCallHaiku =
    DIALOGUE_RE.test(chunk.content) || aliasHits.size === 0;

  const usage = zeroNerUsage();
  let haikuEntities: RawHaikuEntity[] = [];
  if (shouldCallHaiku) {
    const r = await extractWithHaiku({
      model,
      catalogBlock,
      chapterBlock,
      chunkText: chunk.content,
    });
    addNerUsage(usage, r.usage);
    haikuEntities = r.entities;
  }

  // Merge: Haiku-returned entities win on role. Phase A hits fill in any
  // canonical entity Haiku didn't name (role=null).
  const merged = new Map<number, Role | null>();

  for (const h of haikuEntities) {
    const id = await entityResolver.resolve(h.name, h.type);
    if (id == null) continue;
    const prev = merged.get(id);
    const prevRank = prev === undefined ? -1 : roleRank(prev);
    if (roleRank(h.role) > prevRank) {
      merged.set(id, h.role);
    } else if (prev === undefined) {
      merged.set(id, h.role);
    }
  }

  // Alias-scan-only fallback: if Haiku wasn't called (non-dialogue chunk with
  // alias hits) or Haiku missed a canonical entity the regex found, attach it
  // with role="mentioned". Using null here was wrong — null should be reserved
  // for genuine ambiguity. An alias scan hit in a chunk's text IS a mention by
  // definition, so label it as such.
  for (const [entityId] of aliasHits) {
    if (!merged.has(entityId)) {
      merged.set(entityId, "mentioned");
    }
  }

  const mentions: MentionRow[] = [];
  for (const [entityId, role] of merged) {
    mentions.push({
      entityId,
      chunkId: chunk.id,
      bookId,
      chapterNum,
      role,
    });
  }

  return { mentions, usage, calledHaiku: shouldCallHaiku };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export async function extractChapterMentions(opts: {
  chapter: ChapterMeta;
  chunks: ChunkInput[];
  aliasIndex: AliasIndex;
  entityResolver: EntityResolver;
  model: LanguageModel;
  catalogBlock: string;
  dryRun?: boolean;
  returnSamples?: boolean;
}): Promise<NerChapterResult> {
  const {
    chapter,
    chunks,
    aliasIndex,
    entityResolver,
    model,
    catalogBlock,
    dryRun,
    returnSamples,
  } = opts;

  if (chunks.length === 0) {
    return {
      chunksProcessed: 0,
      mentionsInserted: 0,
      usage: zeroNerUsage(),
    };
  }

  const chapterBlock = buildChapterBlock(chapter);

  const perChunkMentions: MentionRow[][] = new Array(chunks.length);
  const perChunkCalledHaiku: boolean[] = new Array(chunks.length).fill(false);
  const usage = zeroNerUsage();

  const runOne = async (i: number) => {
    const r = await extractChunkMentions({
      chunk: chunks[i],
      bookId: chapter.bookId,
      chapterNum: chapter.chapterNum,
      aliasIndex,
      entityResolver,
      model,
      catalogBlock,
      chapterBlock,
    });
    perChunkMentions[i] = r.mentions;
    perChunkCalledHaiku[i] = r.calledHaiku;
    addNerUsage(usage, r.usage);
  };

  // Warm the per-chapter cache serially before fanning out — the first Haiku
  // call in the chapter writes the chapterBlock cache; concurrent siblings
  // would otherwise all pay the write premium.
  await runOne(0);
  const tail = Array.from({ length: chunks.length - 1 }, (_, k) => k + 1);
  await runWithConcurrency(tail, INTRA_CHAPTER_CONCURRENCY, runOne);

  let mentionsInserted = 0;
  if (!dryRun) {
    const flat = perChunkMentions.flat();
    if (flat.length > 0) {
      // One multi-row INSERT per chapter: server-side atomic under neon-http,
      // which doesn't surface transactions. Crash between chapters leaves the
      // table consistent; crash mid-chapter inserts nothing for the chapter
      // and the next run re-processes it.
      await db.insert(schema.entityMentions).values(
        flat.map((m) => ({
          entityId: m.entityId,
          chunkId: m.chunkId,
          bookId: m.bookId,
          chapterNum: m.chapterNum,
          role: m.role,
        })),
      );
      mentionsInserted = flat.length;
    }
  }

  let samples: SampleRow[] | undefined;
  if (returnSamples) {
    const pending = entityResolver.pendingEntities();
    samples = chunks.map((c, i) => ({
      chunkId: c.id,
      chunkIndex: c.chunkIndex,
      contentPreview: c.content.replace(/\s+/g, " ").slice(0, 160),
      calledHaiku: perChunkCalledHaiku[i],
      mentions: perChunkMentions[i].map((m) => {
        const seeded = aliasIndex.byId.get(m.entityId)?.canonicalName;
        const pendingName = pending.get(m.entityId)?.canonicalName;
        const name =
          seeded ?? (pendingName ? `${pendingName} (new)` : `entity#${m.entityId}`);
        return { canonicalName: name, role: m.role };
      }),
    }));
  }

  return {
    chunksProcessed: chunks.length,
    mentionsInserted,
    usage,
    samples,
  };
}
