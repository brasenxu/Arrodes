import { z } from "zod";

export const LorePathwayInput = z.object({
  name: z.string().min(1).describe(
    "Pathway name or any sequence title in its ladder. Case-insensitive. Example: 'Fool', 'Seer', 'Lord of Mysteries'."
  ),
});

export const LorePathwaysListInput = z.object({
  category: z
    .enum(["standard", "outer-deity", "non-standard"])
    .optional()
    .describe("Filter to one category. Omit for all."),
});

export const WikiSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional().default(5),
});

export const WikiGetPageInput = z.object({
  title: z.string().min(1),
  section: z.union([z.string(), z.number().int()]).optional(),
  full: z.boolean().optional().default(false),
});

export const WikiCategoryMembersInput = z.object({
  category: z.string().min(1).describe("Category name with or without the 'Category:' prefix."),
  limit: z.number().int().min(1).max(500).optional().default(50),
});

export const WikiVolumeTimelineInput = z.object({
  volume: z.number().int().min(1).max(9),
});

export type LorePathwayInputT = z.infer<typeof LorePathwayInput>;
export type LorePathwaysListInputT = z.infer<typeof LorePathwaysListInput>;
export type WikiSearchInputT = z.infer<typeof WikiSearchInput>;
export type WikiGetPageInputT = z.infer<typeof WikiGetPageInput>;
export type WikiCategoryMembersInputT = z.infer<typeof WikiCategoryMembersInput>;
export type WikiVolumeTimelineInputT = z.infer<typeof WikiVolumeTimelineInput>;
