/**
 * Shared reference primer prepended to every contextualization call.
 *
 * DESIGN CONSTRAINTS — any edit to this file must preserve them:
 *
 *   1. NO SPECIFIC CHARACTERS. Not Klein, not Audrey, not any alias. Character
 *      identities and aliases are in-story reveals and leaking them into every
 *      prefix destroys reading-position semantics.
 *
 *   2. NO SPECIFIC PATHWAY NAMES. Not Fool, not Sun, not any of the 22. The
 *      pathway system as a MECHANIC is stable from Chapter 1 and safe to
 *      describe; WHICH pathway a character is on is plot information.
 *
 *   3. NO SPECIFIC FACTION OR CHURCH NAMES. Factions as a TYPE of organization
 *      is fine; naming any specific church/order/society is not.
 *
 *   4. NO SPECIFIC SEQUENCE ASSIGNMENTS. Explaining that Sequences exist 0–9
 *      is fine; saying "the Hanged Man Sequence 3 is Trinity Templar" is not.
 *
 *   5. NO SPECIFIC PLACES, CURRENCIES, OR CALENDAR DETAILS beyond the most
 *      generic framing. These are low-risk but also low-value; omitting them
 *      removes a factual-error surface entirely.
 *
 *   6. NO COSMOLOGICAL OR METANARRATIVE FRAMING. The primer must not summarize
 *      how the setting relates to Earth, real history, or far-future reveals —
 *      only in-world surface texture (tech level, institutions, occult as
 *      presented in early chapters).
 *
 * The primer's purpose is cache padding (getting every chapter over Haiku 4.5's
 * 4096-token minimum cacheable prefix) + terminology grounding — nothing more.
 * The instruction block at the end is load-bearing: it tells Haiku to ignore
 * the primer unless the chapter itself brings it up, and to never anticipate
 * later-chapter information.
 *
 * Byte-stability: do NOT add timestamps, IDs, or derived strings. Prefix
 * caching is a prefix match — any byte change invalidates the cache across the
 * full corpus on the next re-ingest.
 */

