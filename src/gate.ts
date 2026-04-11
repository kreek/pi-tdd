import { isToolCallEventType, type ExtensionContext, type ToolCallEvent, type ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { isTestCommand } from "./transition.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const BUILTIN_MUTATING_TOOLS = new Set(["write", "edit", "bash"]);
const READ_ONLY_BASH_COMMANDS = new Set([
  "cat",
  "find",
  "git",
  "grep",
  "head",
  "ls",
  "pwd",
  "realpath",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "tree",
  "wc",
  "which",
]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set(["branch", "diff", "grep", "log", "rev-parse", "show", "status"]);
const FIND_MUTATION_FLAGS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]);
const MAX_DIFFS = 5;

/**
 * The gate enforces exactly one deterministic rule: SPEC blocks file mutations
 * (write/edit/mutating bash) so the spec gets finalised before any code lands.
 * Read-only inspection and test commands stay allowed. In every
 * other phase the gate is a passthrough that only records diffs into the phase
 * state for downstream review (preflight/postflight) context.
 *
 * There is no per-tool-call LLM judging. The system prompt steers the agent
 * during the cycle and test signals drive transitions; review LLM calls only
 * fire at cycle boundaries (preflight before, postflight after) — never during.
 */
export async function gateSingleToolCall(
  event: ToolCallEvent,
  machine: PhaseStateMachine,
  config: TDDConfig,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | void> {
  if (!config.enabled || !machine.enabled) {
    return undefined;
  }

  if (READ_ONLY_TOOLS.has(event.toolName)) {
    return undefined;
  }

  if (isToolCallEventType("bash", event) && bashAllowedInSpec(event.input.command, machine.phase)) {
    trackToolCall(machine, event);
    return undefined;
  }

  if (machine.phase === "SPEC" && BUILTIN_MUTATING_TOOLS.has(event.toolName)) {
    const blocked = await handleSpecBlock(event, ctx);
    if (blocked) {
      return blocked;
    }
    trackToolCall(machine, event);
    return undefined;
  }

  // RED / GREEN / REFACTOR: passthrough. Just record the diff for review
  // context. The system prompt steers the agent and the test signal drives
  // phase transitions — no LLM judging here.
  trackToolCall(machine, event);
  return undefined;
}

async function handleSpecBlock(
  event: ToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | undefined> {
  if (ctx.hasUI) {
    ctx.ui.notify(
      "SPEC is read-only for changes. Inspection is fine, but file edits and mutating shell commands stay blocked until RED.",
      "info"
    );
  }

  const override = await confirmOverride(
    ctx,
    "SPEC is read-only",
    `SPEC blocks ${event.toolName}. Enter RED with tdd_start(phase: 'RED') instead of overriding. RED entry will review and sharpen the checklist if needed. Override and allow it anyway?`
  );

  return override
    ? undefined
    : {
        block: true,
        reason: "SPEC phase blocks file changes and mutating shell commands until the test specification is ready.",
      };
}

async function confirmOverride(
  ctx: ExtensionContext,
  title: string,
  message: string
): Promise<boolean> {
  if (!ctx.hasUI) {
    return false;
  }

  return ctx.ui.confirm(title, message, { signal: ctx.signal });
}

function summarizeDiff(event: ToolCallEvent): string {
  const parts = [event.toolName];
  const input = event.input as Record<string, unknown>;

  if (typeof input.path === "string") {
    parts.push(input.path);
  }
  if (typeof input.command === "string") {
    parts.push(truncate(input.command, 120));
  }

  return parts.join(" | ");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function trackToolCall(machine: PhaseStateMachine, event: ToolCallEvent): void {
  machine.addDiff(summarizeDiff(event), MAX_DIFFS);
  if (!BUILTIN_MUTATING_TOOLS.has(event.toolName)) {
    return;
  }

  const input = event.input as Record<string, unknown>;
  machine.recordMutation(
    event.toolName,
    typeof input.path === "string" ? input.path : undefined,
    typeof input.command === "string" ? input.command : undefined
  );
}

function bashAllowedInSpec(command: string, phase: PhaseStateMachine["phase"]): boolean {
  if (isTestCommand(command)) {
    return true;
  }

  if (phase !== "SPEC") {
    return false;
  }

  return isReadOnlyBashCommand(command);
}

function isReadOnlyBashCommand(command: string): boolean {
  if (containsUnsupportedShellFeature(command)) {
    return false;
  }

  return splitCommandSegments(command).every(isReadOnlySegment);
}

function containsUnsupportedShellFeature(command: string): boolean {
  return /(?:^|[^\\])[><`]/.test(command) || /\$\(/.test(command);
}

function splitCommandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||\||;/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isReadOnlySegment(segment: string): boolean {
  const tokens = tokenizeSegment(segment);
  if (tokens.length === 0) {
    return false;
  }

  const commandIndex = tokens.findIndex((token) => !isEnvAssignment(token));
  if (commandIndex === -1) {
    return false;
  }

  const command = tokens[commandIndex];
  const args = tokens.slice(commandIndex + 1);

  if (!READ_ONLY_BASH_COMMANDS.has(command)) {
    return false;
  }

  if (command === "git") {
    return args.length > 0 && READ_ONLY_GIT_SUBCOMMANDS.has(args[0]);
  }

  if (command === "find") {
    return !args.some((arg) => FIND_MUTATION_FLAGS.has(arg));
  }

  return true;
}

function tokenizeSegment(segment: string): string[] {
  return segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}
