import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { ReadingPosition } from "@/lib/rag/types";

/**
 * Reading-position persistence (ticket 012). Stored under
 * `localStorage.arrodes.position` as {lotm1, coi, updatedAt}; both books may
 * be null ("hasn't started"). All parsing is defensive — localStorage can
 * hold anything.
 */

export const POSITION_STORAGE_KEY = "arrodes.position";

const STORED_POSITION_SCHEMA = z
  .object({
    lotm1: z.union([z.null(), z.number().int().min(0)]),
    coi: z.union([z.null(), z.number().int().min(0)]),
    updatedAt: z.string().min(1),
  })
  .strict();

export type StoredPosition = z.infer<typeof STORED_POSITION_SCHEMA>;

export function parseStoredPosition(raw: string | null): StoredPosition | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = STORED_POSITION_SCHEMA.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function serializeStoredPosition(
  p: { lotm1: number | null; coi: number | null },
): string {
  return JSON.stringify({ ...p, updatedAt: new Date().toISOString() });
}

/**
 * Session-only override for ticket 017's future "spoil me" affordance —
 * deliberately NOT persisted (the 017 seam).
 */
export function usePosition() {
  const [position, setPositionState] = useState<StoredPosition | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [spoilMe, setSpoilMe] = useState(false);

  useEffect(() => {
    try {
      setPositionState(parseStoredPosition(localStorage.getItem(POSITION_STORAGE_KEY)));
    } catch {
      // localStorage unavailable (SSR/privacy mode) — treat as unset.
    }
    setLoaded(true);
  }, []);

  const setPosition = useCallback(
    (p: { lotm1: number | null; coi: number | null }) => {
      const stored = { ...p, updatedAt: new Date().toISOString() };
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, serializeStoredPosition(p));
      } catch {
        // Persist failure is non-fatal; the session keeps the value.
      }
      setPositionState(stored);
      setUserOpen(false);
    },
    [],
  );

  const hasBeenSet = position !== null;
  const modalOpen = userOpen || (loaded && !hasBeenSet);

  return {
    position,
    hasBeenSet,
    setPosition,
    modalOpen,
    openModal: () => setUserOpen(true),
    closeModal: () => setUserOpen(false),
    spoilMe,
    setSpoilMe,
  };
}
