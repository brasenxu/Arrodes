import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { buildTools } from "@/lib/rag/tools";
import type { ReadingPosition } from "@/lib/rag/types";

export const runtime = "nodejs"; // Fluid Compute (not Edge — AI SDK + pgvector work best on Node)
export const maxDuration = 60;

const CHAT_MODEL = process.env.CHAT_MODEL ?? "anthropic/claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are Arrodes, a RAG assistant grounded in Lord of the Mysteries (LOTM1) and Circle of Inevitability (COI).

Rules:
- Ground every factual claim in a retrieved chunk. Cite as (Book Ch.N) inline.
- Prefer EPUB chunks over wiki over forum. If sources disagree, surface the disagreement.
- Never speculate past the user's reading position. If a chunk you'd need is past their position, say so — don't reason around it.
- For list / count / "all X" questions, call aggregateEvents first. For named-entity questions, call lookupEntity first.
- If retrieval returns nothing useful, say so. Don't fall back to training-data knowledge.`;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    position?: ReadingPosition;
  };

  // TODO: derive from authenticated session once auth lands.
  // Default to fully-read for dev; UI slider will set this per-session.
  const position: ReadingPosition = body.position ?? {
    lotm1: 1396,
    coi: 1180,
  };

  const result = streamText({
    model: CHAT_MODEL,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(body.messages),
    tools: buildTools(position),
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
