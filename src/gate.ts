import { isToolCallEventType, type ExtensionContext, type ToolCallEvent, type ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { judgeToolCalls } from "./judge.js";
import { isTestCommand } from "./transition.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const BUILTIN_MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

export async function gateToolCalls(
  events: ToolCallEvent[],
  machine: PhaseStateMachine,
  config: TDDConfig,
  ctx: ExtensionContext
): Promise<(ToolCallEventResult | undefined)[]> {
  if (!machine.enabled) {
    return events.map(() => undefined);
  }

  const results: (ToolCallEventResult | undefined)[] = events.map(() => undefined);
  const gatedIndices: number[] = [];
  const gatedEvents: ToolCallEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (config.allowReadInAllPhases && READ_ONLY_TOOLS.has(event.toolName)) {
      continue;
    }

    if (isToolCallEventType("bash", event) && machine.phase !== "SPEC" && isTestCommand(event.input.command)) {
      machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
      continue;
    }

    if (machine.phase === "SPEC" && BUILTIN_MUTATING_TOOLS.has(event.toolName)) {
      results[i] = await handlePlanBlock(event, ctx);
      if (!results[i]) {
        machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
      }
      continue;
    }

    gatedIndices.push(i);
    gatedEvents.push(event);
  }

  if (gatedEvents.length === 0) {
    return results;
  }

  let verdicts;
  try {
    verdicts = await judgeToolCalls(ctx, gatedEvents, machine.getSnapshot(), config);
  } catch (error) {
    const allowed = await confirmFailureFallback(
      ctx,
      "TDD judge unavailable",
      `${error instanceof Error ? error.message : String(error)}\nAllow ${gatedEvents.length} gated tool call(s)?`
    );

    for (const idx of gatedIndices) {
      if (allowed) {
        machine.addDiff(summarizeDiff(events[idx]), config.maxDiffsInContext);
        results[idx] = undefined;
      } else {
        results[idx] = { block: true, reason: "TDD judge unavailable and no override was granted." };
      }
    }

    return results;
  }

  for (let j = 0; j < gatedIndices.length; j++) {
    const idx = gatedIndices[j];
    const event = events[idx];
    const verdict = verdicts[j];

    if (verdict.allowed) {
      machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
      continue;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked ${event.toolName} during ${machine.phase}: ${verdict.reason}`, "warning");
    }

    const override = await confirmFailureFallback(
      ctx,
      `Blocked ${event.toolName}`,
      `${verdict.reason}\nOverride and allow this tool call?`
    );

    if (override) {
      machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
      continue;
    }

    results[idx] = { block: true, reason: verdict.reason };
  }

  return results;
}

export async function gateSingleToolCall(
  event: ToolCallEvent,
  machine: PhaseStateMachine,
  config: TDDConfig,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | void> {
  try {
    const [result] = await gateToolCalls([event], machine, config, ctx);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) {
      ctx.ui.notify(`TDD gate failed while checking ${event.toolName}: ${reason}`, "warning");
    }
    return { block: true, reason: `TDD gate failed safely: ${reason}` };
  }
}

async function handlePlanBlock(
  event: ToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | undefined> {
  if (ctx.hasUI) {
    ctx.ui.notify(`Blocked ${event.toolName} during SPEC. Finish the feature spec first.`, "warning");
  }

  const override = await confirmFailureFallback(
    ctx,
    "SPEC phase is read-only",
    `SPEC blocks ${event.toolName}. Override and allow it anyway?`
  );

  return override
    ? undefined
    : {
        block: true,
        reason: "SPEC phase blocks file changes and bash execution until the test specification is ready.",
      };
}

async function confirmFailureFallback(
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
