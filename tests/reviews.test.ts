import { describe, expect, it, vi, afterEach } from "vitest";
import { complete } from "@mariozechner/pi-ai";
import { runReview } from "../src/reviews.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

vi.mock("@mariozechner/pi-ai", () => ({
  complete: vi.fn(),
}));

function makeConfig(overrides: Partial<TDDConfig> = {}): TDDConfig {
  return {
    enabled: true,
    reviewModel: null,
    reviewProvider: null,
    reviewModels: {},
    autoTransition: true,
    refactorTransition: "user",
    allowReadInAllPhases: true,
    maxDiffsInContext: 5,
    persistPhase: true,
    startInSpecMode: false,
    defaultEngaged: false,
    runPreflightOnRed: true,
    engageOnTools: [],
    disengageOnTools: [],
    guidelines: resolveGuidelines({}),
    ...overrides,
  };
}

function makeContext() {
  return {
    signal: undefined,
    model: { provider: "openai", id: "gpt-5.4-mini" },
    modelRegistry: {
      find: vi.fn(),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "test-key",
        headers: { "x-test": "1" },
      }),
    },
  } as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("runReview", () => {
  it("does not send an unsupported temperature parameter", async () => {
    vi.mocked(complete).mockResolvedValue({
      stopReason: "end_turn",
      content: [{ type: "text", text: '{"ok": true}' }],
    } as never);

    await runReview(
      {
        label: "preflight",
        systemPrompt: "Review the checklist.",
        userPrompt: "Spec: one item.",
      },
      makeContext(),
      makeConfig()
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(complete).mock.calls[0]?.[2]).toEqual({
      apiKey: "test-key",
      headers: { "x-test": "1" },
      signal: undefined,
    });
  });
});
