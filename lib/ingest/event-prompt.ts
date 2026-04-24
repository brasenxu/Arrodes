/**
 * Event-extraction prompt header.
 *
 * Stable across the run — Anthropic prompt cache hashes the byte string, so
 * unrelated TypeScript refactors in events.ts must not touch this file.
 *
 * Reads as catalog block input (followed by the entity catalog appended in
 * events.ts via buildCatalogBlock). The chunk-query (sent uncached per chunk)
 * may inject a [SESSION CONTEXT: ...] prefix when deterministic regex pre-pass
 * detected the chunk is mid-session — see events.ts:detectTarotSessionContext.
 */

export const EVENT_INSTRUCTION_HEADER = `TASK: Extract structured EVENTS from a chunk of "Lord of the Mysteries" (LOTM) or "Circle of Inevitability" (COI) novel prose.

Output is a JSON array of {entity_canonical_name, event_type, snippet, extra}. The 8 closed event_type values:

1. sequence_advance — character takes a Beyonder potion / is recognized at a new Sequence. extra: {sequence, pathway, from_sequence?}. FIRE on the act of consuming. SKIP planning, walking-to-the-cellar, "if I become X" musings, past references like "newly advanced".

2. digestion — character finishes digesting a potion. extra: {sequence, pathway, potion?}. FIRE only on COMPLETION ("fully digested", "potion had been digested completely", "his Clown potion had been digested completely"). SKIP progress phrases ("the potion accelerating its digestion", "digested it a little more"), abstract potion-making discussion, and chunks where no specific named character's specific potion is completing.

3. meeting — a NAMED ORGANIZATION is in active session. Subject = the org (Tarot Club, Nighthawks, MI9, Church chapter, Aurora Order, etc.). extra: {attendees: [<entity_id>...]}. FIRE on EVERY chunk where the org session is the active scene — including mid-session dialogue chunks. Cues: "above the Grey Fog", Tarot codenames in use (The Fool / Justice / Hanged Man / etc.), MI9 ops briefing in progress, formal Church session. Mid-session 2-person dialogue still counts. SKIP village rituals, public ceremonies, family gatherings, and anything without a named org acting as a body.

4. organization_join — a character is admitted into a named org. Subject = the joining character. extra: {organization_id, codename?}. A session that admits a new member produces BOTH a meeting row (subject=org) AND an organization_join row (subject=character).

5. battle — narratively significant fight with a named opponent or named participants. Subject = each named active participant on the focal side. extra: {opponent_id?, location?, outcome?}. FIRE for EVERY named active combatant separately (a 3-vs-1 fight with named Colin/Lovia/Derrick produces 3 battle rows). Brief decisive fights count (Klein twisting Lanevus's neck = battle). Defenders count (Audrey waking up under attack = battle). Multi-chunk battles → battle row per active chunk. SKIP pub brawls and unnamed-foe combat.

6. death — a named character dies. Subject = the deceased. extra: {killed_by_id?, location?}. FIRE for EVERY named character whose death is reported in the chunk, even off-screen ("Maveti, Hendry, and Squall have also died" → 3 rows). Anonymous deaths produce no rows.

7. identity_assume — character FIRST adopts a working identity used across multiple chapters. Subject = the adopting character. extra: {identity, context?}. CATALOG-ALIAS HEURISTIC: if the new identity name appears as an alias of the character in the CANONICAL ENTITIES catalog below, multi-chapter usage is confirmed → FIRE. Specifically: any chunk depicting Klein creating/first-using "Sherlock Moriarty", "Gehrman Sparrow", "Dwayne Dantès", or "Benson Moretti" → identity_assume row with subject="Klein Moretti" (the catalog confirms these are his working identities). SKIP one-scene disguises and SKIP subsequent uses of an already-adopted identity ("Klein controlled The World Gehrman Sparrow to say..." after the Gehrman debut is NOT identity_assume).

8. identity_reveal — someone is unmasked. Subject = THE PERSON WHOSE IDENTITY IS EXPOSED, NOT the revealer. extra: {revealed_to_id?, identity}. Cattleya saying "You really are Hero Bandit Black Emperor" to Klein → subject = Klein Moretti (the revealed), NOT Cattleya (the revealer). SKIP metaphysical philosophy ("Adam isn't necessarily Adam") — that's not an in-narrative reveal.

REASONING FIRST (REQUIRED):
Before emitting the JSON array, write a brief <thinking> block in this format:
<thinking>
- Candidates: <list each event candidate observed>
- For each: subject = <who> (revealed/joining/dying/adopting — match the role per the type definition above)
- Past/future references to drop: <list>
- Sustained-event signals (Tarot codenames, "Grey Fog", in-session cues): <list>
</thinking>

Then on a new line emit ONLY the JSON array. The parser strips everything before the first '[' and after the last ']'.

OUTPUT SHAPE:
  [{"entity_canonical_name": "<canonical from catalog>", "event_type": "<one of 8>", "snippet": "<verbatim 50-200 char excerpt>", "extra": {...}}]

OUTPUT RULES:
- Bare JSON array (after the <thinking> block). No markdown fences around the JSON.
- Empty chunk → return [].
- snippet must be a literal substring of the chunk text (whitespace-collapsed match).
- Every entity_canonical_name MUST appear under canonical_name or alias in the CANONICAL ENTITIES catalog below — drop events whose subject can't be resolved.
- Past/future references are NOT events. The act must occur in this chunk. Exception: reported off-screen deaths of named characters DO count.
- When uncertain whether a chunk depicts an event vs only references one in the past, prefer empty for that candidate. But for sustained-event signals (codenames + Grey Fog setting), prefer to fire the meeting event.

CANONICAL ENTITIES (resolve chunk mentions to these canonical_name values; entity_id values are listed for use in extra fields):
`;
