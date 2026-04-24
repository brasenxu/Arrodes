export interface MediaWikiSection {
  toclevel: number;
  level: string;
  line: string;
  number: string;
  index: string; // 1-based integer as string
  byteoffset: number | null;
  anchor: string;
  fromtitle: string;
}

export interface ResolveResult {
  index: string | null;
  notFound?: boolean;
}

export interface ResolveOptions {
  matchMode?: "exact-ci" | "regex";
}

export function resolveSectionIndex(
  sections: MediaWikiSection[],
  input: string | number | RegExp | undefined,
  opts: ResolveOptions = {},
): ResolveResult {
  if (input === undefined) return { index: null };
  if (typeof input === "number") return { index: String(input) };
  if (typeof input === "string" && /^\d+$/.test(input)) return { index: input };

  const mode = opts.matchMode ?? "exact-ci";
  const pred =
    mode === "regex"
      ? (s: MediaWikiSection) => (input instanceof RegExp ? input.test(s.line) : false)
      : (s: MediaWikiSection) =>
          typeof input === "string" && s.line.toLowerCase() === input.toLowerCase();

  const match = sections.find(pred);
  if (!match) return { index: null, notFound: true };
  return { index: match.index };
}
