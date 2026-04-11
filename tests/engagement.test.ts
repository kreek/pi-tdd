import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@mariozechner/pi-ai";
import { PhaseStateMachine } from "../src/phase.ts";
import {
  applyLifecycleHooks,
  createDisengageTool,
  createEngageTool,
  DISENGAGE_TOOL_NAME,
  ENGAGE_TOOL_NAME,
  type EngagementDeps,
} from "../src/engagement.ts";
import { REFINE_FEATURE_SPEC_TOOL_NAME } from "../src/spec-tools.ts";
import { handleTddCommand } from "../src/commands.ts";
import { buildSystemPrompt } from "../src/system-prompt.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...original,
    complete: vi.fn(),
  };
});

function makeConfig(overrides: Partial<TDDConfig> = {}): TDDConfig {
  return {
    enabled: true,
    reviewModel: null,
    reviewProvider: null,
    reviewModels: {},
    runPreflightOnRed: true,
    engageOnTools: [],
    disengageOnTools: [],
    guidelines: resolveGuidelines({}),
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    cwd: process.cwd(),
    signal: undefined,
    sessionManager: {
      getBranch: vi.fn().mockReturnValue([]),
    },
    model: { provider: "openai", id: "gpt-5.4-mini" },
    modelRegistry: {
      find: vi.fn(),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "test-key",
        headers: { "x-test": "1" },
      }),
    },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    hasUI: false,
    ...overrides,
  } as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

function makeDeps(machine: PhaseStateMachine, config: TDDConfig): EngagementDeps {
  return {
    pi: { appendEntry: vi.fn() } as never,
    machine,
    getConfig: () => config,
  };
}

describe("PhaseStateMachine defaults", () => {
  it("defaults to dormant (enabled=false) on a fresh machine", () => {
    const machine = new PhaseStateMachine();
    expect(machine.enabled).toBe(false);
  });

  it("status text reports dormant when not engaged", () => {
    const machine = new PhaseStateMachine();
    expect(machine.statusText()).toBe("[TDD: dormant]");
  });

  it("bottom-bar text is hidden (undefined) when dormant", () => {
    const machine = new PhaseStateMachine();
    expect(machine.bottomBarText()).toBeUndefined();
  });

  it("bottom-bar text matches statusText when engaged", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "RED" });
    expect(machine.bottomBarText()).toBe(machine.statusText());
  });
});

