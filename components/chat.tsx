"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { Citation } from "@/components/citation";
import { buildCitationIndex, parseCitations, type CitationToken } from "@/lib/client/citations";

function TextPart({ text, parts }: { text: string; parts: ReturnType<typeof useChat>["messages"][number]["parts"] }) {
  const index = buildCitationIndex(parts);
  return (
    <>
      {parseCitations(text).map((token: CitationToken, i: number) =>
        token.kind === "text" ? (
          <span key={i}>{token.value}</span>
        ) : (
          <Citation
            key={i}
            book={token.book}
            chapterNum={token.chapterNum}
            info={index.get(`${token.book}:${token.chapterNum}`)}
          />
        ),
      )}
    </>
  );
}

export function Chat({
  position,
  onOpenSettings,
}: {
  position: { lotm1: number | null; coi: number | null } | null;
  onOpenSettings: () => void;
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop, regenerate } = useChat();
  const busy = status === "submitted" || status === "streaming";
  const unset = position === null;
  const bothNull =
    position !== null && position.lotm1 === null && position.coi === null;
  const disabled = unset || bothNull;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className="rounded-md border border-white/10 p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-white/50">
              {m.role}
            </div>
            <div className="whitespace-pre-wrap text-sm">
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <TextPart
                      key={i}
                      text={part.text}
                      parts={m.parts}
                    />
                  );
                }
                if (part.type.startsWith("tool-")) {
                  const st = (
                    part as { state?: string; errorText?: string }
                  ).state;
                  if (st === "output-error") {
                    return (
                      <div
                        key={i}
                        className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
                      >
                        Tool call failed — answer continues with what it has.
                      </div>
                    );
                  }
                  return (
                    <pre
                      key={i}
                      className="mt-2 rounded bg-white/5 p-2 text-xs text-white/60"
                    >
                      {JSON.stringify(part, null, 2)}
                    </pre>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
      </div>

      {error ? (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Something went wrong talking to the model — try again. (Details in
          the server console.)
          <button
            type="button"
            className="ml-2 underline hover:text-white"
            onClick={() => regenerate()}
          >
            Retry last message
          </button>
        </div>
      ) : null}

      {messages.length === 0 && !disabled ? (
        <div className="px-1 text-xs text-white/40">
          Ask about a chapter (&ldquo;what happens in chapter 245?&rdquo;), a character, a pathway, or an
          arc overview. Answers cite the exact chapter they came from.
        </div>
      ) : null}

      {disabled ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {unset
            ? "Set your reading position first so Arrodes knows where to stop for spoilers."
            : "You haven't started either book yet — set a reading position to begin."}{" "}
          <button
            type="button"
            className="underline hover:text-white"
            onClick={onOpenSettings}
          >
            Set reading position
          </button>
        </div>
      ) : null}

      <form
        className="flex gap-2 border-t border-white/10 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy || disabled) return;
          // position is non-null here (disabled guard); the route requires it.
          sendMessage({ text: input }, { body: { position } });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/30"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a chapter, character, pathway…"
          disabled={busy || disabled}
        />
        <button
          type="submit"
          disabled={busy || disabled || !input.trim()}
          className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          Send
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => stop()}
            className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
          >
            Stop
          </button>
        ) : null}
      </form>
    </div>
  );
}
