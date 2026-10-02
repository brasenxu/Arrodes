import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { buildTools } from "@/lib/rag/tools";
import { resolveChatModel } from "@/lib/rag/chat-model";
import { SYSTEM_PROMPT } from "@/lib/rag/system-prompt";
import { isValidPosition } from "@/lib/rag/schemas";
import { FULL_BOUNDS } from "@/lib/ingest/arc-map";

export const runtime = "nodejs"; // Fluid Compute (not Edge — AI SDK + pgvector work best on Node)
export const maxDuration = 60;

const CHAT_MODEL = resolveChatModel();

// Citation format is pinned exactly — components/citation parsing (ticket 013)
// depends on this casing: (LOTM1 Ch.N) / (COI Ch.N). The prompt itself lives
// in lib/rag/system-prompt.ts (ticket 011 — byte-stable cacheable prefix).

// Dev default removed with ticket 012: the UI always sends position; requests
// without a valid one are rejected. (Server-side session position: ticket 031.)

export async function POST(req: Request) {
  let body: { messages?: UIMessage[]; position?: unknown };
  try {
    body = (await req.json()) as { messages?: UIMessage[]; position?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json(
      { error: "messages array required" },
      { status: 400 },
    );
  }

  // Strip client-supplied system-role messages — the system prompt is the
  // server's, and a client "system" UIMessage would be injected past it.
  const messages = body.messages.filter((m) => m.role !== "system");
  if (messages.length === 0) {
    return Response.json({ error: "messages array required" }, { status: 400 });
  }

  // Position: REQUIRED since ticket 012 — validated shape + clamped to
  // FULL_BOUNDS (audit defects 3-4).
  if (!isValidPosition(body.position)) {
    return Response.json({ error: "Invalid or missing position" }, { status: 400 });
  }
  const p = body.position;
  const position = {
    lotm1: p.lotm1 === null ? null : Math.min(p.lotm1, FULL_BOUNDS.lotm1),
    coi: p.coi === null ? null : Math.min(p.coi, FULL_BOUNDS.coi),
  };

  const result = streamText({
    model: CHAT_MODEL,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools(position),
    // 3 tool rounds + an answer step. q07/q09 battery showed the model can
    // burn every step on repeated searches and never answer without this headroom.
    stopWhen: stepCountIs(8),
    // Ticket 011 evidence: log per-request usage so implicit-cache behavior
    // (cached-token reuse across turns with a stable prefix) is observable
    // in the server console.
    onFinish: ({ usage, providerMetadata }) => {
      console.log(
        "[chat] usage:",
        JSON.stringify(usage),
        providerMetadata?.google ? `google: ${JSON.stringify(providerMetadata.google).slice(0, 300)}` : "",
      );
    },
  });

  return result.toUIMessageStreamResponse();
}
