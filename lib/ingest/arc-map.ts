import type { ContentKind } from "@/lib/db/schema";

export type BookId = "lotm1" | "coi";

export type ArcAssignment = {
  volume: number;
  volumeName: string;
  arc: number;
  arcName: string;
  contentKind: ContentKind;
};

type Range = {
  start: number;
  end: number;
  volume: number;
  volumeName: string;
  arc: number;
  arcName: string;
  contentKind: ContentKind;
};

// Authoritative source: .claude/plans/2026-04-23_Arc-Derivation.md (Implementation table).
// Arc names matching a wiki `{{Main|X}}` event page are used verbatim so
// `SELECT ... WHERE arc_name = X` and `wiki_get_page(title=X)` agree.
// Side/bonus rows keep `arc_name = volume_name` (single-arc per side volume);
// arc indices within volume=0 are sequential across side/bonus entries, not
// 0 — the `arc = 0` default on the DB column only applies to unbackfilled rows.
const LOTM1_RANGES: Range[] = [
  // Volume 1: Clown — 5 arcs
  { start: 1, end: 57, volume: 1, volumeName: "Clown", arc: 1, arcName: "Transmigration & Nighthawks", contentKind: "main" },
  { start: 58, end: 106, volume: 1, volumeName: "Clown", arc: 2, arcName: "Antigonus Family's Notebook", contentKind: "main" },
  { start: 107, end: 171, volume: 1, volumeName: "Clown", arc: 3, arcName: "Mysticism Studies", contentKind: "main" },
  { start: 172, end: 202, volume: 1, volumeName: "Clown", arc: 4, arcName: "Qilangos Incident", contentKind: "main" },
  { start: 203, end: 213, volume: 1, volumeName: "Clown", arc: 5, arcName: "Tingen City Doomsday", contentKind: "main" },
  // Volume 2: Faceless — 5 arcs
  { start: 214, end: 253, volume: 2, volumeName: "Faceless", arc: 1, arcName: "Backlund Detective Debut", contentKind: "main" },
  { start: 254, end: 294, volume: 2, volumeName: "Faceless", arc: 2, arcName: "Death of Lanevus", contentKind: "main" },
  { start: 295, end: 322, volume: 2, volumeName: "Faceless", arc: 3, arcName: "Black Emperor Heist", contentKind: "main" },
  { start: 323, end: 430, volume: 2, volumeName: "Faceless", arc: 4, arcName: "The Hero Black Bandit", contentKind: "main" },
  { start: 431, end: 482, volume: 2, volumeName: "Faceless", arc: 5, arcName: "Great Smog of Backlund", contentKind: "main" },
  // Volume 3: Traveler — 5 arcs
  { start: 483, end: 551, volume: 3, volumeName: "Traveler", arc: 1, arcName: "Sea God Kalvetua", contentKind: "main" },
  { start: 552, end: 604, volume: 3, volumeName: "Traveler", arc: 2, arcName: "Vice-Admiral Tracy Pursuit", contentKind: "main" },
  { start: 605, end: 633, volume: 3, volumeName: "Traveler", arc: 3, arcName: "Mother Tree's Trap", contentKind: "main" },
  { start: 634, end: 705, volume: 3, volumeName: "Traveler", arc: 4, arcName: "Sea of Ruins Voyage", contentKind: "main" },
  { start: 706, end: 732, volume: 3, volumeName: "Traveler", arc: 5, arcName: "Chaos on Bayam Mountain", contentKind: "main" },
  // Volume 4: Undying — 5 arcs
  { start: 733, end: 776, volume: 4, volumeName: "Undying", arc: 1, arcName: "Dwayne Dantès Identity", contentKind: "main" },
  { start: 777, end: 829, volume: 4, volumeName: "Undying", arc: 2, arcName: "Primitive Island Expedition", contentKind: "main" },
  { start: 830, end: 848, volume: 4, volumeName: "Undying", arc: 3, arcName: "Foggy Town", contentKind: "main" },
  { start: 849, end: 905, volume: 4, volumeName: "Undying", arc: 4, arcName: "Southern Continent Arms Deal", contentKind: "main" },
  { start: 906, end: 946, volume: 4, volumeName: "Undying", arc: 5, arcName: "Death of Ince Zangwill", contentKind: "main" },
  // Volume 5: Red Priest — 5 arcs
  { start: 947, end: 986, volume: 5, volumeName: "Red Priest", arc: 1, arcName: "Post-Demigod Reconnaissance", contentKind: "main" },
  { start: 987, end: 1061, volume: 5, volumeName: "Red Priest", arc: 2, arcName: "Hunting the Conspirators", contentKind: "main" },
  { start: 1062, end: 1099, volume: 5, volumeName: "Red Priest", arc: 3, arcName: "Feysac War Outbreak", contentKind: "main" },
  { start: 1100, end: 1142, volume: 5, volumeName: "Red Priest", arc: 4, arcName: "Scholar of Yore Advancement", contentKind: "main" },
  { start: 1143, end: 1150, volume: 5, volumeName: "Red Priest", arc: 5, arcName: "George III's Apotheosis Ritual", contentKind: "main" },
  // Volume 6: Lightseeker — 3 arcs
  { start: 1151, end: 1180, volume: 6, volumeName: "Lightseeker", arc: 1, arcName: "Amon's Pursuit", contentKind: "main" },
  { start: 1181, end: 1217, volume: 6, volumeName: "Lightseeker", arc: 2, arcName: "Hunting Botis", contentKind: "main" },
  { start: 1218, end: 1266, volume: 6, volumeName: "Lightseeker", arc: 3, arcName: "Giant King's Court", contentKind: "main" },
  // Volume 7: The Hanged Man — 3 arcs
  { start: 1267, end: 1298, volume: 7, volumeName: "The Hanged Man", arc: 1, arcName: "Miracle Invoker Advancement", contentKind: "main" },
  { start: 1299, end: 1320, volume: 7, volumeName: "The Hanged Man", arc: 2, arcName: "Belltaine City", contentKind: "main" },
  { start: 1321, end: 1353, volume: 7, volumeName: "The Hanged Man", arc: 3, arcName: "Utopia and the Corpse Cathedral", contentKind: "main" },
  // Volume 8: Fool — 3 arcs
  { start: 1354, end: 1373, volume: 8, volumeName: "Fool", arc: 1, arcName: "Destroying Eden", contentKind: "main" },
  { start: 1374, end: 1387, volume: 8, volumeName: "Fool", arc: 2, arcName: "Klein's Apotheosis Ritual", contentKind: "main" },
  { start: 1388, end: 1394, volume: 8, volumeName: "Fool", arc: 3, arcName: "Klein's Eternal Sleep", contentKind: "main" },
  // Side stories (volume=0, arc indices sequential across side volumes)
  { start: 1395, end: 1402, volume: 0, volumeName: "An Ordinary Person's Daily Life", arc: 1, arcName: "An Ordinary Person's Daily Life", contentKind: "side_story" },
  { start: 1403, end: 1430, volume: 0, volumeName: "In Modern Day", arc: 2, arcName: "In Modern Day", contentKind: "side_story" },
  { start: 1431, end: 1432, volume: 0, volumeName: "That Corner", arc: 3, arcName: "That Corner", contentKind: "side_story" },
];

