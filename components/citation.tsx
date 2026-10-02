"use client";

import { useState } from "react";
import type { CitationInfo } from "@/lib/client/citations";

/**
 * Inline citation pill (ticket 013): hover/click popover with the chapter
 * title + top-1 correlated chunk excerpt. "Copy link" is a placeholder until
 * an external chapter reader exists (ticket 013 out-of-scope note).
 */
export function Citation({
  book,
  chapterNum,
  info,
}: {
  book: "LOTM1" | "COI";
  chapterNum: number;
  info: CitationInfo | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="mx-0.5 rounded-full border border-white/20 bg-white/5 px-1.5 py-0.5 align-baseline text-[11px] text-white/70 hover:bg-white/10"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {book} Ch.{chapterNum}
      </button>
      {open ? (
        <span className="absolute bottom-full left-0 z-10 mb-2 block w-80 rounded-lg border border-white/10 bg-neutral-900 p-3 text-left text-xs normal-case shadow-xl">
          <span className="mb-1 block font-medium text-white/90">
            {info?.chapterTitle ?? `${book} chapter ${chapterNum}`}
          </span>
          <span className="block whitespace-pre-wrap text-white/60">
            {info?.excerpt ?? "No retrieved excerpt available for this citation."}
          </span>
          <button
            type="button"
            disabled
            title="External chapter reader not wired yet (ticket 013 out of scope)"
            className="mt-2 cursor-not-allowed rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/40"
          >
            Copy link
          </button>
        </span>
      ) : null}
    </span>
  );
}
