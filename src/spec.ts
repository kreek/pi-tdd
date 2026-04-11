import type { PhaseStateMachine } from "./phase.js";

export function formatSpec(machine: PhaseStateMachine): string {
  const snap = machine.getSnapshot();
  if (snap.plan.length === 0) {
    return "No feature spec set. Use tdd_refine_feature_spec to create one.";
  }

  const lines = [`Feature spec (${snap.planCompleted}/${snap.plan.length} completed):`, ""];
  for (let i = 0; i < snap.plan.length; i++) {
    lines.push(`${specMarker(snap.planCompleted, i)} ${i + 1}. ${snap.plan[i]}`);
  }
  return lines.join("\n");
}

function specMarker(completed: number, index: number): string {
  if (index < completed) return "[x]";
  if (index === completed) return "[>]";
  return "[ ]";
}
