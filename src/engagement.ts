import { Type } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { PhaseStateMachine } from "./phase.js";
import { persistState } from "./persistence.js";
import { shouldRunPreflightOnRedEntry } from "./preflight.js";
import { formatPostflightResult, runPostflight, type PostflightResult } from "./postflight.js";
import { loadPromptList } from "./prompt-loader.js";
import { formatRedReadinessResult, runRedReadinessCheck } from "./red-readiness.js";
import { classifyRequestedSeam } from "./seams.js";
import { POSTFLIGHT_TOOL_NAME, PREFLIGHT_TOOL_NAME } from "./review-tools.js";
import { REFINE_FEATURE_SPEC_TOOL_NAME } from "./spec-tools.js";
import { hasRunnableTestHarness } from "./test-harness.js";
import { isTestCommand } from "./transition.js";
import type { TDDConfig, TDDPhase } from "./types.js";

const STATUS_KEY = "tdd-gate";
const START_PROMPT_SNIPPET = "Start TDD enforcement before beginning a feature or bug fix.";
const START_PROMPT_GUIDELINES = loadPromptList("tool-start-guidelines");
const END_PROMPT_SNIPPET = "End TDD enforcement when leaving feature work.";
const END_PROMPT_GUIDELINES = loadPromptList("tool-end-guidelines");
const BOOTSTRAP_REASON_PATTERNS = [
  /\bscaffold(?:ing)?\b/i,
  /\bbootstrap(?:ping)?\b/i,
  /\b(?:initialize|initialise|init|create|generate)\s+(?:a\s+)?(?:new\s+)?(?:project|repo(?:sitory)?|app|service|package)\b/i,
  /\b(?:project|repo(?:sitory)?|app)\s+(?:setup|set-up|scaffolding|bootstrapping)\b/i,
  /\b(?:set\s+up|setup|install|wire\s+up)\s+(?:the\s+)?(?:test(?:ing)?\s+(?:framework|runner|harness)|vitest|jest|pytest|rspec|mocha|playwright|cypress)\b/i,
];

export const START_TOOL_NAME = "tdd_start";
export const END_TOOL_NAME = "tdd_stop";

const CONTROL_TOOL_NAMES = new Set([
  START_TOOL_NAME,
  END_TOOL_NAME,
  PREFLIGHT_TOOL_NAME,
  POSTFLIGHT_TOOL_NAME,
  REFINE_FEATURE_SPEC_TOOL_NAME,
]);

export interface LifecycleDeps {
  pi: ExtensionAPI;
  machine: PhaseStateMachine;
  getConfig: () => TDDConfig;
}

interface StartParams {
  phase?: string;
  reason: string;
}

interface EndParams {
  reason: string;
}

interface LifecycleDetails {
  engaged: boolean;
  phase: TDDPhase | null;
  reason: string;
  /** Populated by tdd_stop when postflight ran. Null otherwise. */
  postflight?: PostflightResult | null;
}

function normalizePhase(value: string | undefined): TDDPhase | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "SPEC" || normalized === "RED" || normalized === "GREEN" || normalized === "REFACTOR") {
    return normalized;
  }
  if (normalized === "PLAN") return "SPEC";
  return null;
}

function persist(deps: LifecycleDeps): void {
  persistState(deps.pi, deps.machine);
}

export interface PostflightOnEndOutcome {
  /** Postflight result if it ran, otherwise null. */
  result: PostflightResult | null;
  /** Human-readable summary suitable for surfacing to the agent/user. Null if postflight did not run. */
  summary: string | null;
}

interface StartPreflightOutcome {
  allowed: boolean;
  text?: string;
  refinedSpec?: string[];
  refined?: boolean;
}

export function isBootstrapWorkReason(reason: string): boolean {
  return BOOTSTRAP_REASON_PATTERNS.some((pattern) => pattern.test(reason));
}

/**
 * Postflight runs on end only when there is real evidence the cycle
 * actually delivered something to review: TDD was started, a spec was set,
 * AND the most recent test run actually passed (with output captured). A
 * `null` lastTestFailed — meaning no test signal has been observed during
 * this session — is NOT eligible: postflight against zero evidence would
 * waste an LLM call and risk false confidence.
 */