describe("applyLifecycleHooks", () => {
  it("treats tdd_start as a control tool", async () => {
    const machine = new PhaseStateMachine();
    const result = await applyLifecycleHooks(
      ENGAGE_TOOL_NAME,
      makeDeps(machine, makeConfig()),
      makeContext()
    );
    expect(result.isControlTool).toBe(true);
    expect(machine.enabled).toBe(false);
  });

  it("treats tdd_stop as a control tool", async () => {
    const machine = new PhaseStateMachine({ enabled: true });
    const result = await applyLifecycleHooks(
      DISENGAGE_TOOL_NAME,
      makeDeps(machine, makeConfig()),
      makeContext()
    );
    expect(result.isControlTool).toBe(true);
    expect(machine.enabled).toBe(true);
  });

  it("treats tdd_refine_feature_spec as a control tool", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC" });
    const result = await applyLifecycleHooks(
      REFINE_FEATURE_SPEC_TOOL_NAME,
      makeDeps(machine, makeConfig()),
      makeContext()
    );
    expect(result.isControlTool).toBe(true);
    expect(machine.enabled).toBe(true);
  });

  it("engages TDD when a configured engageOnTools tool is called", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      engageOnTools: ["mcp__manifest__start_feature"],
      runPreflightOnRed: false,
    });
    const result = await applyLifecycleHooks(
      "mcp__manifest__start_feature",
      makeDeps(machine, config),
      makeContext()
    );
    expect(result.engaged).toBe(true);
    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("RED");
  });

  it("blocks auto-engage into RED when preflight fails", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({ engageOnTools: ["mcp__manifest__start_feature"] });
    const result = await applyLifecycleHooks(
      "mcp__manifest__start_feature",
      makeDeps(machine, config),
      makeContext()
    );

    expect(result.engaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
    expect(machine.getHistory()).toHaveLength(0);
  });

  it("skips auto-engage in an unscaffolded project", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      engageOnTools: ["mcp__manifest__start_feature"],
      runPreflightOnRed: false,
    });
    const emptyProject = mkdtempSync(join(tmpdir(), "pi-tdd-empty-project-"));
    const result = await applyLifecycleHooks(
      "mcp__manifest__start_feature",
      makeDeps(machine, config),
      makeContext({ cwd: emptyProject })
    );

    expect(result.engaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
  });

  it("skips auto-engage in a scaffolded project that still lacks a test harness", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      engageOnTools: ["mcp__manifest__start_feature"],
      runPreflightOnRed: false,
    });
    const project = mkdtempSync(join(tmpdir(), "pi-tdd-node-project-"));
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "app", private: true, scripts: { dev: "vite" } }, null, 2)
    );

    const result = await applyLifecycleHooks(
      "mcp__manifest__start_feature",
      makeDeps(machine, config),
      makeContext({ cwd: project })
    );

    expect(result.engaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
  });

  it("disengages TDD when a configured disengageOnTools tool is called", async () => {
    // No spec set + lastTestFailed=null, so postflight is NOT eligible and the
    // helper short-circuits without touching the LLM. This test stays a pure
    // unit test of the lifecycle hook itself.
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    const config = makeConfig({ disengageOnTools: ["mcp__manifest__complete_feature"] });
    const result = await applyLifecycleHooks(
      "mcp__manifest__complete_feature",
      makeDeps(machine, config),
      makeContext()
    );
    expect(result.disengaged).toBe(true);
    expect(machine.enabled).toBe(false);
  });

  it("keeps TDD engaged when a lifecycle disengage is attempted before RED has a failing proof", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "RED",
      plan: ["prove the API validation error at the route seam"],
    });
    const config = makeConfig({ disengageOnTools: ["mcp__manifest__complete_feature"] });

    const result = await applyLifecycleHooks(
      "mcp__manifest__complete_feature",
      makeDeps(machine, config),
      makeContext({ hasUI: true, ui: { notify: vi.fn(), setStatus: vi.fn() } })
    );

    expect(result.disengaged).toBe(false);
    expect(machine.enabled).toBe(true);
  });

  it("is a no-op for tools not in any hook list", async () => {
    const machine = new PhaseStateMachine();
    const result = await applyLifecycleHooks("bash", makeDeps(machine, makeConfig()), makeContext());
    expect(result.isControlTool).toBe(false);
    expect(result.engaged).toBeUndefined();
    expect(result.disengaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
  });

  it("does not re-engage when machine is already engaged", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "REFACTOR" });
    const config = makeConfig({ engageOnTools: ["start_feature"] });
    const result = await applyLifecycleHooks("start_feature", makeDeps(machine, config), makeContext());
    expect(result.engaged).toBeUndefined();
    expect(machine.phase).toBe("REFACTOR");
  });

  it("does not auto-engage when config disables TDD", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      enabled: false,
      engageOnTools: ["start_feature"],
    });
    const result = await applyLifecycleHooks("start_feature", makeDeps(machine, config), makeContext());
    expect(result.engaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
  });
});

describe("createEngageTool", () => {
  it("engages a dormant machine and transitions to SPEC by default", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-1",
      { reason: "implementing checkout validation" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(result.details).toMatchObject({ engaged: true, phase: "SPEC" });
  });

  it("honours an explicit RED phase", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig({ runPreflightOnRed: false })));

    await tool.execute(
      "call-2",
      { phase: "RED", reason: "fix off-by-one in pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("RED");
  });

  it("auto-drafts a checklist and engages RED when the reason is clear", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));
    vi.mocked(complete)
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{
          type: "text",
          text: JSON.stringify({
            reason: "drafted a first checklist from the feature request",
            items: [
              "Pagination returns the correct items for the requested page.",
              "Pagination reports whether a next page exists.",
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
            reason: "the checklist can drive a failing test",
          }),
        }],
      } as never);

    const result = await tool.execute(
      "call-2b",
      { phase: "RED", reason: "fix off-by-one in pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("RED");
    expect(machine.plan).toEqual([
      "Pagination returns the correct items for the requested page.",
      "Pagination reports whether a next page exists.",
    ]);
    expect(result.details).toMatchObject({ engaged: true, phase: "RED" });
  });

  it("blocks RED engagement with clarification questions when the reason is still ambiguous", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));
    vi.mocked(complete).mockResolvedValueOnce({
      stopReason: "stop",
      content: [{
        type: "text",
        text: JSON.stringify({
          reason: "missing the actual behavior to prove",
          items: [],
          questions: ["What concrete behavior is broken or missing in pagination?"],
        }),
      }],
    } as never);

    const result = await tool.execute(
      "call-2c",
      { phase: "RED", reason: "work on pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(machine.getHistory()).toHaveLength(0);
    expect(result.details).toMatchObject({ engaged: false, phase: "RED" });
    expect(result.content[0]?.text).toContain("Ask the user:");
    expect(result.content[0]?.text).toContain("What concrete behavior is broken or missing in pagination?");
  });

  it("does not engage when config disables TDD", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig({ enabled: false })));

    const result = await tool.execute(
      "call-3",
      { phase: "RED", reason: "fix off-by-one in pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(machine.phase).toBe("RED");
    expect(result.details).toMatchObject({ engaged: false, phase: null });
  });

  it("stays dormant for project scaffolding before a test harness exists", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-4",
      { reason: "scaffold a new link shortener project" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(machine.phase).toBe("RED");
    expect(result.details).toMatchObject({ engaged: false, phase: null });
    expect(result.content[0]?.text).toContain("project can host a failing test");
  });

  it("stays dormant for feature work until a runnable test harness exists", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));
    const project = mkdtempSync(join(tmpdir(), "pi-tdd-node-project-"));
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "app", private: true, scripts: { dev: "vite" } }, null, 2)
    );

    const result = await tool.execute(
      "call-5",
      { reason: "implement link creation flow" },
      undefined,
      undefined,
      makeContext({ cwd: project })
    );

    expect(machine.enabled).toBe(false);
    expect(result.details).toMatchObject({ engaged: false, phase: null });
    expect(result.content[0]?.text).toContain("runnable test harness");
    expect(result.content[0]?.text).toContain("call tdd_start again");
  });
});

