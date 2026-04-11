import { describe, expect, it, vi } from "vitest";
import { gateSingleToolCall } from "../src/gate.ts";
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

describe("gateSingleToolCall", () => {
  it("allows read-only bash inspection commands during SPEC", async () => {
    const confirm = vi.fn();
    const ctx = {
      hasUI: true,
      signal: undefined,
      ui: {
        notify: vi.fn(),
        confirm,
      },
    } as never;
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC" });

    const result = await gateSingleToolCall(
      {
        type: "tool_call",
        toolCallId: "call-find",
        toolName: "bash",
        input: { command: "find src -maxdepth 4 -type f | sort" },
      },
      machine,
      makeConfig(),
      ctx
    );

    expect(result).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("still blocks mutating bash commands during SPEC", async () => {
    const notify = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const ctx = {
      hasUI: true,
      signal: undefined,
      ui: {
        notify,
        confirm,
      },
    } as never;
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC" });

    const result = await gateSingleToolCall(
      {
        type: "tool_call",
        toolCallId: "call-mkdir",
        toolName: "bash",
        input: { command: "mkdir -p src/routes/api/links" },
      },
      machine,
      makeConfig(),
      ctx
    );

    expect(result).toEqual({
      block: true,
      reason: "SPEC phase blocks file changes and mutating shell commands until the test specification is ready.",
    });
    expect(notify).toHaveBeenCalledWith(
      "SPEC is read-only for changes. Inspection is fine, but file edits and mutating shell commands stay blocked until RED.",
      "info"
    );
    expect(confirm).toHaveBeenCalled();
  });

  it("shows an instructive SPEC override prompt that points the agent back to RED", async () => {
    const notify = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const ctx = {
      hasUI: true,
      signal: undefined,
      ui: {
        notify,
        confirm,
      },
    } as never;
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC" });

    const result = await gateSingleToolCall(
      {
        type: "tool_call",
        toolCallId: "call-1",
        toolName: "write",
        input: { path: "src/example.ts", content: "x" },
      },
      machine,
      makeConfig(),
      ctx
    );

    expect(result).toEqual({
      block: true,
      reason: "SPEC phase blocks file changes and mutating shell commands until the test specification is ready.",
    });
    expect(notify).toHaveBeenCalledWith(
      "SPEC is read-only for changes. Inspection is fine, but file edits and mutating shell commands stay blocked until RED.",
      "info"
    );
    expect(confirm).toHaveBeenCalledWith(
      "SPEC is read-only",
      expect.stringContaining("RED entry will review and sharpen the checklist if needed"),
      { signal: undefined }
    );
  });
});