export const SERIES_PRIMER = `REFERENCE PRIMER (terminology only — do not project onto the chapter)

The chapter text below is from "Lord of the Mysteries" (LOTM) or its sequel "Circle of Inevitability" (COI), a pair of supernatural novels whose societies combine industrial-era technology with occult practice in a broadly steampunk-Victorian narrative register. Nation-states, institutions, and the supernatural coexist on the scale the chapter describes. The following primer is for understanding terminology only — every specific character identity, pathway name, faction name, and plot event must come from the chapter text itself, not from this primer.

THE BEYONDER SYSTEM (stable terminology across the series)

A "Beyonder" is a person who has ingested a potion that grants supernatural abilities. Potions are rare, expensive, and formulas are tightly held.

A "Pathway" is one of twenty-two distinct Beyonder power systems. Each pathway is organized around a thematic identity. Specific pathway names are introduced within the narrative as the reader encounters them; this primer does not list them.

A "Sequence" is an ordinal level within a pathway. Sequences are numbered from 9 (novice) down to 0 (apex). Lower numbers indicate higher power. A Beyonder primarily advances their Sequence by consuming a more advanced potion from the same pathway, though the series describes additional advancement mechanisms that are introduced in-chapter when relevant. Sequence 0 is the topmost level of a pathway; the specific terminology the series uses for Sequence 0 beings, and for the objects or conditions required to reach that level, is introduced within the narrative.

"Potion formula" refers to the specific ingredient recipe for a given Sequence's potion. Formulas are scarce, sometimes lost, and actively researched.

"Digestion" is the psychological and emotional integration process a Beyonder must undergo after consuming a potion. Failure to digest leads to conditions the series refers to as "loss of control," "madness," or becoming a "monster."

The "acting method" is the technique of outwardly embodying the symbolic identity of one's Sequence — living the role, adopting its mannerisms — to assist digestion. Characters using the acting method may exhibit behaviors or habits that appear theatrical or ritualistic.

"Seance," "divination," and "fortune-telling" refer to occult techniques available through certain pathways and artifacts. Specific mechanics are introduced in-chapter.

"Beyonder characteristics" refers to the supernatural residue or essence Beyonders leave in their environment and items they use; harvesting and trading these characteristics is part of the economy of the Beyonder world.

FACTION TYPES (categories only — specific names come from the chapter text)

The world contains several categories of organized power: orthodox religious institutions aligned with the world's major divine figures; state intelligence and military services that manage their own Beyonder forces; private occult societies, academic bodies, and investigative groups; and heretical organizations that challenge orthodoxy. Specific church, order, society, and deity names are introduced and explained within individual chapters. Do not assign any character to a specific faction unless the chapter text does so.

SETTING

The series takes place across three named continents. Multiple nation-states exist, each with its own government, currency system, calendar, and institutions. The calendar uses an era-numbered year system. Specific nation names, city names, currency names, calendar month names, and dates are introduced in-chapter. Industrial technology — steam power, railways, firearms, telegraph — coexists with occult practice in everyday life.

STRICT RULES FOR WRITING CHUNK CONTEXT (IMPORTANT)

When you write the situating context for the chunk presented below, follow these rules without exception:

1. USE ONLY INFORMATION EXPLICITLY PRESENT IN THE CHAPTER TEXT. Do not project any detail from this primer onto the chapter unless the chapter itself references that detail. This primer is a glossary, not a fact sheet about the chapter.

2. DO NOT NAME CHARACTERS, PATHWAYS, SEQUENCES, FACTIONS, OR PLACES THAT THE CHAPTER TEXT DOES NOT NAME. If a character's identity or alias is not revealed in this chapter, do not reveal it. If a pathway is not named, do not name one. If a Sequence number is not stated, do not assign one. If a faction affiliation is not stated, do not infer one.

3. DO NOT SPECULATE OR FORESHADOW. Do not hint at future plot developments, future character reveals, or connections to events that have not yet occurred in the narrative at this point.

4. AVOID ANACHRONISM. The context you write must reflect only information that a reader at this specific narrative moment would have. A chunk from an early chapter must not reference terminology or relationships that are revealed later in the same book.

5. CROSS-BOOK BACKSTORY IS PERMITTED WHEN THE CHAPTER INVOKES IT. COI is a sequel to LOTM, and some COI chapters reference LOTM events, characters, or entities as established prior context. Treat those references the same as any other chapter-internal content: include them in the prefix only to the extent the chapter's own text invokes them, using the same names and framing the chapter uses. Do not independently introduce LOTM content that the COI chapter does not mention, and do not explain an LOTM reference beyond what the COI chapter states.

6. IF UNCERTAIN, STAY CLOSE TO THE CHAPTER'S OWN LANGUAGE. Prefer paraphrasing what the chapter says over introducing summary-style interpretation.

7. THE PRIMER ABOVE IS A TERMINOLOGY REFERENCE ONLY. Treat the chapter text as the sole source of truth for all narrative claims.

These rules exist because the retrieval system uses your context for spoiler-sensitive reading-position filtering. An anachronistic or speculative prefix breaks the user experience.

FORMAT AND STYLE GUIDANCE

Your context prefix should be one to three sentences, approximately 50–100 tokens. It is a situating summary, not a paraphrase of the chunk content itself. The goal is to give a future reader (and a semantic search system) enough context to understand what the chunk is about when encountered in isolation.

A good context answers questions like: What is happening in this part of the chapter? Who is involved (using only names the chapter uses)? Where does this fall within the chapter's overall progression — opening scene, a specific subplot transition, a confrontation, a resolution? What information is necessary to make sense of the chunk's dialogue or action? What named location, object, or technique (as named in this chapter) is central?

A good context avoids: summarizing what the chunk already says, inventing information not in the chapter, projecting from the primer above, using names or identities the chapter has not introduced, describing emotional states or thematic significance not explicit in the text, making connections to scenes in other chapters, or revealing later-chapter developments.

CONTEXT PATTERN EXAMPLES (using placeholder tokens, not real content)

Good pattern: "This chunk depicts [character as named in chapter] examining [object or location named in chapter] after [immediately prior chapter event]. It covers [brief summary of what's in the chunk] and leads into [next chapter event if in the chunk]."

Good pattern: "Following [prior scene in this chapter], [character] arrives at [location as named] to [stated purpose]. The chunk describes [the action or dialogue sequence]."

Good pattern: "This is the [opening/middle/closing] portion of the chapter, in which [what happens]. The chunk focuses on [specific aspect]."

Anti-pattern to avoid: "[Character], who is actually [later-revealed identity], examines [object]." This reveals information not in the chapter.

Anti-pattern to avoid: "This chunk shows [character] using their [specific pathway] abilities, which are at Sequence [number]." This assigns pathway/Sequence information not stated in the chapter.

Anti-pattern to avoid: "This foreshadows [later-chapter event]." This introduces information from later chapters.

Anti-pattern to avoid: "[Character] is a member of [faction], which in this series represents [thematic meaning]." This projects primer-level generalization when the chapter doesn't state the faction affiliation or theme.

WRITING STYLE NOTES

Use the third person and present tense. Reference characters by the name the chapter itself uses in the chunk (or the name the chapter uses for them most recently). Do not use honorifics or aliases not present in the chapter. If the chapter uses multiple names for the same character (e.g., a given name and a last name), prefer whichever the narration is currently using. If a character is unnamed in the chunk but referred to by role (the man, the officer, the shopkeeper), use the role, not a name from a later reveal. Do not speculate about characters' thoughts or motivations beyond what the chunk or surrounding chapter directly states.

Do not use phrases like "later in the series," "in future chapters," "eventually," or "will become." Everything the context prefix asserts must be true AT THE MOMENT of this chunk, as presented in this chapter.

Treat each chapter as a self-contained unit of information for the purposes of writing its chunk contexts. The only external information you may incorporate is the primer's terminology glossary — and only to the extent that the chapter's own text already invokes that terminology.

FINAL RESTATEMENT OF THE CORE RULE

Before writing the context prefix: ignore this primer UNLESS the chapter text itself calls for a term it defines. Do not insert Beyonder terminology, pathway terminology, Sequence terminology, faction terminology, or series-level concepts into the prefix unless the chapter's own words use them. A context prefix that describes a chunk of pure mundane dialogue — no supernatural elements invoked in the chapter — should contain no Beyonder-system vocabulary at all. A context prefix for a chunk that describes a specific named artifact, ritual, or pathway should use only the names and concepts the chapter provides.`;
