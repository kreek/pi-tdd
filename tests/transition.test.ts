import { describe, expect, it, vi } from "vitest";
import { fallbackTransition, evaluateTransition, extractTestSignal, inferTestProofLevel, isTestCommand } from "../src/transition.ts";
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
    persistPhase: false,
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
    hasUI: false,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  } as never;
}

describe("isTestCommand", () => {
  it("detects common package manager test commands", () => {
    expect(isTestCommand("npm test")).toBe(true);
    expect(isTestCommand("npm run test")).toBe(true);
    expect(isTestCommand("npm run test:unit")).toBe(true);
    expect(isTestCommand("pnpm run test:watch")).toBe(true);
    expect(isTestCommand("bun test")).toBe(true);
    expect(isTestCommand("bun run test:e2e")).toBe(true);
  });

  it("detects direct runners and wrapped scripts", () => {
    expect(isTestCommand("vitest --run")).toBe(true);
    expect(isTestCommand("npx vitest run")).toBe(true);
    expect(isTestCommand("bash ./scripts/test.sh")).toBe(true);
    expect(isTestCommand("./scripts/test")).toBe(true);
    expect(isTestCommand("npm test 2>&1 | tee log.txt || true")).toBe(true);
  });

  it("avoids obvious false positives", () => {
    expect(isTestCommand("grep jest src/package.json")).toBe(false);
    expect(isTestCommand("cat jest.config.ts | head")).toBe(false);
    expect(isTestCommand("echo test")).toBe(false);
  });
});

describe("extractTestSignal", () => {
  it("captures bash test output", () => {
    const signal = extractTestSignal({
      toolName: "bash",
      input: { command: "npm run test" },
      content: [{ type: "text", text: "1 failed" }],
      isError: true,
    } as never);

    expect(signal).toEqual({
      command: "npm run test",
      output: "1 failed",
      failed: true,
      level: "unknown",
    });
  });

  it("ignores non-test bash commands", () => {
    const signal = extractTestSignal({
      toolName: "bash",
      input: { command: "ls -la" },
      content: [{ type: "text", text: "ok" }],
      isError: false,
    } as never);

    expect(signal).toBeNull();
  });

  it("treats masked failing test output as a failure signal", () => {
    const signal = extractTestSignal({
      toolName: "bash",
      input: { command: "npm test || true" },
      content: [{ type: "text", text: "1 failed" }],
      isError: false,
    } as never);

    expect(signal).toEqual({
      command: "npm test || true",
      output: "1 failed",
      failed: true,
      level: "unknown",
    });
  });

  it("treats masked passing test output as a passing signal", () => {
    const signal = extractTestSignal({
      toolName: "bash",
      input: { command: "npm test || true" },
      content: [{ type: "text", text: "1 passed" }],
      isError: false,
    } as never);

    expect(signal).toEqual({
      command: "npm test || true",
      output: "1 passed",
      failed: false,
      level: "unknown",
    });
  });
});

describe("inferTestProofLevel", () => {
  it("classifies unit test commands", () => {
    expect(inferTestProofLevel("npm run test:unit")).toBe("unit");
  });

  it("classifies integration-style test commands", () => {
    expect(inferTestProofLevel("pnpm run test:integration")).toBe("integration");
    expect(inferTestProofLevel("bun run test:e2e")).toBe("integration");
  });

  it("returns unknown when the command does not signal proof level", () => {
    expect(inferTestProofLevel("npm test")).toBe("unknown");
  });
});

describe("fallbackTransition", () => {
  it("advances from RED when a failing test is observed", () => {
    const machine = new PhaseStateMachine({ phase: "RED" });
    const verdict = fallbackTransition(
      machine,
      [{ command: "npm test", output: "1 failed", failed: true, level: "unknown" }],
      machine.nextPhase()
    );

    expect(verdict.transition).toBe("GREEN");
  });

  it("advances from GREEN when a passing test is observed", () => {
    const machine = new PhaseStateMachine({ phase: "GREEN" });
    const verdict = fallbackTransition(
      machine,
      [{ command: "npm test", output: "1 passed", failed: false, level: "unknown" }],
      machine.nextPhase()
    );

    expect(verdict.transition).toBe("REFACTOR");
  });
});

describe("evaluateTransition", () => {
  it("records the last test result while auto-transitioning", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });

    await evaluateTransition(
      [{ command: "npm test", output: "1 passed", failed: false, level: "unknown" }],
      machine,
      makeConfig(),
      makeContext()
    );

    expect(machine.phase).toBe("REFACTOR");
    expect(machine.lastTestFailed).toBe(false);
    expect(machine.lastTestOutput).toBe("1 passed");
    expect(machine.getSnapshot().recentTests).toEqual([
      { command: "npm test", output: "1 passed", failed: false, level: "unknown" },
    ]);
  });

  it("records the last test result without transitioning when auto-transition is disabled", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });

    await evaluateTransition(
      [{ command: "npm test", output: "1 passed", failed: false, level: "unknown" }],
      machine,
      makeConfig({ autoTransition: false }),
      makeContext()
    );

    expect(machine.phase).toBe("GREEN");
    expect(machine.lastTestFailed).toBe(false);
    expect(machine.lastTestOutput).toBe("1 passed");
  });

  it("captures the first failing RED test as the proof checkpoint", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "RED",
      plan: ["persist settings through the HTTP API"],
    });
    machine.recordMutation("edit", "tests/http/settings.integration.test.ts");

    await evaluateTransition(
      [{ command: "npm run test:integration", output: "1 failed", failed: true, level: "integration" }],
      machine,
      makeConfig(),
      makeContext()
    );

    expect(machine.phase).toBe("GREEN");
    expect(machine.getSnapshot().proofCheckpoint).toEqual({
      itemIndex: null,
      item: null,
      seam: "business_http",
      command: "npm run test:integration",
      commandFamily: "npm:test:integration",
      level: "integration",
      testFiles: ["tests/http/settings.integration.test.ts"],
      mutationCountAtCapture: 1,
    });
  });

  it("nudges RED when tests pass before a failing proof has been established", async () => {
    const ctx = {
      hasUI: true,
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
      },
    } as never;
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "RED",
      plan: ["persist settings through the HTTP API"],
    });
    machine.recordMutation("edit", "tests/http/settings.integration.test.ts");

    await evaluateTransition(
      [{ command: "npm run test:integration", output: "1 passed", failed: false, level: "integration" }],
      machine,
      makeConfig(),
      ctx
    );

    expect(machine.getSnapshot().proofCheckpoint).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "RED still needs its first failing proving test for the current spec item",
      "info"
    );
  });

  it("keeps GREEN focused on the active proof target", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "GREEN",
      proofCheckpoint: {
        itemIndex: 1,
        item: "persist settings through the HTTP API",
        seam: "business_http",
        command: "npm test",
        commandFamily: "npm:test",
        level: "unknown",
        testFiles: [],
        mutationCountAtCapture: 0,
      },
    });

    await evaluateTransition(
      [{ command: "pnpm run test:integration", output: "1 passed", failed: false, level: "integration" }],
      machine,
      makeConfig(),
      makeContext()
    );

    expect(machine.phase).toBe("GREEN");

    await evaluateTransition(
      [{ command: "npm run test:unit", output: "1 passed", failed: false, level: "unit" }],
      machine,
      makeConfig(),
      makeContext()
    );

    expect(machine.phase).toBe("REFACTOR");
  });
});
