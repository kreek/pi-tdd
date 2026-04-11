import { describe, expect, it } from "vitest";
import {
  buildPostflightUserPrompt,
  formatPostflightResult,
  parsePostflightResponse,
  runPostflight,
} from "../src/postflight.ts";
import { PhaseStateMachine } from "../src/phase.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

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

describe("parsePostflightResponse", () => {
  it("parses a successful verdict", () => {
    const result = parsePostflightResponse('{"ok": true, "reason": "all good"}');
    expect(result).toEqual({ ok: true, reason: "all good" });
  });

  it("parses a failing verdict with item-scoped gaps", () => {
    const raw = JSON.stringify({
      ok: false,
      reason: "tests are too narrow",
      gaps: [
        { itemIndex: 2, message: "test only checks happy path" },
        { itemIndex: null, message: "missing integration coverage" },
      ],
    });
    const result = parsePostflightResponse(raw);
    expect(result).toEqual({
      ok: false,
      reason: "tests are too narrow",
      gaps: [
        { itemIndex: 2, message: "test only checks happy path" },
        { itemIndex: null, message: "missing integration coverage" },
      ],
    });
  });

  it("strips fenced JSON before parsing", () => {
    const raw = '```\n{"ok": true, "reason": "ok"}\n```';
    expect(parsePostflightResponse(raw)).toEqual({ ok: true, reason: "ok" });
  });

  it("throws on non-JSON responses", () => {
    expect(() => parsePostflightResponse("not json")).toThrow();
  });

  it("requires `ok` to be a boolean", () => {
    expect(() => parsePostflightResponse('{"ok": "true", "reason": "nope"}')).toThrow(/boolean/);
  });
});

describe("runPostflight early-return paths", () => {
  it("returns failure without calling the LLM when the last test failed", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    machine.recordTestResult("1 failed", true);
    const result = await runPostflight(
      { state: machine.getSnapshot() },
      {} as never,
      makeConfig()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gaps.length).toBeGreaterThan(0);
    }
  });

  it("fails when business requests only have helper-level proof", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "REFACTOR",
      plan: ["POST /api/links returns 201 and a short URL."],
      requestedSeam: "business_http",
      proofCheckpoint: {
        itemIndex: 1,
        item: "POST /api/links returns 201 and a short URL.",
        seam: "internal_support",
        command: "npm run test:unit",
        commandFamily: "npm:test:unit",
        level: "unit",
        testFiles: ["src/lib/server/link.service.spec.ts"],
        mutationCountAtCapture: 1,
      },
    });

    const result = await runPostflight(
      { state: machine.getSnapshot(), userStory: "POST /api/links creates short links." },
      {} as never,
      makeConfig()
    );

    expect(result).toEqual({
      ok: false,
      reason: "The green test evidence does not prove the requested business seam yet.",
      gaps: [
        {
          itemIndex: 1,
          message: "Requested HTTP/API contract, but the proving slice stayed at internal support work.",
        },
        {
          itemIndex: null,
          message:
            "Add route/page-level proof for this feature before treating helper, schema, service, or migration tests as complete delivery.",
        },
      ],
    });
  });
});

describe("buildPostflightUserPrompt", () => {
  it("includes recent test history with proof levels", () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "REFACTOR",
      plan: ["persist settings through the HTTP API"],
    });
    machine.recordMutation("edit", "tests/http/settings.integration.test.ts");
    machine.recordTestResult("1 failed", true, "npm run test:integration", "integration");
    machine.captureProofCheckpoint(
      { command: "npm run test:integration", output: "1 failed", failed: true, level: "integration" },
      "npm:test:integration"
    );
    machine.recordMutation("edit", "tests/http/settings.integration.test.ts");
    machine.recordTestResult("1 passed", false, "npm run test:integration", "integration");

    const prompt = buildPostflightUserPrompt({
      state: machine.getSnapshot(),
      userStory: "persist settings through the HTTP API",
    });

    expect(prompt).toContain("Proof checkpoint for this cycle:");
    expect(prompt).toContain("Requested seam: HTTP/API contract");
    expect(prompt).toContain("Observed proof seam: HTTP/API contract");
    expect(prompt).toContain("Spec item: 1. persist settings through the HTTP API");
    expect(prompt).toContain("Proof seam: HTTP/API contract");
    expect(prompt).toContain("Captured in RED by: FAIL | INTEGRATION | npm run test:integration");
    expect(prompt).toContain("Checkpoint test files:");
    expect(prompt).toContain("tests/http/settings.integration.test.ts");
    expect(prompt).toContain("Proof files changed after checkpoint:");
    expect(prompt).toContain("Recent test runs captured in this cycle:");
    expect(prompt).toContain("PASS | INTEGRATION | npm run test:integration");
    expect(prompt).toContain("right level");
  });
});

describe("formatPostflightResult", () => {
  it("formats a successful result", () => {
    const text = formatPostflightResult({ ok: true, reason: "delivered" });
    expect(text).toContain("Post-flight OK");
    expect(text).toContain("delivered");
  });

  it("formats a failing result with gaps", () => {
    const text = formatPostflightResult({
      ok: false,
      reason: "two gaps",
      gaps: [
        { itemIndex: 1, message: "weak test" },
        { itemIndex: null, message: "missing edge case" },
      ],
    });
    expect(text).toContain("Post-flight found 2 gap(s)");
    expect(text).toContain("1. weak test");
    expect(text).toContain("• missing edge case");
  });
});