const COI_RANGES: Range[] = [
  // Volume 1: Nightmare — 4 arcs
  { start: 1, end: 25, volume: 1, volumeName: "Nightmare", arc: 1, arcName: "The Warlock Legend", contentKind: "main" },
  { start: 26, end: 60, volume: 1, volumeName: "Nightmare", arc: 2, arcName: "The Lent Massacre", contentKind: "main" },
  { start: 61, end: 90, volume: 1, volumeName: "Nightmare", arc: 3, arcName: "Provoker Advancement", contentKind: "main" },
  { start: 91, end: 109, volume: 1, volumeName: "Nightmare", arc: 4, arcName: "Aurore's Sacrifice", contentKind: "main" },
  // Volume 2: Lightseeker — 4 arcs
  { start: 110, end: 147, volume: 2, volumeName: "Lightseeker", arc: 1, arcName: "Trier Integration", contentKind: "main" },
  { start: 148, end: 191, volume: 2, volumeName: "Lightseeker", arc: 2, arcName: "The Double Agent's Burden", contentKind: "main" },
  { start: 192, end: 244, volume: 2, volumeName: "Lightseeker", arc: 3, arcName: "Pyromaniac's Ascent", contentKind: "main" },
  { start: 245, end: 263, volume: 2, volumeName: "Lightseeker", arc: 4, arcName: "Tree of Shadow", contentKind: "main" },
  // Volume 3: Conspirer — 4 arcs
  { start: 264, end: 322, volume: 3, volumeName: "Conspirer", arc: 1, arcName: "The Deeper Network", contentKind: "main" },
  { start: 323, end: 384, volume: 3, volumeName: "Conspirer", arc: 2, arcName: "Samaritan Women's Spring", contentKind: "main" },
  { start: 385, end: 435, volume: 3, volumeName: "Conspirer", arc: 3, arcName: "Outer God Incursions", contentKind: "main" },
  { start: 436, end: 494, volume: 3, volumeName: "Conspirer", arc: 4, arcName: "The Hostel", contentKind: "main" },
  // Volume 4: Sinner — 5 arcs
  { start: 495, end: 532, volume: 4, volumeName: "Sinner", arc: 1, arcName: "The Westward Hunt", contentKind: "main" },
  { start: 533, end: 597, volume: 4, volumeName: "Sinner", arc: 2, arcName: "Sea Prayer Ritual", contentKind: "main" },
  { start: 598, end: 649, volume: 4, volumeName: "Sinner", arc: 3, arcName: "The Demon's Descent", contentKind: "main" },
  { start: 650, end: 698, volume: 4, volumeName: "Sinner", arc: 4, arcName: "Dream Festival", contentKind: "main" },
  { start: 699, end: 735, volume: 4, volumeName: "Sinner", arc: 5, arcName: "The Overseer's Judgment", contentKind: "main" },
  // Volume 5: Demoness — 4 arcs
  { start: 736, end: 776, volume: 5, volumeName: "Demoness", arc: 1, arcName: "Journey to the Underworld", contentKind: "main" },
  { start: 777, end: 792, volume: 5, volumeName: "Demoness", arc: 2, arcName: "Lumian's Exile", contentKind: "main" },
  { start: 793, end: 841, volume: 5, volumeName: "Demoness", arc: 3, arcName: "Battle at Morora", contentKind: "main" },
  { start: 842, end: 884, volume: 5, volumeName: "Demoness", arc: 4, arcName: "Mirror World Infiltration", contentKind: "main" },
  // Volume 6: Dream Weaver — 3 arcs
  { start: 885, end: 901, volume: 6, volumeName: "Dream Weaver", arc: 1, arcName: "Pre-Dream Preparations", contentKind: "main" },
  { start: 902, end: 1032, volume: 6, volumeName: "Dream Weaver", arc: 2, arcName: "The Fool's Dream", contentKind: "main" },
  { start: 1033, end: 1034, volume: 6, volumeName: "Dream Weaver", arc: 3, arcName: "The Fool Awakens", contentKind: "main" },
  // Volume 7: Second Law — 4 arcs
  { start: 1035, end: 1062, volume: 7, volumeName: "Second Law", arc: 1, arcName: "Sick Church Hunts", contentKind: "main" },
  { start: 1063, end: 1083, volume: 7, volumeName: "Second Law", arc: 2, arcName: "Hunting Hidden Sage", contentKind: "main" },
  { start: 1084, end: 1101, volume: 7, volumeName: "Second Law", arc: 3, arcName: "Weather Warlock Advancement", contentKind: "main" },
  { start: 1102, end: 1115, volume: 7, volumeName: "Second Law", arc: 4, arcName: "The Day of Many Disasters", contentKind: "main" },
  // Volume 8: Eternal Aeon — 4 arcs
  { start: 1116, end: 1141, volume: 8, volumeName: "Eternal Aeon", arc: 1, arcName: "Death of Primordial Demoness", contentKind: "main" },
  { start: 1142, end: 1148, volume: 8, volumeName: "Eternal Aeon", arc: 2, arcName: "Pre-Apocalypse Consolidation", contentKind: "main" },
  { start: 1149, end: 1177, volume: 8, volumeName: "Eternal Aeon", arc: 3, arcName: "The Apocalypse", contentKind: "main" },
  { start: 1178, end: 1179, volume: 8, volumeName: "Eternal Aeon", arc: 4, arcName: "Final Tarot Club", contentKind: "main" },
  // Bonus + side (volume=0, arc indices sequential)
  { start: 1180, end: 1180, volume: 0, volumeName: "Author's Afterword", arc: 1, arcName: "Author's Afterword", contentKind: "bonus" },
  { start: 1181, end: 1181, volume: 0, volumeName: "Daily Life in Cordu", arc: 2, arcName: "Daily Life in Cordu", contentKind: "side_story" },
];

const RANGES_BY_BOOK: Record<BookId, Range[]> = {
  lotm1: LOTM1_RANGES,
  coi: COI_RANGES,
};

export function assignArc(bookId: BookId, chapterNum: number): ArcAssignment {
  if (!Number.isInteger(chapterNum) || chapterNum < 1) {
    throw new Error(`assignArc: chapterNum must be a positive integer, got ${chapterNum}`);
  }
  const ranges = RANGES_BY_BOOK[bookId];
  for (const r of ranges) {
    if (chapterNum >= r.start && chapterNum <= r.end) {
      return {
        volume: r.volume,
        volumeName: r.volumeName,
        arc: r.arc,
        arcName: r.arcName,
        contentKind: r.contentKind,
      };
    }
  }
  throw new Error(`assignArc: ${bookId} chapter ${chapterNum} is outside known ranges`);
}
