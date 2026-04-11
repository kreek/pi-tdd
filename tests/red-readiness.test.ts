import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@mariozechner/pi-ai";
import {
  buildSpecRefinementUserPrompt,
  parseSpecClarificationResponse,
  parseSpecRefinementResponse,
  runRedReadinessCheck,
} from "../src/red-readiness.ts";
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

describe("parseSpecRefinementResponse", () => {
  it("accepts a valid refined checklist", () => {
    expect(
      parseSpecRefinementResponse(
        '{"reason":"split store and redirect behavior","items":["stores a created link","redirects an existing slug"]}'
      )
    ).toEqual({
      reason: "split store and redirect behavior",
      items: ["stores a created link", "redirects an existing slug"],
      questions: [],
    });
  });

  it("accepts clarification questions when the checklist cannot be drafted yet", () => {
    expect(
      parseSpecRefinementResponse(
        '{"reason":"missing the core redirect rule","items":[],"questions":["Should unknown slugs return 404 or redirect somewhere else?"]}'
      )
    ).toEqual({
      reason: "missing the core redirect rule",
      items: [],
      questions: ["Should unknown slugs return 404 or redirect somewhere else?"],
    });
  });
});

describe("parseSpecClarificationResponse", () => {
  it("accepts clarification questions", () => {
    expect(
      parseSpecClarificationResponse(
        '{"reason":"missing the first acceptance check","questions":["What exact behavior should the first RED cycle prove?"]}'
      )
    ).toEqual({
      reason: "missing the first acceptance check",
      questions: ["What exact behavior should the first RED cycle prove?"],
    });
  });
});

describe("buildSpecRefinementUserPrompt", () => {
  it("includes both the current checklist and readiness issues", () => {
    const prompt = buildSpecRefinementUserPrompt({
      userStory: "Persist links in SQLite.",
      requestedSeam: "business_http",
      spec: ["SQLite-backed link handling works end to end."],
      issues: [{ itemIndex: 1, message: "split persistence from routing behavior" }],
    });

    expect(prompt).toContain("Requested seam: HTTP/API contract");
    expect(prompt).toContain("Current spec checklist:");
    expect(prompt).toContain("Readiness issues to address:");
    expect(prompt).toContain("split persistence from routing behavior");
  });
});

describe("runRedReadinessCheck", () => {
  it("drafts the first checklist from a clear request when the spec is empty", async () => {
    vi.mocked(complete)
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{
          type: "text",
          text: JSON.stringify({
            reason: "drafted the first two observable checks from the request",
            items: [
              "POST /api/links creates a short link for a valid destination URL.",
              "GET /[slug] redirects an existing slug to the stored destination URL.",
            ],
            questions: [],
          }),
        }],
      } as never)
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            reason: "the drafted checklist is concrete enough to start RED",
          }),
        }],
      } as never);

    const result = await runRedReadinessCheck(
      {
        userStory: "Create a link shortener that stores links and redirects by slug.",
        spec: [],
      },
      makeContext(),
      makeConfig()
    );

    expect(result.ok).toBe(true);
    expect(result.requestedSeam).toBe("business_http");
    expect(result.refined).toBe(true);
    expect(result.refinedSpec).toEqual([
      "POST /api/links creates a short link for a valid destination URL.",
      "GET /[slug] redirects an existing slug to the stored destination URL.",
    ]);
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(2);
  });

  it("auto-refines a weak checklist and rechecks it for RED", async () => {
    vi.mocked(complete)
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{
          type: "text",
          text: JSON.stringify({
            reason: "rewrote the checklist around the route seam first",
            items: [
              "POST /api/links stores a new link so a later GET /[slug] can redirect after restart.",
              "GET /[slug] returns 404 when the slug does not exist.",
            ],
          }),
        }],
      } as never)
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            reason: "the checklist is concrete and each item can drive a failing test",
          }),
        }],
      } as never);

    const result = await runRedReadinessCheck(
      {
        userStory: "POST /api/links stores links durably so GET /[slug] redirects survive restarts.",
        spec: ["SQLite-backed link handling works end to end."],
      },
      makeContext(),
      makeConfig()
    );

    expect(result.requestedSeam).toBe("business_http");
    expect(result.refined).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.refinedSpec).toEqual([
      "POST /api/links stores a new link so a later GET /[slug] can redirect after restart.",
      "GET /[slug] returns 404 when the slug does not exist.",
    ]);
    expect(result.refinementReason).toContain("route seam");
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(2);
  });

  it("surfaces clarification questions when the request is still ambiguous", async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      stopReason: "stop",
      content: [{
        type: "text",
        text: JSON.stringify({
          reason: "missing the expected redirect behavior",
          items: [],
          questions: [
            "Should unknown slugs return 404 or redirect to a fallback page?",
            "Should generated slugs be random, sequential, or user-provided by default?",
          ],
        }),
      }],
    } as never);

    const result = await runRedReadinessCheck(
      {
        userStory: "Build the first version of a link shortener.",
        spec: [],
      },
      makeContext(),
      makeConfig()
    );

    expect(result.ok).toBe(false);
    expect(result.requestedSeam).toBe("business_domain");
    expect(result.refined).toBe(false);
    expect(result.clarificationQuestions).toEqual([
      "Should unknown slugs return 404 or redirect to a fallback page?",
      "Should generated slugs be random, sequential, or user-provided by default?",
    ]);
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
  });

  it("pushes back on support-only stories before creating a fake feature slice", async () => {
    const result = await runRedReadinessCheck(
      {
        userStory: "Set up a SQLite database with links and clicks tables via Drizzle ORM.",
        spec: ["The schema defines the links and clicks tables."],
      },
      makeContext(),
      makeConfig()
    );

    expect(result.ok).toBe(false);
    expect(result.requestedSeam).toBe("internal_support");
    expect(result.refined).toBe(false);
    expect(result.refinedSpec).toBeNull();
    expect(result.clarificationQuestions).toEqual([
      "Which user-visible feature should this support first, so RED can prove the behavior through that slice?",
      "If you want a dedicated support-work cycle, what internal contract or risk must it prove beyond setting up schema, migrations, or tooling?",
    ]);
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
  });
});
