import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DebugRunLogger,
  summarizeToolCall,
} from "../src/debug-run-log.ts";

const ORIGINAL_DEBUG_RUNS = process.env.PI_TDD_DEBUG_RUNS;
const ORIGINAL_DEBUG_RUNS_DIR = process.env.PI_TDD_DEBUG_RUNS_DIR;

function readLogLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

afterEach(() => {
  if (ORIGINAL_DEBUG_RUNS === undefined) {
    delete process.env.PI_TDD_DEBUG_RUNS;
  } else {
    process.env.PI_TDD_DEBUG_RUNS = ORIGINAL_DEBUG_RUNS;
  }

  if (ORIGINAL_DEBUG_RUNS_DIR === undefined) {
    delete process.env.PI_TDD_DEBUG_RUNS_DIR;
  } else {
    process.env.PI_TDD_DEBUG_RUNS_DIR = ORIGINAL_DEBUG_RUNS_DIR;
  }
});

describe("DebugRunLogger", () => {
  it("creates a jsonl run log and appends events when enabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-run-log-"));
    const logger = new DebugRunLogger();
    process.env.PI_TDD_DEBUG_RUNS = "1";

    const logPath = logger.start({
      cwd,
      sessionFile: "/tmp/session.json",
      reason: "new",
      config: {
        enabled: true,
        defaultEngaged: false,
        runPreflightOnRed: true,
        reviewProvider: null,
        reviewModel: null,
        reviewOverrides: [],
        engageOnTools: [],
        disengageOnTools: [],
      },
      state: {
        enabled: false,
        phase: "RED",
        cycleCount: 0,
        planCount: 0,
        planCompleted: 0,
        currentSpecItem: null,
        lastTestFailed: null,
        lastTestCommand: null,
        diffCount: 0,
        diffs: [],
        mutationCount: 0,
        recentTestCount: 0,
        proofCheckpoint: null,
      },
    });
    logger.emit({ type: "checkpoint", step: "after-start" });

    await vi.waitFor(() => {
      expect(logPath).toBeTruthy();
      expect(readLogLines(logPath!)).toHaveLength(2);
    });

    const [first, second] = readLogLines(logPath!).map((line) => JSON.parse(line));
    expect(logPath).toContain(join(".pi-tdd", "runs"));
    expect(first.type).toBe("run_start");
    expect(first.cwd).toBe(cwd);
    expect(second.type).toBe("checkpoint");
    logger.stop();
  });

  it("stays dormant when debug logging is disabled", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-tdd-run-log-"));
    const logger = new DebugRunLogger();

    const logPath = logger.start({
      cwd,
      sessionFile: "/tmp/session.json",
      reason: "new",
      config: {
        enabled: true,
        defaultEngaged: false,
        runPreflightOnRed: true,
        reviewProvider: null,
        reviewModel: null,
        reviewOverrides: [],
        engageOnTools: [],
        disengageOnTools: [],
      },
      state: {
        enabled: false,
        phase: "RED",
        cycleCount: 0,
        planCount: 0,
        planCompleted: 0,
        currentSpecItem: null,
        lastTestFailed: null,
        lastTestCommand: null,
        diffCount: 0,
        diffs: [],
        mutationCount: 0,
        recentTestCount: 0,
        proofCheckpoint: null,
      },
    });

    expect(logPath).toBeNull();
  });

  it("summarizes mutating tool calls without leaking full content", () => {
    const summary = summarizeToolCall({
      toolName: "write",
      toolCallId: "call-1",
      input: { path: "src/app.ts", content: "super secret file body" },
      type: "tool_call",
    } as never);

    expect(summary.input).toEqual({
      path: "src/app.ts",
      contentChars: 22,
    });
  });
});
