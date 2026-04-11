import { Type } from "@mariozechner/pi-ai";
import type {
  ExtensionContext,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { LifecycleDeps } from "./engagement.js";
import { persistState } from "./persistence.js";
import { loadPromptList } from "./prompt-loader.js";
import { classifyRequestedSeam } from "./seams.js";
import { maybeEngageSpecSession } from "./spec-session.js";
import { formatSpec } from "./spec.js";
import type { TDDPhase } from "./types.js";

const STATUS_KEY = "tdd-gate";
const SPEC_TOOL_PROMPT_SNIPPET = "Create or revise the TDD feature spec checklist.";
const SPEC_TOOL_PROMPT_GUIDELINES = loadPromptList("tool-spec-guidelines");

export const REFINE_FEATURE_SPEC_TOOL_NAME = "tdd_refine_feature_spec";

interface SpecSetParams {
  items: string[];
}

interface SpecSetDetails {
  ok: boolean;
  count: number;
  enabled: boolean;
  phase: TDDPhase;
}

export function createRefineFeatureSpecTool(
  deps: LifecycleDeps
): ToolDefinition<ReturnType<typeof Type.Object>, SpecSetDetails, SpecSetParams> {
  return {
    name: REFINE_FEATURE_SPEC_TOOL_NAME,
    label: "Refine Feature Spec",
    description:
      "Create, replace, or refine the active TDD feature spec checklist. Use this during SPEC to persist the numbered acceptance checks that will drive RED -> GREEN -> REFACTOR.",
    promptSnippet: SPEC_TOOL_PROMPT_SNIPPET,
    promptGuidelines: SPEC_TOOL_PROMPT_GUIDELINES,
    parameters: Type.Object({
      items: Type.Array(
        Type.String({
          description: "One concrete, observable behavior or acceptance check.",
          minLength: 1,
        }),
        {
          description: "Ordered TDD spec checklist. Replaces the current checklist.",
        }
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;
      if (!config.enabled) {
        return disabledSpecSetResponse(machine, ctx);
      }

      const specSession = maybeEngageSpecSession(machine, ctx);
      const items = normalizeSpecItems(params.items);
      if (items.length === 0) {
        return invalidSpecSetResponse(machine, ctx);
      }

      machine.setPlan(items);
      machine.setRequestedSeam(classifyRequestedSeam(undefined, items));
      persistState(deps.pi, machine);
      ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
      notifySpecSet(ctx, items.length, specSession.waitingForHarness);

      return {
        content: [{ type: "text" as const, text: specSetSummary(machine, specSession.waitingForHarness) }],
        details: specSetDetails(machine, true),
      };
    },
  };
}

function normalizeSpecItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function disabledSpecSetResponse(
  machine: LifecycleDeps["machine"],
  ctx: ExtensionContext
) {
  ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
  if (ctx.hasUI) {
    ctx.ui.notify("TDD is disabled by configuration", "warning");
  }

  return {
    content: [{ type: "text" as const, text: "TDD is disabled by configuration." }],
    details: {
      ok: false,
      count: machine.plan.length,
      enabled: false,
      phase: machine.phase,
    },
  };
}

function invalidSpecSetResponse(
  machine: LifecycleDeps["machine"],
  ctx: ExtensionContext
) {
  if (ctx.hasUI) {
    ctx.ui.notify("Feature spec requires at least one non-empty item", "warning");
  }

  return {
    content: [{
      type: "text" as const,
      text: "Feature spec requires at least one non-empty item. Provide concrete checklist items and call tdd_refine_feature_spec again.",
    }],
    details: specSetDetails(machine, false),
  };
}

function notifySpecSet(ctx: ExtensionContext, count: number, waitingForHarness: boolean): void {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.notify(
    waitingForHarness
      ? `Feature spec set with ${count} item(s); TDD stays dormant until the repo can run tests`
      : `Feature spec set with ${count} item(s)`,
    "info"
  );
}

function specSetDetails(
  machine: LifecycleDeps["machine"],
  ok: boolean
): SpecSetDetails {
  return {
    ok,
    count: machine.plan.length,
    enabled: machine.enabled,
    phase: machine.phase,
  };
}

function specSetSummary(
  machine: LifecycleDeps["machine"],
  waitingForHarness: boolean
): string {
  if (!waitingForHarness) {
    return formatSpec(machine);
  }

  return [
    formatSpec(machine),
    "",
    "Feature spec is stored, but TDD stays dormant until the repository has a runnable test harness.",
  ].join("\n");
}
