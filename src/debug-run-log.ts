import {
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";
import type { ToolCallEvent, ToolCallEventResult, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import type { TDDConfig, PhaseState, TestSignal } from "./types.js";
import { seamShortLabel } from "./seams.js";

const DEBUG_RUNS_ENV = "PI_TDD_DEBUG_RUNS";
const DEBUG_RUNS_DIR_ENV = "PI_TDD_DEBUG_RUNS_DIR";
const PREVIEW_LIMIT = 240;
const PROMPT_PREVIEW_LIMIT = 1600;

export interface DebugRunEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface DebugRunStart {
  cwd: string;
  sessionFile: string;
  reason: string;
  previousSessionFile?: string;
  config: ReturnType<typeof summarizeConfig>;
  state: ReturnType<typeof summarizeState>;
}

export class DebugRunLogger {
  private stream: WriteStream | null = null;
  private logPath: string | null = null;

  start(run: DebugRunStart): string | null {
    if (!debugRunLoggingEnabled()) {
      this.stop();
      return null;
    }

    this.stop();
    const runsDir = resolveRunsDir(run.cwd);
    ensureDir(runsDir);
    this.logPath = join(runsDir, `${timestampStamp()}.jsonl`);
    writeFileSync(this.logPath, "");
    const fd = openSync(this.logPath, "a");
    this.stream = createWriteStream(this.logPath, { fd, flags: "a" });
    this.emit({ type: "run_start", ...run });
    return this.logPath;
  }

  stop(): void {
    this.stream?.end();
    this.stream = null;
    this.logPath = null;
  }

  emit(event: Omit<DebugRunEvent, "timestamp">): void {
    if (!this.stream) {
      return;
    }

    const payload = { timestamp: Date.now(), ...event };
    this.stream.write(`${JSON.stringify(payload)}\n`);
  }

  get runLogPath(): string | null {
    return this.logPath;
  }
}

export const debugRunLogger = new DebugRunLogger();

export function logDebugRunEvent(event: Omit<DebugRunEvent, "timestamp">): void {
  debugRunLogger.emit(event);
}

export function summarizeConfig(config: TDDConfig) {
  return {
    enabled: config.enabled,
    defaultEngaged: config.defaultEngaged,
    runPreflightOnRed: config.runPreflightOnRed,
    reviewProvider: config.reviewProvider,
    reviewModel: config.reviewModel,
    reviewOverrides: Object.keys(config.reviewModels),
    engageOnTools: [...config.engageOnTools],
    disengageOnTools: [...config.disengageOnTools],
  };
}

export function summarizeState(state: Readonly<PhaseState>) {
  const lastTest = state.recentTests[state.recentTests.length - 1] ?? null;
  return {
    enabled: state.enabled,
    phase: state.phase,
    cycleCount: state.cycleCount,
    planCount: state.plan.length,
    planCompleted: state.planCompleted,
    currentSpecItem: state.plan[state.planCompleted] ?? null,
    requestedSeam: state.requestedSeam,
    lastTestFailed: state.lastTestFailed,
    lastTestCommand: lastTest?.command ?? null,
    diffCount: state.diffs.length,
    diffs: state.diffs.slice(-5),
    mutationCount: state.mutations.length,
    recentTestCount: state.recentTests.length,
    proofCheckpoint: state.proofCheckpoint
      ? {
          itemIndex: state.proofCheckpoint.itemIndex,
          item: state.proofCheckpoint.item,
          seam: state.proofCheckpoint.seam,
          seamLabel: seamShortLabel(state.proofCheckpoint.seam),
          command: truncate(state.proofCheckpoint.command, PREVIEW_LIMIT),
          level: state.proofCheckpoint.level,
          testFiles: state.proofCheckpoint.testFiles.slice(0, 8),
        }
      : null,
  };
}

export function summarizeToolCall(event: ToolCallEvent) {
  const input = event.input as Record<string, unknown>;
  return {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    input: summarizeToolPayload(event.toolName, input),
  };
}

export function summarizeToolResult(event: ToolResultEvent) {
  const texts = event.content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && !!item.text)
    .map((item) => item.text);
  const preview = captureText(texts.join("\n"), PREVIEW_LIMIT);
  const bashDetails =
    event.toolName === "bash" && "details" in event
      ? event.details
      : undefined;
  return {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    isError: event.isError,
    input: summarizeToolPayload(event.toolName, event.input),
    text: preview,
    contentTypes: event.content.map((item) => item.type),
    details:
      bashDetails
        ? {
            fullOutputPath: typeof bashDetails.fullOutputPath === "string"
              ? bashDetails.fullOutputPath
              : undefined,
            truncation: bashDetails.truncation ?? null,
          }
        : undefined,
  };
}

export function summarizeTestSignal(signal: TestSignal) {
  return {
    command: truncate(signal.command, PREVIEW_LIMIT),
    failed: signal.failed,
    level: signal.level,
    output: captureText(signal.output, PREVIEW_LIMIT),
  };
}

export function summarizeGateResult(result: ToolCallEventResult | void) {
  return {
    blocked: Boolean(result?.block),
    reason: result?.reason ?? null,
  };
}

export function captureText(text: string, max = PROMPT_PREVIEW_LIMIT) {
  return {
    chars: text.length,
    truncated: text.length > max,
    preview: truncate(text, max),
  };
}

export function captureExactText(text: string) {
  return {
    chars: text.length,
    text,
  };
}

export function debugRunLoggingEnabled(): boolean {
  const raw = process.env[DEBUG_RUNS_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function resolveRunsDir(cwd: string): string {
  const override = process.env[DEBUG_RUNS_DIR_ENV]?.trim();
  return override ? override : join(cwd, ".pi-tdd", "runs");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function summarizeToolPayload(toolName: string, input: Record<string, unknown>) {
  if (toolName === "bash") {
    return {
      command: truncate(String(input.command ?? ""), PREVIEW_LIMIT),
      timeout: typeof input.timeout === "number" ? input.timeout : undefined,
    };
  }

  if (toolName === "read") {
    return {
      path: stringValue(input.path),
      offset: numericValue(input.offset),
      limit: numericValue(input.limit),
    };
  }

  if (toolName === "write") {
    return {
      path: stringValue(input.path),
      contentChars: typeof input.content === "string" ? input.content.length : 0,
    };
  }

  if (toolName === "edit") {
    return {
      path: stringValue(input.path),
      oldTextChars: typeof input.oldText === "string" ? input.oldText.length : 0,
      newTextChars: typeof input.newText === "string" ? input.newText.length : 0,
      replaceAll: Boolean(input.replaceAll),
    };
  }

  return summarizeUnknownPayload(input);
}

function summarizeUnknownPayload(input: Record<string, unknown>) {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      summary[key] = truncate(value, PREVIEW_LIMIT);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      summary[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = { type: "array", length: value.length };
      continue;
    }
    if (typeof value === "object") {
      summary[key] = { type: "object", keys: Object.keys(value as Record<string, unknown>) };
    }
  }
  return summary;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function timestampStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
