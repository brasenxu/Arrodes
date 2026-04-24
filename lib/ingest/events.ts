import { generateText, type LanguageModel } from "ai";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { EVENT_TYPES, type EventType } from "@/lib/rag/types";
import { EVENT_INSTRUCTION_HEADER } from "./event-prompt";

/**
 * Event extraction for the LOTM corpus.
 *
 * Three-stage gating per chunk:
 *   Stage 1 — entity-type filter (chunks with no character/organization mention skipped)
 *   Stage 2 — keyword regex (chunks with no event-trigger word skipped)
 *   Stage 3 — Haiku call returning typed event rows
 *
 * Mirrors lib/ingest/ner.ts in prompt-cache structure (catalog block + chapter
 * block + chunk query). EventResolver does NOT create novel entities — events
 * must reference entities NER already found.
 */

// Combined regex of all 8 event types' trigger keywords. False positives are
// fine — Stage 3 (Haiku) is the actual extractor; this just narrows what gets
// sent. Word-boundary anchored to keep short keywords from matching mid-word.
//
// Engineering note: 'engaged' is intentionally NOT included — corpus sampling
// (see design doc OQ2 resolution) found 1/8 fight-context vs 7/8 false
// positives ("engaged in conversation"). Re-evaluate if eval shows recall gaps.
const EVENT_KEYWORD_RE = new RegExp(
  [
    // sequence_advance
    "Sequence \\d",
    "potion",
    "advanced to",
    "ascended to",
    "promoted to",
    "became (?:a|an|the) Sequence",
    // digestion
    "digest(?:ed|ing|ion)?",
    "finished digesting",
    "fully digested",
    // meeting
    "Tarot Club",
    "gathered",
    "convened",
    "summit",
    "summoned (?:the|her|his) (?:members|club)",
    // organization_join
    "joined",
    "became a member",
    "inducted",
    "admitted (?:to|into)",
    "accepted into",
    // battle (original + augmented per design doc OQ2)
    "fought",
    "battle",
    "duel",
    "struck down",
    "attacked",
    "confronted",
    "slew",
    "defeated",
    "clashed",
    "stabbed",
    "slashed",
    "unleashed",
    "wounded",
    "ambushed",
    "assault",
    "explosion",
    // death
    "killed",
    "died",
    "deceased",
    "slain",
    "perished",
    "passed away",
    // identity_assume
    "posing as",
    "disguised as",
    "the alias",
    "took the (?:name|identity)",
    "assumed the identity",
    "called himself",
    "called herself",
    "new identity",
    "obtained a new identity",
    "his present name",
    "her present name",
    // identity_reveal
    "revealed",
    "true identity",
    '"I am [A-Z]',
    "unmasked",
  ].join("|"),
  "i",
);

export function passesKeywordGate(content: string): boolean {
  return EVENT_KEYWORD_RE.test(content);
}

export type EntityTypeSet = Set<string>;

export function passesEntityTypeGate(types: EntityTypeSet): boolean {
  return types.has("character") || types.has("organization");
}

