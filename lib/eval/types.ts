import { z } from "zod";

export const queryTypeSchema = z.enum([
  "chapter_summary",
  "lore",
  "character",
  "pathway",
  "timeline",
  "dialogue",
  "aggregation",
]);

export type QueryType = z.infer<typeof queryTypeSchema>;

export const evalEntrySchema = z.object({
  id: z.string().regex(/^Q\d{3}$/),
  query_type: queryTypeSchema,
  book: z.enum(["lotm1", "coi", "both"]),
  question: z.string().min(10),

  // Ground truth for retrieval evaluation.
  // expected_chapters = chapters the retrieval MUST surface (recall@k).
  // expected_entities = canonical entity names that should appear in the answer.
  expected_chapters: z.array(z.number().int().positive()).min(0),
  expected_entities: z.array(z.string()).default([]),

  // Spoiler-control fixture. When set, the eval runner should cap the reading
  // position at these values and verify the assistant does NOT cite chapters
  // beyond them. null = unbounded (user has finished).
  reading_position: z
    .object({
      lotm1: z.number().int().nullable(),
      coi: z.number().int().nullable(),
    })
    .optional(),

  // Optional: short reference answer for LLM-as-judge scoring. Keep terse —
  // this isn't the full expected response, just the load-bearing facts.
  reference_answer: z.string().optional(),

  // Draft | verified | rejected. New entries default to 'draft' and need
  // human chapter-verification before being trusted as ground truth.
  status: z.enum(["draft", "verified", "rejected"]).default("draft"),

  notes: z.string().optional(),
});

export type EvalEntry = z.infer<typeof evalEntrySchema>;
