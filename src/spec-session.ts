import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PhaseStateMachine } from "./phase.js";
import { hasRunnableTestHarness } from "./test-harness.js";

export interface SpecSessionOutcome {
  engaged: boolean;
  waitingForHarness: boolean;
}

export function maybeEngageSpecSession(
  machine: PhaseStateMachine,
  ctx: Pick<ExtensionContext, "cwd">
): SpecSessionOutcome {
  if (machine.enabled) {
    return { engaged: false, waitingForHarness: false };
  }

  if (!hasRunnableTestHarness(ctx.cwd)) {
    return { engaged: false, waitingForHarness: true };
  }

  machine.enabled = true;
  machine.transitionTo("SPEC", "Entered SPEC via TDD spec work");
  return { engaged: true, waitingForHarness: false };
}
