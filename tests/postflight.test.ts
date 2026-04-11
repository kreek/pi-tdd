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
    runPreflightOnRed: true,
    startOnTools: [],
    endOnTools: [],
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

  it("delegates to the review model when there is no early-return condition", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "REFACTOR",
      plan: ["POST /api/links returns 201 and a short URL."],
    });
    machine.recordTestResult("1 passed", false, "npm run test:integration", "integration");

    // No review model configured, so runPostflight will throw when it tries
    // to call the LLM — confirming the early-return paths are bypassed.
    await expect(
      runPostflight(
        { state: machine.getSnapshot(), userStory: "POST /api/links creates short links." },
        {} as never,
        makeConfig()
      )
    ).rejects.toThrow();
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

    expect(prompt).toContain("Proof checkpoint (first failing test in RED):");
    expect(prompt).toContain("Command: npm run test:integration");
    expect(prompt).toContain("Test files: tests/http/settings.integration.test.ts");
    expect(prompt).toContain("Proof files changed after checkpoint: tests/http/settings.integration.test.ts");
    expect(prompt).toContain("Test runs captured in this cycle:");
    expect(prompt).toContain("FAIL | npm run test:integration");
    expect(prompt).toContain("PASS | npm run test:integration");
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
    expect(text).toContain("Post-flight found 2 issue(s): two gaps");
    expect(text).toContain("• weak test");
    expect(text).toContain("• missing edge case");
  });
});
