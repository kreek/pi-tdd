import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { guidelinesForPhase } from "./guidelines.js";

export function buildSystemPrompt(machine: PhaseStateMachine, config: TDDConfig): string {
  if (!machine.enabled) {
    return "[TDD MODE - DISABLED]\nTDD enforcement is currently disabled for this session.";
  }

  const phase = machine.phase;
  const allowed = machine.allowedActions();
  const prohibited = machine.prohibitedActions();
  const lines = [
    `[TDD MODE - Phase: ${phase}]`,
    `You are in strict TDD mode. Current phase: ${phase}.`,
    "",
  ];

  switch (phase) {
    case "SPEC":
      lines.push("- Use SPEC as an optional preflight step when needed to set the user's request up for success.");
      lines.push("- Translate the user's request into a clear user story, observable acceptance criteria, and concrete testable specifications before changing files.");
      lines.push("- Present the spec as a numbered list of test cases or acceptance checks that prove the requested behavior.");
      lines.push("- Do not write code until the user or command switches to RED.");
      if (machine.plan.length > 0) {
        lines.push("");
        lines.push("Current feature spec:");
        for (let i = 0; i < machine.plan.length; i++) {
          const marker = i < machine.planCompleted ? "[x]" : i === machine.planCompleted ? "[>]" : "[ ]";
          lines.push(`${marker} ${i + 1}. ${machine.plan[i]}`);
        }
      }
      break;
    case "RED":
      lines.push("- Write a failing test first.");
      lines.push("- Confirm the test fails before moving to implementation.");
      break;
    case "GREEN":
      lines.push("- Write the minimum implementation needed to pass the failing test.");
      lines.push("- Avoid refactors and side quests until the test passes.");
      break;
    case "REFACTOR":
      lines.push("- Improve structure without changing behavior.");
      lines.push("- Keep tests passing while cleaning up the code.");
      break;
  }

  const guidelines = guidelinesForPhase(phase, config.guidelines);
  if (guidelines) {
    lines.push("");
    lines.push(guidelines);
  }

  if (phase !== "SPEC" && machine.plan.length > 0) {
    const current = machine.currentPlanItem();
    if (current) {
      lines.push("");
      lines.push(`Current spec item (${machine.planCompleted + 1}/${machine.plan.length}): ${current}`);
    }
  }

  lines.push("");
  lines.push(`Allowed: ${allowed}`);
  lines.push(`Prohibited: ${prohibited}`);
  lines.push("");
  lines.push("Tool calls are gated. Out-of-phase actions can be blocked.");

  if (machine.lastTestFailed !== null) {
    lines.push(`Last test result: ${machine.lastTestFailed ? "FAILING" : "PASSING"}`);
  }

  if (phase !== "SPEC") {
    lines.push(`Cycle: ${machine.cycleCount}`);
  }

  return lines.join("\n");
}
