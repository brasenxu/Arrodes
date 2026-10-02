import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatModel } from "./chat-model";

describe("resolveChatModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes a namespaced id through as a gateway string when the gateway key exists", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-key");
    vi.stubEnv("CHAT_MODEL", "google/gemini-2.5-flash");
    const model = resolveChatModel();
    expect(model).toBe("google/gemini-2.5-flash");
  });

  it("resolves a namespaced id directly via the google provider when no gateway key exists", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "g-key");
    vi.stubEnv("CHAT_MODEL", "google/gemini-2.5-flash");
    const model = resolveChatModel();
    expect(typeof model).not.toBe("string");
    expect((model as { modelId?: string }).modelId).toBe("gemini-2.5-flash");
  });

  it("resolves a bare gemini id directly as well", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "g-key");
    vi.stubEnv("CHAT_MODEL", "gemini-2.5-flash");
    const model = resolveChatModel();
    expect((model as { modelId?: string }).modelId).toBe("gemini-2.5-flash");
  });

  it("fails fast on a non-gateway provider id without a gateway key", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("CHAT_MODEL", "anthropic/claude-sonnet-4-6");
    expect(() => resolveChatModel()).toThrow(/AI_GATEWAY_API_KEY|gateway/i);
  });
});
