import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PhaseStateMachine } from "../src/phase.ts";
import { createRefineFeatureSpecTool } from "../src/spec-tools.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { EngagementDeps } from "../src/engagement.ts";
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

function makeContext(cwd = process.cwd()) {
  return {
    cwd,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    hasUI: false,
  } as never;
}

function makeDeps(machine: PhaseStateMachine, config: TDDConfig): EngagementDeps {
  return {
    pi: { appendEntry: vi.fn() } as never,
    machine,
    getConfig: () => config,
  };
}

describe("createRefineFeatureSpecTool", () => {
  it("stores the checklist and returns the formatted spec", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC" });
    const tool = createRefineFeatureSpecTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-1",
      { items: ["creates a short link", "redirects by slug"] },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.plan).toEqual(["creates a short link", "redirects by slug"]);
    expect(machine.requestedSeam).toBe("business_http");
    expect(result.details).toMatchObject({ ok: true, count: 2, phase: "SPEC" });
    expect(result.content[0]?.text).toContain("Feature spec (0/2 completed):");
  });

  it("replaces an existing checklist", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "SPEC",
      plan: ["old item"],
      planCompleted: 1,
    });
    const tool = createRefineFeatureSpecTool(makeDeps(machine, makeConfig()));

    await tool.execute(
      "call-2",
      { items: ["new item"] },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.plan).toEqual(["new item"]);
    expect(machine.planCompleted).toBe(0);
  });

  it("rejects an empty checklist", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC", plan: ["keep me"] });
    const tool = createRefineFeatureSpecTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-3",
      { items: ["   "] },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.plan).toEqual(["keep me"]);
    expect(result.details).toMatchObject({ ok: false, count: 1, phase: "SPEC" });
    expect(result.content[0]?.text).toContain("call tdd_refine_feature_spec again");
  });

  it("auto-engages SPEC from dormant state when a runnable harness exists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-spec-tool-"));
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { test: "vitest run" },
      })
    );
    const machine = new PhaseStateMachine();
    const tool = createRefineFeatureSpecTool(makeDeps(machine, makeConfig()));

    await tool.execute(
      "call-4",
      { items: ["creates a short link"] },
      undefined,
      undefined,
      makeContext(cwd)
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(machine.plan).toEqual(["creates a short link"]);
  });

  it("stores the checklist but stays dormant when the repo cannot run tests yet", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-spec-tool-"));
    const machine = new PhaseStateMachine();
    const tool = createRefineFeatureSpecTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-5",
      { items: ["creates a short link"] },
      undefined,
      undefined,
      makeContext(cwd)
    );

    expect(machine.enabled).toBe(false);
    expect(machine.phase).toBe("RED");
    expect(machine.plan).toEqual(["creates a short link"]);
    expect(result.content[0]?.text).toContain("TDD stays dormant until the repository has a runnable test harness");
  });
});
