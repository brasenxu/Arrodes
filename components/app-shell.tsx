"use client";

import { Chat } from "@/components/chat";
import { PositionModal } from "@/components/reading-position";
import { usePosition } from "@/lib/client/position";

/**
 * Client owner of the reading-position state (ticket 012): one usePosition
 * instance shared by the header pencil, the modal, and the chat — modal open
 * state can't live per-consumer.
 */
export function AppShell() {
  const { position, hasBeenSet, setPosition, modalOpen, openModal, closeModal } =
    usePosition();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 flex items-start justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Arrodes</h1>
          <p className="text-sm text-white/60">
            Lord of the Mysteries + Circle of Inevitability, grounded in the
            canonical translation.
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/5"
          aria-label="Set reading position"
          title="Set reading position"
        >
          ✎
        </button>
      </header>
      <Chat position={position} onOpenSettings={openModal} />
      <PositionModal
        open={modalOpen}
        position={position}
        onClose={hasBeenSet ? closeModal : () => {}}
        onSave={setPosition}
      />
    </main>
  );
}
