import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleTddCommand, splitCommandArgs } from "../src/commands.ts";
import { PhaseStateMachine } from "../src/phase.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

function createCommandContext(cwd = process.cwd()) {
  return {
    cwd,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  } as never;
}

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
    defaultStarted: false,
    runPreflightOnRed: true,
    startOnTools: [],
    endOnTools: [],
    guidelines: resolveGuidelines({}),
    ...overrides,
  };
}

describe("splitCommandArgs", () => {
  it("handles quoted and unquoted segments", () => {
    expect(splitCommandArgs('"a b" c')).toEqual(["a b", "c"]);
  });

  it("handles escaped spaces", () => {
    expect(splitCommandArgs(String.raw`a\ b c`)).toEqual(["a b", "c"]);
  });
});

describe("handleTddCommand", () => {
  it("uses /tdd <request> as the primary way to enter SPEC", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-command-"));
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { test: "vitest run" },
      })
    );
    const machine = new PhaseStateMachine();
    const publish = vi.fn();

    await handleTddCommand(
      "fix slug validation when the custom slug is reserved",
      machine,
      createCommandContext(cwd),
      publish,
      makeConfig()
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(machine.requestedSeam).toBe("business_domain");
    expect(publish).toHaveBeenCalledWith(
      expect.stringContaining("TDD started for: fix slug validation when the custom slug is reserved")
    );
  });

  it("keeps /tdd <request> dormant for scaffolding requests", async () => {
    const machine = new PhaseStateMachine();
    const publish = vi.fn();

    await handleTddCommand(
      "scaffold a new SvelteKit app",
      machine,
      createCommandContext(),
      publish,
      makeConfig()
    );

    expect(machine.enabled).toBe(false);
    expect(publish).toHaveBeenCalledWith(expect.stringContaining("TDD stays dormant for scaffolding"));
  });

  it("starts TDD on /tdd on", async () => {
    const machine = new PhaseStateMachine();
    const publish = vi.fn();

    await handleTddCommand("on", machine, createCommandContext(), publish, makeConfig());

    expect(machine.enabled).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.stringContaining("TDD started."));
  });

  it("ends TDD on /tdd off", async () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "RED",
      plan: ["POST /api/links returns 400 for invalid URLs"],
    });
    const publish = vi.fn();

    await handleTddCommand("off", machine, createCommandContext(), publish, makeConfig());

    expect(machine.enabled).toBe(false);
    expect(publish).toHaveBeenCalledWith(expect.stringContaining("TDD ended."));
  });

  it("rejects legacy admin subcommands without mutating state", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "SPEC", plan: ["first criterion"] });
    const publish = vi.fn();

    await handleTddCommand("red", machine, createCommandContext(), publish, makeConfig());

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(machine.getHistory()).toHaveLength(0);
    expect(publish).toHaveBeenCalledWith(
      expect.stringContaining("Legacy `/tdd red` was removed.")
    );
  });

  it("maps legacy engage/disengage verbs to deprecation guidance (pointing to /tdd on|off)", async () => {
    const publish = vi.fn();

    await handleTddCommand("engage", new PhaseStateMachine(), createCommandContext(), publish, makeConfig());
    expect(publish).toHaveBeenLastCalledWith(expect.stringContaining("Use `/tdd on`"));

    await handleTddCommand("disengage", new PhaseStateMachine(), createCommandContext(), publish, makeConfig());
    expect(publish).toHaveBeenLastCalledWith(expect.stringContaining("Use `/tdd off`"));
  });

  it("shows the simplified help text when /tdd is invoked without arguments", async () => {
    const publish = vi.fn();

    await handleTddCommand("", new PhaseStateMachine(), createCommandContext(), publish, makeConfig());

    expect(publish).toHaveBeenCalledWith(expect.stringContaining("Usage: /tdd on | off | <feature-or-bug request>"));
  });
});