// Per-chapter query: returns chunkId → set of distinct entity_types mentioned
// in that chunk. Materialize once at chapter start, reuse across all chunks.
export async function loadChapterEntityTypes(
  bookId: string,
  chapterNum: number,
): Promise<Map<number, EntityTypeSet>> {
  const rows = (await db.execute(sql`
    SELECT em.chunk_id, e.entity_type
    FROM entity_mentions em
    JOIN entities e ON e.id = em.entity_id
    WHERE em.book_id = ${bookId} AND em.chapter_num = ${chapterNum}
  `)) as unknown as { rows: { chunk_id: number; entity_type: string }[] };

  const map = new Map<number, EntityTypeSet>();
  for (const r of rows.rows) {
    let set = map.get(r.chunk_id);
    if (!set) {
      set = new Set();
      map.set(r.chunk_id, set);
    }
    set.add(r.entity_type);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Task 5: Haiku JSON parser with type validation
// ---------------------------------------------------------------------------

export type ParsedEvent = {
  entity_canonical_name: string;
  event_type: EventType;
  snippet: string;
  extra: Record<string, unknown>;
};

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

export function parseEventJson(text: string, chunkContent: string): ParsedEvent[] {
  let s = text.trim();
  // Strip Haiku's <thinking>...</thinking> scratchpad before locating the JSON
  // array. The thinking block routinely contains "[" / "]" notation which would
  // otherwise confuse the indexOf/lastIndexOf bracket walk below.
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(s.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: ParsedEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.entity_canonical_name === "string"
      ? obj.entity_canonical_name.trim()
      : "";
    const typeStr = typeof obj.event_type === "string" ? obj.event_type.trim() : "";
    const snippet = typeof obj.snippet === "string" ? obj.snippet.trim() : "";
    if (!name || !snippet) continue;
    if (!EVENT_TYPE_SET.has(typeStr)) continue;
    // Verbatim check: snippet must be a literal substring of the chunk text.
    // Tolerate (a) whitespace-collapse — Haiku occasionally normalizes runs of
    // whitespace in long snippets, and (b) curly→straight quote substitution —
    // the EPUB uses U+2018/U+2019/U+201C/U+201D but Haiku frequently echoes
    // back ASCII ' and " in its snippets.
    const normalize = (s: string) =>
      s
        .replace(/\s+/g, " ")
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"');
    if (!normalize(chunkContent).includes(normalize(snippet))) continue;
    const extra =
      obj.extra && typeof obj.extra === "object" && !Array.isArray(obj.extra)
        ? (obj.extra as Record<string, unknown>)
        : {};
    out.push({
      entity_canonical_name: name,
      event_type: typeStr as EventType,
      snippet,
      extra,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Task 6: EventResolver with type-purity check
// ---------------------------------------------------------------------------

export type ResolverEntity = {
  id: number;
  canonicalName: string;
  entityType: string;
  aliases: string[];
};

// Allowed entity_types per event_type. Subject-only (extra-field references
// are validated separately at insert time).
const TYPE_PURITY: Record<EventType, Set<string>> = {
  sequence_advance: new Set(["character"]),
  digestion: new Set(["character"]),
  meeting: new Set(["organization", "character"]),
  organization_join: new Set(["character"]),
  battle: new Set(["character"]),
  death: new Set(["character"]),
  identity_assume: new Set(["character"]),
  identity_reveal: new Set(["character"]),
};

export class EventResolver {
  private nameLookup: Map<string, { id: number; entityType: string }>;

  constructor(entities: ResolverEntity[]) {
    this.nameLookup = new Map();
    for (const e of entities) {
      const names = [e.canonicalName, ...e.aliases];
      for (const n of names) {
        const key = n.trim().toLowerCase();
        if (!key) continue;
        // Prefer existing entry — collisions follow first-loaded-wins. Caller
        // can pre-sort if priority matters; for events the purity check filters
        // incompatible types.
        if (!this.nameLookup.has(key)) {
          this.nameLookup.set(key, { id: e.id, entityType: e.entityType });
        }
      }
    }
  }

  resolve(name: string, eventType: EventType): { id: number; entityType: string } | null {
    const hit = this.nameLookup.get(name.trim().toLowerCase());
    if (!hit) return null;
    const allowed = TYPE_PURITY[eventType];
    if (!allowed.has(hit.entityType)) return null;
    return hit;
  }
}

// ---------------------------------------------------------------------------
// Task 7: Usage tracking + catalog block + Haiku call
// ---------------------------------------------------------------------------

export type EventNerUsage = {
  noCacheInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  haikuCalls: number;
};

export const zeroEventUsage = (): EventNerUsage => ({
  noCacheInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  haikuCalls: 0,
});

export function addEventUsage(target: EventNerUsage, delta: EventNerUsage): void {
  target.noCacheInputTokens += delta.noCacheInputTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.cacheWriteTokens += delta.cacheWriteTokens;
  target.outputTokens += delta.outputTokens;
  target.haikuCalls += delta.haikuCalls;
}

// Catalog includes entity_id so Haiku can reference IDs in extra.attendees,
// extra.opponent_id, etc. without a name→ID round-trip.
export function buildEventCatalogBlock(entities: ResolverEntity[]): string {
  const bullets = entities
    .slice()
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
    .map((e) => {
      const aliasPart =
        e.aliases.length > 0 ? ` — aliases: ${e.aliases.join(", ")}` : "";
      return `- [id=${e.id}] ${e.canonicalName} (${e.entityType})${aliasPart}`;
    })
    .join("\n");
  return `${EVENT_INSTRUCTION_HEADER}${bullets}`;
}

export function buildChapterBlock(chapter: {
  bookId: string;
  chapterNum: number;
  chapterTitle: string;
  rawText: string;
}): string {
  const header = `${chapter.bookId.toUpperCase()} Chapter ${chapter.chapterNum}: ${chapter.chapterTitle}`;
  return `<document title=${JSON.stringify(header)}>\n${chapter.rawText}\n</document>`;
}

// Tarot Club codenames in proper-noun position. Used to detect mid-session
// chunks where Haiku otherwise misses the meeting context. Match longest-first
// so "Mr. World" wins over a hypothetical "World" common-word match.
const TAROT_CODENAMES = [
  "Mr. Fool",
  "The Fool",
  "Miss Magician",
  "Mr. Magician",
  "The Magician",
  "Miss Justice",
  "The Justice",
  "Justice",
  "The Hanged Man",
  "Mr. Hanged Man",
  "Mr. World",
  "The World",
  "Miss Hermit",
  "The Hermit",
  "The Sun",
  "The Moon",
  "The Star",
  "Judgment",
  "Wheel of Fortune",
  "Death",
  "Temperance",
  "The Tower",
  "The Devil",
  "Strength",
  "The Lovers",
  "The Chariot",
  "The Hierophant",
  "The Empress",
  "The Emperor",
  "The High Priestess",
];

const GREY_FOG_RE = /above the [Gg]r[ae]y [Ff]og/;
const TAROT_CLUB_LITERAL_RE = /Tarot Club/;
// Tolerate both ASCII (') and curly (’) apostrophes — the EPUB uses curly
// almost exclusively, but normalized text may use ASCII.
const GATHERING_RE = /\b(today['’]s )?gathering\b/i;

export type SessionContext = {
  inSession: boolean;
  cues: string[];
};

// Pre-extraction regex pass that detects Tarot Club session-in-progress signals
// in a chunk. The result is injected into the chunk query so Haiku sees an
// explicit "[SESSION CONTEXT: ...]" hint and reliably fires the meeting event.
// This is the deterministic counterpart to the prompt's SUSTAINED-EVENT RULE.
export function detectTarotSessionContext(content: string): SessionContext {
  const cues: string[] = [];
  if (GREY_FOG_RE.test(content)) cues.push("above-the-Grey-Fog");
  if (TAROT_CLUB_LITERAL_RE.test(content)) cues.push("Tarot-Club-named");
  if (GATHERING_RE.test(content)) cues.push("gathering-mention");

  // Count distinct codenames appearing in proper-noun position. Longest-first
  // with a consumed-range mask prevents "Justice" matching inside "Miss Justice".
  const consumed: Array<[number, number]> = [];
  let codenameHits = 0;
  for (const cn of TAROT_CODENAMES) {
    const re = new RegExp(
      `(?<!\\w)${cn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
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
        codenameHits++;
      }
    }
  }
  if (codenameHits >= 2) cues.push(`${codenameHits}-codenames-in-use`);
  else if (codenameHits === 1) cues.push("1-codename-in-use");

  // Fire on EITHER the Grey-Fog setting cue OR ≥2 distinct codenames OR explicit
  // "Tarot Club" reference. Single-codename chunks alone don't trigger because a
  // single "The Fool" reference is often Klein narration outside session.
  const inSession =
    cues.includes("above-the-Grey-Fog") ||
    cues.includes("Tarot-Club-named") ||
    codenameHits >= 2;

  return { inSession, cues };
}

function buildChunkQuery(chunkText: string, session?: SessionContext): string {
  const prefix =
    session?.inSession
      ? `[SESSION CONTEXT: A regex pre-pass detected this chunk is mid-Tarot-Club-session (signals: ${session.cues.join(", ")}). Per the meeting event rule, this chunk SHOULD generate a meeting row with subject="Tarot Club" alongside any other events you find.]\n\n`
      : "";
  return `${prefix}Now extract events from this chunk of the document above:\n<chunk>\n${chunkText}\n</chunk>\n\nFollow the REASONING FIRST format, then emit the JSON array.`;
}

export async function callHaikuForEvents(opts: {
  model: LanguageModel;
  catalogBlock: string;
  chapterBlock: string;
  chunkText: string;
  sessionContext?: SessionContext;
}): Promise<{ rawText: string; usage: EventNerUsage }> {
  const { model, catalogBlock, chapterBlock, chunkText, sessionContext } = opts;
  const result = await generateText({
    model,
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
          { type: "text", text: buildChunkQuery(chunkText, sessionContext) },
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
    rawText: result.text,
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
// Task 8: Chunk-level orchestrator (gating + Haiku + parse + resolve)
// ---------------------------------------------------------------------------

export type ChunkInput = {
  id: number;
  chunkIndex: number;
  content: string;
};

export type EventRow = {
  entityId: number;
  eventType: EventType;
  chapterId: number;
  bookId: string;
  chapterNum: number;
  evidenceChunkId: number;
  snippet: string;
  extra: Record<string, unknown>;
};

export async function extractChunkEvents(opts: {
  chunk: ChunkInput;
  bookId: string;
  chapterId: number;
  chapterNum: number;
  entityTypeSet: EntityTypeSet;
  resolver: EventResolver;
  model: LanguageModel;
  catalogBlock: string;
  chapterBlock: string;
}): Promise<{
  rows: EventRow[];
  usage: EventNerUsage;
  calledHaiku: boolean;
}> {
  const usage = zeroEventUsage();

  // Stage 1 — entity-type gate
  if (!passesEntityTypeGate(opts.entityTypeSet)) {
    return { rows: [], usage, calledHaiku: false };
  }
  // Detect session context up-front so it can both bypass the keyword gate
  // (mid-session dialogue chunks often have zero event-trigger words) and be
  // injected into the chunk query for Haiku.
  const sessionContext = detectTarotSessionContext(opts.chunk.content);
  // Stage 2 — keyword gate, with session-context override
  if (!passesKeywordGate(opts.chunk.content) && !sessionContext.inSession) {
    return { rows: [], usage, calledHaiku: false };
  }
  // Stage 3 — Haiku
  const r = await callHaikuForEvents({
    model: opts.model,
    catalogBlock: opts.catalogBlock,
    chapterBlock: opts.chapterBlock,
    chunkText: opts.chunk.content,
    sessionContext,
  });
  addEventUsage(usage, r.usage);

  const parsed = parseEventJson(r.rawText, opts.chunk.content);
  const rows: EventRow[] = [];
  for (const e of parsed) {
    const resolved = opts.resolver.resolve(e.entity_canonical_name, e.event_type);
    if (!resolved) continue;
    rows.push({
      entityId: resolved.id,
      eventType: e.event_type,
      chapterId: opts.chapterId,
      bookId: opts.bookId,
      chapterNum: opts.chapterNum,
      evidenceChunkId: opts.chunk.id,
      snippet: e.snippet,
      extra: e.extra,
    });
  }
  return { rows, usage, calledHaiku: true };
}

// ---------------------------------------------------------------------------
// Task 9: Chapter orchestrator with cache warm-up + batch INSERT
// ---------------------------------------------------------------------------

const INTRA_CHAPTER_CONCURRENCY = 3;

export type ChapterMeta = {
  id: number;
  bookId: string;
  chapterNum: number;
  chapterTitle: string;
  rawText: string;
};

export type EventChapterResult = {
  chunksProcessed: number;
  chunksGated: number;
  rowsInserted: number;
  usage: EventNerUsage;
};

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

export async function extractChapterEvents(opts: {
  chapter: ChapterMeta;
  chunks: ChunkInput[];
  entityTypeMap: Map<number, EntityTypeSet>;
  resolver: EventResolver;
  model: LanguageModel;
  catalogBlock: string;
  dryRun?: boolean;
}): Promise<EventChapterResult> {
  const result: EventChapterResult = {
    chunksProcessed: opts.chunks.length,
    chunksGated: 0,
    rowsInserted: 0,
    usage: zeroEventUsage(),
  };
  if (opts.chunks.length === 0) return result;

  const chapterBlock = buildChapterBlock(opts.chapter);
  const perChunkRows: EventRow[][] = new Array(opts.chunks.length);

  const runOne = async (i: number) => {
    const chunk = opts.chunks[i];
    const entityTypeSet = opts.entityTypeMap.get(chunk.id) ?? new Set<string>();
    const r = await extractChunkEvents({
      chunk,
      bookId: opts.chapter.bookId,
      chapterId: opts.chapter.id,
      chapterNum: opts.chapter.chapterNum,
      entityTypeSet,
      resolver: opts.resolver,
      model: opts.model,
      catalogBlock: opts.catalogBlock,
      chapterBlock,
    });
    perChunkRows[i] = r.rows;
    if (!r.calledHaiku) result.chunksGated++;
    addEventUsage(result.usage, r.usage);
  };

  // Warm the cache with one serial call before fanning out — first call writes
  // chapterBlock cache; concurrent siblings would otherwise race on the write.
  await runOne(0);
  const tail = Array.from({ length: opts.chunks.length - 1 }, (_, k) => k + 1);
  await runWithConcurrency(tail, INTRA_CHAPTER_CONCURRENCY, runOne);

  if (!opts.dryRun) {
    const flat = perChunkRows.flat();
    if (flat.length > 0) {
      await db.insert(schema.events).values(
        flat.map((r) => ({
          entityId: r.entityId,
          eventType: r.eventType,
          chapterId: r.chapterId,
          bookId: r.bookId,
          chapterNum: r.chapterNum,
          evidenceChunkId: r.evidenceChunkId,
          snippet: r.snippet,
          extra: r.extra,
        })),
      );
      result.rowsInserted = flat.length;
    }
  } else {
    result.rowsInserted = perChunkRows.flat().length;
  }
  return result;
}
