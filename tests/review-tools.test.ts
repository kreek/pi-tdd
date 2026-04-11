import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@mariozechner/pi-ai";
import { PhaseStateMachine } from "../src/phase.ts";
import { createPreflightTool } from "../src/review-tools.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { EngagementDeps } from "../src/engagement.ts";
import type { TDDConfig } from "../src/types.ts";

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    complete: vi.fn(),
  };
});

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

function makeContext(cwd: string) {
  return {
    cwd,
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("createPreflightTool", () => {
  it("auto-engages SPEC from dormant state when RED readiness runs in a repo with tests", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-preflight-tool-"));
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { test: "vitest run" },
      })
    );
    vi.mocked(complete).mockResolvedValue({
      stopReason: "stop",
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          reason: "the checklist is concrete enough to start RED",
        }),
      }],
    } as never);

    const machine = new PhaseStateMachine({
      plan: ["Creating a short link returns a slug the client can reuse."],
    });
    const tool = createPreflightTool(makeDeps(machine, makeConfig()));

    await tool.execute("call-1", {}, undefined, undefined, makeContext(cwd));

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(machine.requestedSeam).toBe("business_domain");
  });

  it("keeps TDD dormant when RED readiness is inspected before the harness exists", async () => {
    vi.mocked(complete).mockResolvedValue({
      stopReason: "stop",
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          reason: "the checklist is concrete enough to start RED once tests exist",
        }),
      }],
    } as never);

    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-preflight-tool-"));
    const machine = new PhaseStateMachine({
      plan: ["Creating a short link returns a slug the client can reuse."],
    });
    const tool = createPreflightTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute("call-2", {}, undefined, undefined, makeContext(cwd));

    expect(machine.enabled).toBe(false);
    expect(machine.phase).toBe("RED");
    expect(result.content[0]?.text).toContain("TDD stays dormant until the repository has a runnable test harness");
  });
});
