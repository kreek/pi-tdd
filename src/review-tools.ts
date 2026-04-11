import { Type } from "@mariozechner/pi-ai";
import type {
  ExtensionContext,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { LifecycleDeps } from "./engagement.js";
import type { PreflightResult } from "./preflight.js";
import { formatPostflightResult, runPostflight, type PostflightResult } from "./postflight.js";
import { persistState } from "./persistence.js";
import { loadPromptList } from "./prompt-loader.js";
import { formatRedReadinessResult, runRedReadinessCheck } from "./red-readiness.js";
import { classifyRequestedSeam } from "./seams.js";
import { maybeEngageSpecSession, type SpecSessionOutcome } from "./spec-session.js";
import { formatSpec } from "./spec.js";

export const PREFLIGHT_TOOL_NAME = "tdd_preflight";
export const POSTFLIGHT_TOOL_NAME = "tdd_postflight";
const PREFLIGHT_PROMPT_SNIPPET = "Inspect or sharpen RED readiness for the current spec.";
const PREFLIGHT_PROMPT_GUIDELINES = loadPromptList("tool-preflight-guidelines");
const POSTFLIGHT_PROMPT_SNIPPET = "Inspect the post-flight verdict on the current cycle.";
const POSTFLIGHT_PROMPT_GUIDELINES = loadPromptList("tool-postflight-guidelines");

interface PreflightParams {
  userStory?: string;
}

interface PostflightParams {
  userStory?: string;
}

export function createPreflightTool(
  deps: LifecycleDeps
): ToolDefinition<ReturnType<typeof Type.Object>, PreflightResult, PreflightParams> {
  return {
    name: PREFLIGHT_TOOL_NAME,
    label: "TDD RED Readiness",
    description:
      "Run the TDD RED readiness check. Reviews the spec checklist before RED, sharpens it when it is close but not quite ready, and reports whether the cycle can start cleanly.",
    promptSnippet: PREFLIGHT_PROMPT_SNIPPET,
    promptGuidelines: PREFLIGHT_PROMPT_GUIDELINES,
    parameters: Type.Object({
      userStory: Type.Optional(
        Type.String({
          description: "Optional user story or original request text. Provides context for whether the spec covers what was asked for.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;
      const specSession = maybeEngageSpecSession(machine, ctx);

      const result = await runRedReadinessCheck(
        {
          spec: machine.plan,
          userStory: params.userStory,
          planCompleted: machine.planCompleted,
        },
        ctx,
        config
      );

      if (result.refinedSpec) {
        machine.setPlan(result.refinedSpec);
      }
      machine.setRequestedSeam(classifyRequestedSeam(params.userStory, machine.plan));
      if (specSession.engaged || result.refinedSpec || machine.requestedSeam) {
        persistState(deps.pi, machine);
      }
      ctx.ui.setStatus("tdd-gate", machine.bottomBarText());

      const summary = readinessSummary(result, machine, specSession);
      if (ctx.hasUI) {
        ctx.ui.notify(
          result.ok
            ? result.refined
              ? "RED readiness refined the spec and it is ready."
              : "RED readiness: OK"
            : specSession.waitingForHarness
              ? `RED readiness suggests ${redReadinessIssueCount(result)} refinement(s); TDD stays dormant until the repo can run tests`
            : result.refined
              ? "RED readiness refined the spec, but it still needs clarification."
              : `RED readiness suggests ${redReadinessIssueCount(result)} refinement(s)`,
          "info"
        );
      }

      return {
        content: [{ type: "text", text: summary }],
        details: result.final,
      };
    },
  };
}

export function createPostflightTool(
  deps: LifecycleDeps
): ToolDefinition<ReturnType<typeof Type.Object>, PostflightResult, PostflightParams> {
  return {
    name: POSTFLIGHT_TOOL_NAME,
    label: "TDD Post-flight",
    description:
      "Run the TDD post-flight review (proving the cycle). Validates that the completed TDD cycle delivered what the spec asked for, that the implementation matches the behavior the spec describes, that the proof is at the right level for the behavior, and that there are no clear project-fit mismatches unless the user request or spec justifies them. Call this when tests are green and you believe the cycle is complete.",
    promptSnippet: POSTFLIGHT_PROMPT_SNIPPET,
    promptGuidelines: POSTFLIGHT_PROMPT_GUIDELINES,
    parameters: Type.Object({
      userStory: Type.Optional(
        Type.String({
          description: "Optional user story or original request text. Provides context for whether the implementation matches what was asked for.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;

      const result = await runPostflight(
        {
          state: machine.getSnapshot(),
          userStory: params.userStory,
        },
        ctx,
        config
      );

      const summary = formatPostflightResult(result);
      if (ctx.hasUI) {
        ctx.ui.notify(
          result.ok ? "TDD post-flight: OK" : `TDD post-flight: ${result.gaps.length} gap(s)`,
          result.ok ? "info" : "warning"
        );
      }

      return {
        content: [{ type: "text", text: summary }],
        details: result,
      };
    },
  };
}

function readinessSummary(
  result: Awaited<ReturnType<typeof runRedReadinessCheck>>,
  machine: LifecycleDeps["machine"],
  specSession: SpecSessionOutcome
): string {
  const lines = [formatRedReadinessResult(result)];

  if (result.refinedSpec) {
    lines.push("", formatSpec(machine));
  }

  if (specSession.waitingForHarness) {
    lines.push(
      "",
      "RED readiness reviewed the checklist, but TDD stays dormant until the repository has a runnable test harness."
    );
  }

  if (result.ok && machine.enabled && machine.phase === "SPEC") {
    lines.push(
      "",
      "SPEC stays active until you enter RED with tdd_start(phase: 'RED')."
    );
  }

  return lines.join("\n");
}

function redReadinessIssueCount(
  result: Awaited<ReturnType<typeof runRedReadinessCheck>>
): number {
  return result.final.ok ? 0 : result.final.issues.length;
}