function isEligibleForPostflightOnEnd(machine: PhaseStateMachine): boolean {
  return (
    machine.enabled &&
    machine.plan.length > 0 &&
    machine.lastTestFailed === false &&
    machine.lastTestOutput !== null
  );
}

/**
 * Shared helper for the three end paths (tdd_stop tool, /tdd off
 * command, endOnTools lifecycle hook). Runs postflight when
 * eligible, emits the appropriate UI notification, and returns both the
 * structured result and a formatted summary string. Errors are caught and
 * surfaced as a summary — postflight failure NEVER blocks ending TDD.
 */
export async function maybeRunPostflightOnEnd(
  machine: PhaseStateMachine,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<PostflightOnEndOutcome> {
  if (!isEligibleForPostflightOnEnd(machine)) {
    return { result: null, summary: null };
  }

  try {
    const result = await runPostflight({ state: machine.getSnapshot() }, ctx, config);
    const summary = formatPostflightResult(result);
    if (ctx.hasUI) {
      ctx.ui.notify(
        result.ok
          ? "TDD post-flight: OK"
          : `TDD post-flight: ${result.gaps.length} gap(s)`,
        result.ok ? "info" : "warning"
      );
    }
    return { result, summary };
  } catch (error) {
    const errorReason = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) {
      ctx.ui.notify(`Post-flight failed: ${errorReason}`, "warning");
    }
    return { result: null, summary: `Post-flight failed to run: ${errorReason}` };
  }
}

async function runStartPreflightGate(
  machine: PhaseStateMachine,
  phase: TDDPhase,
  reason: string,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<StartPreflightOutcome> {
  if (!shouldRunPreflightOnRedEntry(machine.phase, machine.enabled, phase, config)) {
    return { allowed: true };
  }

  try {
    const result = await runRedReadinessCheck(
      { spec: machine.plan, userStory: reason, planCompleted: machine.planCompleted },
      ctx,
      config
    );
    if (result.refinedSpec) {
      machine.setPlan(result.refinedSpec);
    }
    if (result.ok) {
      return {
        allowed: true,
        refinedSpec: result.refinedSpec ?? undefined,
        refined: result.refined,
      };
    }

    const summary = formatRedReadinessResult(result);
    if (ctx.hasUI) {
      ctx.ui.notify(
        result.refined
          ? "RED readiness refined the spec, but it still needs clarification."
          : `RED readiness suggests ${redReadinessIssueCount(result)} refinement(s)`,
        "info"
      );
    }
    return {
      allowed: false,
      refinedSpec: result.refinedSpec ?? undefined,
      refined: result.refined,
      text: blockedRedReadinessText(result, machine, summary),
    };
  } catch (error) {
    const errorReason = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) {
      ctx.ui.notify(`RED readiness failed: ${errorReason}`, "warning");
    }
    return {
      allowed: false,
      text: `RED readiness failed to run: ${errorReason}. Entry into RED blocked. Resolve the review model error and retry.`,
    };
  }
}

