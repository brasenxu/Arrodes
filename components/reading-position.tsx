"use client";

import { useState } from "react";
import { FULL_BOUNDS, MAIN_BOUNDS } from "@/lib/ingest/arc-map";
import type { StoredPosition } from "@/lib/client/position";

const BOOK_LABELS = {
  lotm1: "Lord of the Mysteries",
  coi: "Circle of Inevitability",
} as const;

type BookKey = keyof typeof BOOK_LABELS;

function BookSlider({
  book,
  value,
  onChange,
}: {
  book: BookKey;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const full = FULL_BOUNDS[book];
  const main = MAIN_BOUNDS[book];

  if (value === null) {
    return (
      <div className="rounded-md border border-white/10 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{BOOK_LABELS[book]}</span>
          <span className="text-xs text-white/50">Not started</span>
        </div>
        <button
          type="button"
          className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/5"
          onClick={() => onChange(1)}
        >
          I&apos;ve started this book
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{BOOK_LABELS[book]}</span>
        <span className="text-xs text-white/50">
          Read through chapter {value}
          {value > main ? " (incl. side stories)" : ""}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={full}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={`${BOOK_LABELS[book]} reading position`}
      />
      <div className="mt-1 flex justify-between text-[10px] text-white/40">
        <span>1</span>
        <span>{main} — end of main story</span>
        <span>{full}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/5"
          onClick={() => onChange(full)}
        >
          I&apos;ve finished this book
        </button>
        <button
          type="button"
          className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/5"
          onClick={() => onChange(null)}
        >
          I haven&apos;t started this book
        </button>
      </div>
    </div>
  );
}

export function PositionModal({
  open,
  position,
  onClose,
  onSave,
}: {
  open: boolean;
  position: StoredPosition | null;
  onClose: () => void;
  onSave: (p: { lotm1: number | null; coi: number | null }) => void;
}) {
  const [draft, setDraft] = useState<{ lotm1: number | null; coi: number | null } | null>(
    null,
  );

  if (!open) return null;

  const current = draft ?? position ?? { lotm1: null, coi: null };

  const update = (book: BookKey, v: number | null) =>
    setDraft({ ...current, [book]: v });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-neutral-900 p-5">
        <h2 className="mb-1 text-lg font-semibold">Where are you in the story?</h2>
        <p className="mb-4 text-xs text-white/60">
          Arrodes never spoils past this point. You can change it anytime with
          the pencil icon.
        </p>
        <div className="space-y-3">
          {(["lotm1", "coi"] as const).map((book) => (
            <BookSlider
              key={book}
              book={book}
              value={current[book]}
              onChange={(v) => update(book, v)}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {position ? (
            <button
              type="button"
              className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/5"
              onClick={onClose}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
            onClick={() => {
              onSave(current);
              setDraft(null);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