describe("createDisengageTool", () => {
  it("disengages an engaged machine", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    const tool = createDisengageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-3",
      { reason: "feature complete" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(result.details).toMatchObject({ engaged: false });
  });

  it("marks the current spec item complete when postflight succeeds during disengage", async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      stopReason: "stop",
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          reason: "the completed cycle delivered the requested behavior",
        }),
      }],
    } as never);

    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "REFACTOR",
      plan: ["first slice", "second slice"],
      proofCheckpoint: {
        itemIndex: 1,
        item: "first slice",
        seam: "business_http",
        command: "npm run test:integration",
        commandFamily: "npm:test:integration",
        level: "integration",
        testFiles: ["src/routes/api/links/+server.test.ts"],
        mutationCountAtCapture: 1,
      },
    });
    machine.recordTestResult("1 passed", false, "npm run test:integration", "integration");
    const tool = createDisengageTool(makeDeps(machine, makeConfig()));

    await tool.execute(
      "call-4",
      { reason: "feature complete" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.planCompleted).toBe(1);
    expect(machine.enabled).toBe(false);
  });

  it("keeps TDD engaged when the current RED item has not produced a failing proof yet", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "RED",
      plan: ["POST /api/links returns 400 for invalid URLs"],
    });
    const tool = createDisengageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-5",
      { reason: "feature complete" },
      undefined,
      undefined,
      makeContext({ hasUI: true, ui: { notify: vi.fn(), setStatus: vi.fn() } })
    );

    expect(machine.enabled).toBe(true);
    expect(result.details).toMatchObject({ engaged: true, phase: "RED" });
    expect(result.content[0]?.text).toContain("RED has not started cleanly");
    expect(result.content[0]?.text).toContain("Use `/tdd off` only if you intentionally want to abandon the cycle");
  });
});

describe("/tdd command surface", () => {
  it("does not treat removed phase commands as manual transitions", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC", plan: ["criterion"] });
    const publish = vi.fn();

    await handleTddCommand("red", machine, makeContext(), publish, makeConfig());

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(machine.getHistory()).toHaveLength(0);
    expect(publish).toHaveBeenCalledWith(expect.stringContaining("Legacy `/tdd red` was removed."));
  });

  it("/tdd off still turns off an engaged machine", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "RED" });

    await handleTddCommand("off", machine, makeContext(), vi.fn(), makeConfig());

    expect(machine.enabled).toBe(false);
  });

  it("advances the completed spec count when re-entering RED from REFACTOR", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "REFACTOR",
      plan: ["first slice", "second slice"],
    });
    const tool = createEngageTool(makeDeps(machine, makeConfig({ runPreflightOnRed: false })));

    await tool.execute(
      "call-5",
      { phase: "RED", reason: "continue to the next spec item" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.planCompleted).toBe(1);
    expect(machine.phase).toBe("RED");
  });
});

describe("buildSystemPrompt for dormant state", () => {
  it("returns the dormant prompt when machine is dormant and config is enabled", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(machine, makeConfig());
    expect(prompt).toContain("[TDD MODE - dormant]");
    expect(prompt).toContain("runnable test command");
    expect(prompt).toContain("repository scaffolding");
    expect(prompt).toContain("call `tdd_start` immediately");
    expect(prompt).toContain("tdd_refine_feature_spec");
  });

  it("returns the disabled prompt when config disables TDD entirely", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(machine, makeConfig({ enabled: false }));
    expect(prompt).toContain("[TDD MODE - DISABLED]");
  });

  it("lists configured engageOnTools in the dormant prompt", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(
      machine,
      makeConfig({ engageOnTools: ["mcp__manifest__start_feature"] })
    );
    expect(prompt).toContain("mcp__manifest__start_feature");
  });

  it("returns the engaged phase prompt once TDD is engaged", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "RED" });
    const prompt = buildSystemPrompt(machine, makeConfig());
    expect(prompt).toContain("[TDD MODE - Phase: RED]");
  });
});
