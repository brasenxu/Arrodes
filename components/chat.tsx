"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat();
  const busy = status === "submitted" || status === "streaming";

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
                if (part.type === "text") return <span key={i}>{part.text}</span>;
                if (part.type.startsWith("tool-")) {
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

      <form
        className="flex gap-2 border-t border-white/10 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/30"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a chapter, character, pathway…"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
