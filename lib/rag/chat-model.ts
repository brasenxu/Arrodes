import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Chat model resolution (audit defect 6 / ticket 020 follow-through).
 *
 * Two paths, by env:
 * - `AI_GATEWAY_API_KEY` present + namespaced CHAT_MODEL → gateway string id
 *   (AI SDK routes string ids through the gateway; zero-markup PAYG).
 * - otherwise → direct provider. Currently the google provider with
 *   GOOGLE_GENERATIVE_AI_API_KEY — ticket 020's "wire @ai-sdk/google"
 *   deliverable, landed here. Any namespaced id whose provider isn't google
 *   fails fast with an actionable message instead of an opaque gateway error
 *   at request time.
 */
export function resolveChatModel():
  | string
  | ReturnType<ReturnType<typeof createGoogleGenerativeAI>> {
  const chatModel = process.env.CHAT_MODEL ?? "google/gemini-2.5-flash";

  if (process.env.AI_GATEWAY_API_KEY && chatModel.includes("/")) {
    return chatModel;
  }

  const bare = chatModel.replace(/^[^/]+\//, "");
  if (chatModel.includes("/") && !chatModel.startsWith("google/")) {
    throw new Error(
      `CHAT_MODEL "${chatModel}" needs its provider wired directly or AI_GATEWAY_API_KEY set. ` +
        `Direct wiring currently supports google/*; add the provider package for "${chatModel.split("/")[0]}" or set AI_GATEWAY_API_KEY.`,
    );
  }

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google(bare);
}
