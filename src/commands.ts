import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { isBootstrapWorkReason, maybeRunPostflightOnEnd } from "./engagement.js";
import { classifyRequestedSeam } from "./seams.js";
import { hasRunnableTestHarness } from "./test-harness.js";

const LEGACY_COMMANDS = new Set([
  "status",
  "spec",
  "plan",
  "red",
  "green",
  "refactor",
  "spec-set",
  "plan-set",
  "spec-show",
  "plan-show",
  "spec-done",
  "plan-done",
  "preflight",
  "postflight",
  "engage",
  "disengage",
  "history",
]);

type Publish = (message: string) => void;

export async function handleTddCommand(
  rawArgs: string,
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish,
  config?: TDDConfig
): Promise<void> {
  const trimmed = rawArgs.trim();
  const args = splitCommandArgs(trimmed);
  const sub = (args[0] ?? "").toLowerCase();
  const configDisabled = config?.enabled === false;

  if (trimmed.length === 0) {
    publish(HELP_TEXT);
    return;
  }

  switch (sub) {
    case "off":
      await handleEndCommand(machine, ctx, publish, config);
      return;

    case "on":
      handleOnCommand(machine, ctx, publish, configDisabled);
      return;

    default:
      if (LEGACY_COMMANDS.has(sub)) {
        publish(formatLegacyCommandMessage(sub));
        if (ctx.hasUI) {
          ctx.ui.notify("Legacy /tdd admin subcommands were removed", "info");
        }
        return;
      }

      await handleRequestCommand(trimmed, machine, ctx, publish, configDisabled);
      return;
  }
}

function publishDisabled(
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish
): void {
  machine.enabled = false;
  ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
  ctx.ui.notify("TDD is disabled by configuration", "warning");
  publish("TDD is disabled by configuration.");
}

function formatLegacyCommandMessage(command: string): string {
  if (command === "engage") {
    return "Legacy `/tdd engage` was removed. Use `/tdd on` to start TDD, or `/tdd <feature or bug request>` to begin a concrete slice of work.";
  }

  if (command === "disengage") {
    return "Legacy `/tdd disengage` was removed. Use `/tdd off` to end TDD.";
  }

  if (command === "status") {
    return "Legacy `/tdd status` was removed. Use the TDD HUD for live state, or use `/tdd on`, `/tdd off`, or `/tdd <feature or bug request>`.";
  }

  return `Legacy \`/tdd ${command}\` was removed. Use \`/tdd <feature or bug request>\`, \`/tdd on\`, or \`/tdd off\`. Spec refinement and phase control now happen through agent tools such as \`tdd_refine_feature_spec\`, \`tdd_preflight\`, \`tdd_start\`, and \`tdd_postflight\`.`;
}

async function handleRequestCommand(
  request: string,
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish,
  configDisabled: boolean
): Promise<void> {
  if (configDisabled) {
    publishDisabled(machine, ctx, publish);
    return;
  }

  if (isBootstrapWorkReason(request)) {
    ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
    ctx.ui.notify(
      "TDD stays dormant during project scaffolding and initial test-harness setup",
      "info"
    );
    publish(
      "TDD stays dormant for scaffolding, bootstrap, or initial test-harness setup. Once the project can host a failing test for the requested behavior, run `/tdd <feature or bug request>` again."
    );
    return;
  }

  if (!hasRunnableTestHarness(ctx.cwd)) {
    ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
    ctx.ui.notify(
      "TDD stays dormant until the repository has a runnable test harness",
      "info"
    );
    publish(
      "TDD requires a runnable test harness before feature work can enter the loop. Set up the minimal harness that fits the stack, or confirm the tooling choice with the user, then run `/tdd <feature or bug request>` again."
    );
    return;
  }

  const wasDormant = !machine.enabled;
  machine.setRequestedSeam(classifyRequestedSeam(request, machine.plan));
  machine.enabled = true;
  const transitioned = machine.phase !== "SPEC"
    ? machine.transitionTo("SPEC", "User started TDD for a feature or bug request", machine.phase !== machine.nextPhase())
    : false;
  ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
  ctx.ui.notify(
    wasDormant || transitioned ? "TDD started in SPEC" : "TDD request captured in SPEC",
    "info"
  );
  publish(
    `TDD started for: ${request}\nPhase: SPEC.\nRefine the checklist, then enter RED when the first failing test is clear.`
  );
}

async function handleEndCommand(
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish,
  config?: TDDConfig
): Promise<void> {
  if (config) {
    const { summary } = await maybeRunPostflightOnEnd(
      machine,
      ctx as ExtensionContext,
      config
    );
    if (summary) {
      publish(summary);
    }
  }

  machine.enabled = false;
  ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
  ctx.ui.notify("TDD ended", "info");
  publish("TDD ended. Investigation and navigation are unconstrained.");
}

function handleOnCommand(
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish,
  configDisabled: boolean
): void {
  if (configDisabled) {
    publishDisabled(machine, ctx, publish);
    return;
  }

  machine.enabled = true;
  ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
  ctx.ui.notify("TDD started", "info");
  publish(`TDD started. Phase: ${machine.phase}.`);
}

export function splitCommandArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const ch of raw.trim()) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

const HELP_TEXT = `Usage: /tdd on | off | <feature-or-bug request>

Examples:
/tdd fix slug validation when the custom slug is reserved
/tdd add pagination to the audit log
/tdd on
/tdd off

Legacy /tdd admin subcommands were removed. Use agent tools for spec refinement, RED readiness, and manual phase control.`;
