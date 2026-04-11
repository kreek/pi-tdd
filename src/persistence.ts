import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type {
  BehaviorSeam,
  MutationRecord,
  PhaseState,
  ProofCheckpoint,
  TDDPhase,
  TestProofLevel,
  TestSignal,
} from "./types.js";
import type { PhaseStateMachine } from "./phase.js";

export const STATE_ENTRY_TYPE = "tdd_state";

type TddStateEntry = SessionEntry & {
  type: "custom";
  customType: typeof STATE_ENTRY_TYPE;
  data?: PhaseState;
};

export function persistState(pi: ExtensionAPI, machine: PhaseStateMachine): void {
  pi.appendEntry(STATE_ENTRY_TYPE, machine.getSnapshot());
}

export function restoreState(ctx: ExtensionContext): PhaseState | null {
  const entries = ctx.sessionManager.getBranch();

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as TddStateEntry;
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE || !entry.data) {
      continue;
    }

    const state = entry.data;
    const phase = normalizePhase(state.phase);
    if (!phase) {
      continue;
    }

    return {
      phase,
      diffs: Array.isArray(state.diffs) ? state.diffs : [],
      mutations: normalizeMutations(state.mutations),
      lastTestOutput: typeof state.lastTestOutput === "string" ? state.lastTestOutput : null,
      lastTestFailed: typeof state.lastTestFailed === "boolean" ? state.lastTestFailed : null,
      recentTests: normalizeRecentTests(state.recentTests),
      proofCheckpoint: normalizeProofCheckpoint(state.proofCheckpoint),
      cycleCount: typeof state.cycleCount === "number" ? state.cycleCount : 0,
      enabled: typeof state.enabled === "boolean" ? state.enabled : true,
      plan: Array.isArray(state.plan) ? state.plan : [],
      planCompleted: typeof state.planCompleted === "number" ? state.planCompleted : 0,
      requestedSeam: normalizeBehaviorSeam(state.requestedSeam),
    };
  }

  return null;
}

function normalizePhase(phase: unknown): TDDPhase | null {
  if (phase === "PLAN" || phase === "SPEC") return "SPEC";
  if (phase === "RED" || phase === "GREEN" || phase === "REFACTOR") return phase;
  return null;
}

function normalizeRecentTests(value: unknown): TestSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): TestSignal | null => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const test = entry as Record<string, unknown>;
      if (
        typeof test.command !== "string" ||
        typeof test.output !== "string" ||
        typeof test.failed !== "boolean"
      ) {
        return null;
      }

      return {
        command: test.command,
        output: test.output,
        failed: test.failed,
        level: normalizeProofLevel(test.level),
      };
    })
    .filter((entry): entry is TestSignal => entry !== null);
}

function normalizeProofLevel(value: unknown): TestProofLevel {
  return value === "unit" || value === "integration" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeBehaviorSeam(value: unknown): BehaviorSeam | null {
  return value === "business_http" ||
    value === "business_ui" ||
    value === "business_domain" ||
    value === "internal_support" ||
    value === "unknown"
    ? value
    : null;
}

function normalizeMutations(value: unknown): MutationRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): MutationRecord | null => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const mutation = entry as Record<string, unknown>;
      const phase = normalizePhase(mutation.phase);
      if (!phase || typeof mutation.toolName !== "string") {
        return null;
      }

      return {
        toolName: mutation.toolName,
        phase,
        path: typeof mutation.path === "string" ? mutation.path : undefined,
        command: typeof mutation.command === "string" ? mutation.command : undefined,
      };
    })
    .filter((entry): entry is MutationRecord => entry !== null);
}

function normalizeProofCheckpoint(value: unknown): ProofCheckpoint | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const checkpoint = value as Record<string, unknown>;
  if (
    typeof checkpoint.command !== "string" ||
    typeof checkpoint.commandFamily !== "string" ||
    typeof checkpoint.mutationCountAtCapture !== "number"
  ) {
    return null;
  }

  return {
    itemIndex: typeof checkpoint.itemIndex === "number" ? checkpoint.itemIndex : null,
    item: typeof checkpoint.item === "string" ? checkpoint.item : null,
    seam: normalizeBehaviorSeam(checkpoint.seam) ?? "unknown",
    command: checkpoint.command,
    commandFamily: checkpoint.commandFamily,
    level: normalizeProofLevel(checkpoint.level),
    testFiles: Array.isArray(checkpoint.testFiles)
      ? checkpoint.testFiles.filter((file): file is string => typeof file === "string")
      : [],
    mutationCountAtCapture: checkpoint.mutationCountAtCapture,
  };
}