export function createStartTool(
  deps: LifecycleDeps
): ToolDefinition<ReturnType<typeof Type.Object>, LifecycleDetails, StartParams> {
  return {
    name: START_TOOL_NAME,
    label: "Start TDD",
    description:
      "Start the TDD phase gate for feature or bug-fix work. Call this at the start of any work that introduces, modifies, or fixes user-visible behavior. " +
      "First verify the repository can run a meaningful failing test. If the test harness is missing, stay dormant and set it up or ask the user to confirm the framework choice. " +
      "Pass phase='SPEC' when the request still needs to be translated into testable acceptance criteria, or phase='RED' when criteria are already clear enough to write the first failing test. Defaults to SPEC.",
    promptSnippet: START_PROMPT_SNIPPET,
    promptGuidelines: START_PROMPT_GUIDELINES,
    parameters: Type.Object({
      phase: Type.Optional(
        Type.String({
          description: "TDD phase to start in: SPEC (default) or RED",
        })
      ),
      reason: Type.String({
        description: "Short description of the feature or bug being worked on",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;
      if (!config.enabled) {
        return disabledStartResponse(machine, ctx);
      }

      const phase = normalizePhase(params.phase) ?? "SPEC";
      const reason = String(params.reason ?? "feature/bug work");
      if (!machine.enabled && isBootstrapWorkReason(reason)) {
        return bootstrapStartResponse(machine, ctx, reason);
      }
      if (!machine.enabled && !hasRunnableTestHarness(ctx.cwd)) {
        return missingHarnessStartResponse(machine, ctx, reason);
      }
      return startMachine(deps, ctx, phase, reason, `tdd_start: ${reason}`);
    },
  };
}

export function createEndTool(
  deps: LifecycleDeps
): ToolDefinition<ReturnType<typeof Type.Object>, LifecycleDetails, EndParams> {
  return {
    name: END_TOOL_NAME,
    label: "End TDD",
    description:
      "End the TDD phase gate when leaving feature or bug-fix work. Call this when switching to investigation, navigation, code review, or any non-feature task so subsequent tool calls are not judged against TDD phase rules.",
    promptSnippet: END_PROMPT_SNIPPET,
    promptGuidelines: END_PROMPT_GUIDELINES,
    parameters: Type.Object({
      reason: Type.String({
        description: "Brief reason for ending (e.g. 'feature complete', 'switching to investigation')",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const machine = deps.machine;
      const config = deps.getConfig();
      const reason = String(params.reason ?? "leaving feature work");
      return endMachine(deps, ctx, config, reason);
    },
  };
}

/**
 * Apply configured lifecycle hooks for an incoming tool call. Returns true if
 * the tool call is itself one of the lifecycle control tools (so callers can
 * skip the regular gate).
 *
 * Async because the end branch runs postflight before flipping the
 * machine off — we want lifecycle hooks (e.g. mcp__manifest__complete_feature)
 * to honour the same proving step as tdd_stop and /tdd off.
 */
export async function applyLifecycleHooks(
  toolName: string,
  deps: LifecycleDeps,
  ctx: ExtensionContext
): Promise<{ isControlTool: boolean; engaged?: boolean; disengaged?: boolean }> {
  if (CONTROL_TOOL_NAMES.has(toolName)) {
    return { isControlTool: true };
  }

  const config = deps.getConfig();
  const machine = deps.machine;

  if (!config.enabled) {
    return { isControlTool: false };
  }

  if (config.startOnTools.includes(toolName) && !machine.enabled) {
    if (!hasRunnableTestHarness(ctx.cwd)) {
      return { isControlTool: false };
    }

    const result = await startMachine(
      deps,
      ctx,
      "RED",
      `lifecycle hook: ${toolName}`,
      `lifecycle hook: ${toolName}`,
      { viaToolName: toolName }
    );
    if (result.details.engaged) {
      return { isControlTool: false, engaged: true };
    }
    return { isControlTool: false };
  }

  if (config.endOnTools.includes(toolName) && machine.enabled) {
    const result = await endMachine(deps, ctx, config, `via ${toolName}`);
    return { isControlTool: false, disengaged: !result.details.engaged };
  }

  return { isControlTool: false };
}

function disabledStartResponse(
  machine: PhaseStateMachine,
  ctx: ExtensionContext
) {
  machine.enabled = false;
  ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
  if (ctx.hasUI) {
    ctx.ui.notify("TDD is disabled by configuration", "warning");
  }

  return {
    content: [{ type: "text" as const, text: "TDD is disabled by configuration." }],
    details: { engaged: false, phase: null, reason: "disabled by configuration" },
  };
}

async function startMachine(
  deps: LifecycleDeps,
  ctx: ExtensionContext,
  phase: TDDPhase,
  reason: string,
  transitionReason: string,
  options?: { viaToolName?: string }
) {
  const machine = deps.machine;
  const config = deps.getConfig();
  const wasEnabled = machine.enabled;
  machine.setRequestedSeam(classifyRequestedSeam(reason, machine.plan));
  const preflight = await runStartPreflightGate(machine, phase, reason, ctx, config);
  if (preflight.refinedSpec) {
    persist(deps);
  }
  if (!preflight.allowed) {
    return blockedStartResponse(machine, reason, preflight.text);
  }

  machine.enabled = true;
  if (machine.phase !== phase) {
    machine.transitionTo(phase, transitionReason, true);
  }

  persist(deps);
  ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
  notifyStarted(ctx, wasEnabled, phase, reason, options?.viaToolName);

  return {
    content: [{
      type: "text" as const,
      text: preflight.refined
        ? `TDD started in ${phase} phase after auto-refining the spec. ${reason}`
        : `TDD started in ${phase} phase. ${reason}`,
    }],
    details: { engaged: true, phase, reason },
  };
}

function blockedStartResponse(
  machine: PhaseStateMachine,
  reason: string,
  text?: string
) {
  return {
    content: [{ type: "text" as const, text: text ?? "RED is waiting on a clearer spec." }],
    details: { engaged: machine.enabled, phase: machine.phase, reason },
  };
}

function bootstrapStartResponse(
  machine: PhaseStateMachine,
  ctx: ExtensionContext,
  reason: string
) {
  ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
  if (ctx.hasUI) {
    ctx.ui.notify(
      "TDD stays dormant during project scaffolding and initial test-harness setup",
      "info"
    );
  }

  return {
    content: [{
      type: "text" as const,
      text:
        "Stay dormant for project scaffolding, bootstrap, or initial test-harness setup. Start TDD once the project can host a failing test for the requested behavior.",
    }],
    details: { engaged: false, phase: null, reason },
  };
}

function missingHarnessStartResponse(
  machine: PhaseStateMachine,
  ctx: ExtensionContext,
  reason: string
) {
  ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
  if (ctx.hasUI) {
    ctx.ui.notify(
      "TDD stays dormant until the repository has a runnable test harness",
      "info"
    );
  }

  return {
    content: [{
      type: "text" as const,
      text:
        "TDD requires a runnable test harness. First check whether the repository already has a test command or framework; if not, set up the minimal harness that fits the stack or ask the user to confirm the tooling choice. Once a failing test can run, call tdd_start again before continuing feature work.",
    }],
    details: { engaged: false, phase: null, reason },
  };
}

function notifyStarted(
  ctx: ExtensionContext,
  wasEnabled: boolean,
  phase: TDDPhase,
  reason: string,
  viaToolName?: string
): void {
  if (!ctx.hasUI) {
    return;
  }

  const message = viaToolName
    ? `TDD started in ${phase} (via ${viaToolName})`
    : `${wasEnabled ? "TDD phase set to" : "TDD started in"} ${phase}: ${reason}`;
  ctx.ui.notify(message, "info");
}

function blockedRedReadinessText(
  result: Awaited<ReturnType<typeof runRedReadinessCheck>>,
  machine: PhaseStateMachine,
  summary: string
): string {
  const lines = [summary];

  if (result.refinedSpec) {
    lines.push("", `Feature spec (${machine.plan.length} item(s)):`);
    lines.push(
      "",
      ...machine.plan.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  lines.push("", "Stay in SPEC and tighten the checklist a bit more before retrying RED.");
  return lines.join("\n");
}

function redReadinessIssueCount(
  result: Awaited<ReturnType<typeof runRedReadinessCheck>>
): number {
  return result.final.ok ? 0 : result.final.issues.length;
}

async function endMachine(
  deps: LifecycleDeps,
  ctx: ExtensionContext,
  config: TDDConfig,
  reason: string
) {
  const machine = deps.machine;
  const wasEnabled = machine.enabled;
  const { result: postflightResult, summary: postflightSummary } =
    await maybeRunPostflightOnEnd(machine, ctx, config);

  machine.enabled = false;
  persist(deps);
  ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
  if (ctx.hasUI && wasEnabled) {
    ctx.ui.notify(`TDD ended: ${reason}`, "info");
  }

  return {
    content: [{ type: "text" as const, text: endText(reason, postflightSummary) }],
    details: {
      engaged: false,
      phase: null,
      reason,
      postflight: postflightResult,
    },
  };
}

function endText(reason: string, postflightSummary: string | null): string {
  return postflightSummary
    ? `${postflightSummary}\n\nTDD ended. ${reason}`
    : `TDD ended. ${reason}`;
}
