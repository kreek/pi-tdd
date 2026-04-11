import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { guidelinesForPhase } from "./guidelines.js";

export function buildSystemPrompt(machine: PhaseStateMachine, config: TDDConfig): string {
  if (!config.enabled) {
    return "[TDD MODE - DISABLED]\nTDD enforcement is disabled by configuration.";
  }

  if (!machine.enabled) {
    return buildDormantPrompt(config);
  }

  const lines = [
    `[TDD MODE - Phase: ${machine.phase}]`,
    `You are in strict TDD mode. Current phase: ${machine.phase}.`,
    "",
    ...phaseGuidance(machine),
    ...guidelineLines(machine, config),
    ...currentSpecItemLines(machine),
    ...proofCheckpointLines(machine),
    ...statusLines(machine),
  ];

  return lines.join("\n");
}

function buildDormantPrompt(config: TDDConfig): string {
  const lines = [
    "[TDD MODE - dormant]",
    "TDD enforcement is currently dormant. Investigation, navigation, code review, and exploratory work are unconstrained.",
    "",
    "Before feature work, check whether the repository already has a runnable test command or test framework.",
    "If the harness is missing, stay dormant and set up the minimal test harness that fits the stack, or ask the user if choosing the harness would be a meaningful tooling decision.",
    "Stay dormant for repository scaffolding, bootstrap work, and initial test-harness setup. Engage TDD only once the project can host a failing test for the requested behavior.",
    "Do not invent scaffold-only acceptance criteria like 'build passes', 'Vitest is configured', 'folders exist', or 'route shells compile' to justify TDD engagement.",
    "If the request is only schema, migration, database, or setup work, pause and decide whether that is scaffolding for the first real feature rather than its own TDD slice.",
    "Once a runnable test harness exists, call `tdd_start` immediately before continuing any user-visible feature or bug-fix work (phase: SPEC if requirements need clarification, RED if you can write the first failing test immediately).",
    "If you enter SPEC, use `tdd_refine_feature_spec` to persist or revise the checklist before the RED readiness check or RED.",
    "RED entry runs a readiness check on the checklist. If it is empty but the request is clear, Pi may draft the first checklist. If it is close but not quite ready, Pi may sharpen it once inside SPEC. If the behavior is still ambiguous, Pi should ask the user a concise clarification question before RED.",
    "If the repo already contains scaffolded files or placeholder tests from before TDD was engaged, treat them as baseline and use TDD for the next concrete behavior you change rather than trying to re-TDD the whole scaffold at once.",
    "Call `tdd_stop` when leaving feature work or switching back to investigation.",
  ];

  if (config.engageOnTools.length > 0) {
    lines.push("");
    lines.push(`TDD will also auto-engage when these tools are called: ${config.engageOnTools.join(", ")}.`);
  }

  return lines.join("\n");
}

function phaseGuidance(machine: PhaseStateMachine): string[] {
  switch (machine.phase) {
    case "SPEC":
      return [
        "- Use SPEC as an optional preflight step when needed to set the user's request up for success.",
        "- Translate the user's request into a clear user story, observable acceptance criteria, and concrete testable specifications before changing files.",
        "- Start from the outermost seam that honestly proves the requested behavior: route/API/page/form requests should begin there, not in helpers, services, schema, or migrations.",
        "- If the request is only schema, migration, database, or setup work, ask whether it should be folded under the first business slice instead of laundering scaffolding into a fake feature checklist.",
        "- Choose one cheapest honest first proof level for each item: unit for isolated logic, integration for boundaries and contracts.",
        "- Present the spec as a numbered list of test cases or acceptance checks that prove the requested behavior.",
        "- Prefer small vertical slices like `POST /api/links returns 201` over helper-led items like `slug utility rejects reserved words` unless the user explicitly asked for internals.",
        "- Use `tdd_refine_feature_spec` to store or revise the checklist while you are in SPEC.",
        "- SPEC includes both authoring the checklist and tightening it until RED can start cleanly.",
        "- Entering RED runs a readiness check. It may draft the first checklist from the request, sharpen a weak checklist once automatically, or surface concise clarification questions when the behavior is still ambiguous.",
        "- Stay in specification mode until the user or command switches to RED.",
        ...specChecklistLines(machine),
      ];
    case "RED":
      return [
        "- Write a failing test first.",
        "- Use the cheapest honest test that proves the current behavior at the requested seam: unit for isolated logic, integration for boundaries and contracts.",
        "- Let the first failing proving test for the current spec item define the proof target for this cycle.",
        "- If the test already passes, RED is not done yet. Tighten or add a proving test until the current spec item fails once at the honest seam.",
        "- Confirm the test fails before moving to implementation.",
      ];
    case "GREEN":
      return [
        "- Write the smallest correct implementation for the behavior the failing test asserts.",
        "- Satisfy the current failing test at its chosen proof level by exercising boundary behavior honestly when the test targets a seam.",
        "- Drive the active proof target to green before chasing unrelated test output.",
        "- Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.",
      ];
    case "REFACTOR":
      return [
        "- Preserve behavior while refining the code from this cycle: naming, readability, duplication, structure.",
        "- If the proving test needs to change materially, start a fresh RED cycle for that behavior.",
      ];
  }
}

function specChecklistLines(machine: PhaseStateMachine): string[] {
  if (machine.plan.length === 0) {
    return [];
  }

  return [
    "",
    "Current feature spec:",
    ...machine.plan.map((item, index) => `${specMarker(machine, index)} ${index + 1}. ${item}`),
  ];
}

function specMarker(machine: PhaseStateMachine, index: number): string {
  if (index < machine.planCompleted) return "[x]";
  if (index === machine.planCompleted) return "[>]";
  return "[ ]";
}

function guidelineLines(machine: PhaseStateMachine, config: TDDConfig): string[] {
  const guidelines = guidelinesForPhase(machine.phase, config.guidelines);
  return guidelines ? ["", guidelines] : [];
}

function currentSpecItemLines(machine: PhaseStateMachine): string[] {
  if (machine.phase === "SPEC" || machine.plan.length === 0) {
    return [];
  }

  const current = machine.currentPlanItem();
  return current
    ? ["", `Current spec item (${machine.planCompleted + 1}/${machine.plan.length}): ${current}`]
    : [];
}

function proofCheckpointLines(machine: PhaseStateMachine): string[] {
  const checkpoint = machine.proofCheckpoint;
  if (!checkpoint) {
    return [];
  }

  const itemLabel = checkpoint.itemIndex === null ? "No active spec item" : `Spec item ${checkpoint.itemIndex}`;
  const levelLabel = checkpoint.level === "unknown" ? "UNKNOWN" : checkpoint.level.toUpperCase();
  return [
    "",
    `Active proof target: ${itemLabel} | ${levelLabel} | ${checkpoint.command}`,
  ];
}

function statusLines(machine: PhaseStateMachine): string[] {
  const lines = [
    "",
    `Allowed: ${machine.allowedActions()}`,
    `Prohibited: ${machine.prohibitedActions()}`,
    "",
    "Tool calls are gated. Out-of-phase actions can be blocked.",
  ];

  if (machine.lastTestFailed !== null) {
    lines.push(`Last test result: ${machine.lastTestFailed ? "FAILING" : "PASSING"}`);
  }
  if (machine.phase !== "SPEC") {
    lines.push(`Cycle: ${machine.cycleCount}`);
  }

  return lines;
}
