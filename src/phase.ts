import type {
  BehaviorSeam,
  MutationRecord,
  PhaseState,
  PhaseTransitionLog,
  ProofCheckpoint,
  TDDPhase,
  TestProofLevel,
  TestSignal,
} from "./types.js";
import { classifyProofSeam } from "./seams.js";

const CYCLE_ORDER: TDDPhase[] = ["RED", "GREEN", "REFACTOR"];
const MAX_RECENT_TESTS = 6;
const MAX_RECENT_MUTATIONS = 24;

export class PhaseStateMachine {
  // "plan" is the persisted historical field name for the SPEC checklist.
  private state: PhaseState;
  private history: PhaseTransitionLog[] = [];

  constructor(initial?: Partial<PhaseState>) {
    this.state = {
      phase: initial?.phase ?? "RED",
      diffs: initial?.diffs ?? [],
      mutations: initial?.mutations ?? [],
      lastTestOutput: initial?.lastTestOutput ?? null,
      lastTestFailed: initial?.lastTestFailed ?? null,
      recentTests: initial?.recentTests ?? [],
      proofCheckpoint: initial?.proofCheckpoint ?? null,
      cycleCount: initial?.cycleCount ?? 0,
      enabled: initial?.enabled ?? false,
      plan: initial?.plan ?? [],
      planCompleted: initial?.planCompleted ?? 0,
      requestedSeam: initial?.requestedSeam ?? null,
    };
  }

  get phase(): TDDPhase {
    return this.state.phase;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  set enabled(value: boolean) {
    this.state.enabled = value;
  }

  get cycleCount(): number {
    return this.state.cycleCount;
  }

  get lastTestFailed(): boolean | null {
    return this.state.lastTestFailed;
  }

  get lastTestOutput(): string | null {
    return this.state.lastTestOutput;
  }

  get diffs(): string[] {
    return this.state.diffs;
  }

  get recentTests(): TestSignal[] {
    return this.state.recentTests;
  }

  get proofCheckpoint(): ProofCheckpoint | null {
    return this.state.proofCheckpoint;
  }

  get plan(): string[] {
    return this.state.plan;
  }

  get planCompleted(): number {
    return this.state.planCompleted;
  }

  get requestedSeam(): BehaviorSeam | null {
    return this.state.requestedSeam;
  }

  getSnapshot(): Readonly<PhaseState> {
    return {
      ...this.state,
      diffs: [...this.state.diffs],
      mutations: this.state.mutations.map(cloneMutation),
      recentTests: [...this.state.recentTests],
      proofCheckpoint: cloneProofCheckpoint(this.state.proofCheckpoint),
      plan: [...this.state.plan],
    };
  }

  restore(state: PhaseState): void {
    this.state = {
      phase: state.phase,
      diffs: [...state.diffs],
      mutations: state.mutations.map(cloneMutation),
      lastTestOutput: state.lastTestOutput,
      lastTestFailed: state.lastTestFailed,
      recentTests: [...state.recentTests],
      proofCheckpoint: cloneProofCheckpoint(state.proofCheckpoint),
      cycleCount: state.cycleCount,
      enabled: state.enabled,
      plan: [...state.plan],
      planCompleted: state.planCompleted,
      requestedSeam: state.requestedSeam,
    };
  }

  getHistory(): readonly PhaseTransitionLog[] {
    return this.history;
  }

  nextPhase(): TDDPhase {
    if (this.state.phase === "SPEC") {
      return "RED";
    }

    const idx = CYCLE_ORDER.indexOf(this.state.phase);
    return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
  }

  transitionTo(target: TDDPhase, reason: string, override = false): boolean {
    if (target === this.state.phase) return false;

    const log: PhaseTransitionLog = {
      from: this.state.phase,
      to: target,
      reason,
      timestamp: Date.now(),
      override,
    };

    this.history.push(log);

    const startingNewRedCycle = target === "RED" && this.state.phase !== "RED";

    if (this.state.phase === "REFACTOR" && target === "RED") {
      this.state.cycleCount++;
    }

    this.state.phase = target;
    this.state.diffs = [];
    if (startingNewRedCycle) {
      this.resetCycleEvidence();
    }
    return true;
  }

  setPlan(items: string[]): void {
    this.state.plan = items;
    this.state.planCompleted = 0;
    this.state.proofCheckpoint = null;
  }

  setRequestedSeam(seam: BehaviorSeam | null): void {
    this.state.requestedSeam = seam;
  }

  completePlanItem(): void {
    if (this.state.planCompleted < this.state.plan.length) {
      this.state.planCompleted++;
    }
  }

  currentPlanItem(): string | null {
    if (this.state.planCompleted < this.state.plan.length) {
      return this.state.plan[this.state.planCompleted];
    }

    return null;
  }

  addDiff(summary: string, maxDiffs: number): void {
    this.state.diffs.push(summary);
    if (this.state.diffs.length > maxDiffs) {
      this.state.diffs = this.state.diffs.slice(-maxDiffs);
    }
  }

  recordMutation(toolName: string, path?: string, command?: string): void {
    this.state.mutations.push({
      toolName,
      phase: this.state.phase,
      path,
      command,
    });
    if (this.state.mutations.length > MAX_RECENT_MUTATIONS) {
      this.state.mutations = this.state.mutations.slice(-MAX_RECENT_MUTATIONS);
    }
    this.syncProofCheckpointTestFiles(command);
  }

  recordTestResult(
    output: string,
    failed: boolean,
    command = "(unknown test command)",
    level: TestProofLevel = "unknown"
  ): void {
    this.state.lastTestOutput = output;
    this.state.lastTestFailed = failed;
    this.state.recentTests.push({ command, output, failed, level });
    if (this.state.recentTests.length > MAX_RECENT_TESTS) {
      this.state.recentTests = this.state.recentTests.slice(-MAX_RECENT_TESTS);
    }
  }

  captureProofCheckpoint(signal: TestSignal, commandFamily: string): void {
    if (this.state.proofCheckpoint || !signal.failed) {
      return;
    }

    const testFiles = testMutationPaths(this.state.mutations);
    this.state.proofCheckpoint = {
      itemIndex: currentPlanItemIndex(this.state),
      item: this.currentPlanItem(),
      seam: classifyProofSeam({
        item: this.currentPlanItem(),
        testFiles,
        command: signal.command,
      }),
      command: signal.command,
      commandFamily,
      level: signal.level,
      testFiles,
      mutationCountAtCapture: this.state.mutations.length,
    };
  }

  allowedActions(): string {
    switch (this.state.phase) {
      case "SPEC":
        return "Read code. Clarify the user's request. Translate it into user-visible behavior, acceptance criteria, and testable specifications. Start from the outermost seam that proves the request honestly, and choose one cheapest proof level unless the boundary itself is the risk. Discuss the spec.";
      case "RED":
        return "Write or modify unit or integration tests. Run tests to confirm failure. Read any file.";
      case "GREEN":
        return "Write the smallest correct implementation to pass the current failing unit or integration test. Run tests.";
      case "REFACTOR":
        return "Restructure, rename, extract. Run the relevant unit or integration tests to confirm behavior stays the same.";
    }
  }

  prohibitedActions(): string {
    switch (this.state.phase) {
      case "SPEC":
        return "Write or modify files. Execute state-changing commands. Implementation planning and code changes are out of scope. Only request-to-spec translation work is allowed.";
      case "RED":
        return "Write production implementation. Modify non-test source files unless explicitly overridden.";
      case "GREEN":
        return "Refactor. Add features beyond what the failing test requires.";
      case "REFACTOR":
        return "Change behavior. Add new tests for new scope.";
    }
  }

  statusText(): string {
    if (!this.state.enabled) {
      return "[TDD: dormant]";
    }

    if (this.state.phase === "SPEC") {
      return `[TDD: SPEC] | Spec items: ${this.state.plan.length}`;
    }

    const testStatus =
      this.state.lastTestFailed === null ? "UNKNOWN" : this.state.lastTestFailed ? "FAILING" : "PASSING";
    const planProgress =
      this.state.plan.length > 0 ? ` | Spec: ${this.state.planCompleted}/${this.state.plan.length}` : "";
    return `[TDD: ${this.state.phase}] | Tests: ${testStatus} | Cycle: ${this.state.cycleCount}${planProgress}`;
  }

  /**
   * Status text for the Pi bottom-bar indicator. Returns undefined when TDD is
   * dormant so the indicator disappears entirely — there's nothing useful to
   * communicate while TDD is not enforcing anything.
   */
  bottomBarText(): string | undefined {
    return this.state.enabled ? this.statusText() : undefined;
  }

  private resetCycleEvidence(): void {
    this.state.lastTestOutput = null;
    this.state.lastTestFailed = null;
    this.state.recentTests = [];
    this.state.mutations = [];
    this.state.proofCheckpoint = null;
  }

  private syncProofCheckpointTestFiles(command?: string): void {
    if (!this.state.proofCheckpoint || !command) {
      return;
    }

    const renames = extractMvRenames(command);
    if (renames.length === 0) {
      return;
    }

    this.state.proofCheckpoint.testFiles = this.state.proofCheckpoint.testFiles.map((file) => {
      let next = file;
      for (const [from, to] of renames) {
        if (next === from) {
          next = to;
        }
      }
      return next;
    });
  }
}

function currentPlanItemIndex(state: PhaseState): number | null {
  return state.planCompleted < state.plan.length ? state.planCompleted + 1 : null;
}

function testMutationPaths(mutations: MutationRecord[]): string[] {
  return uniqueStrings(
    mutations
      .map((mutation) => mutation.path)
      .filter((path): path is string => !!path && isLikelyTestFile(path))
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isLikelyTestFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/tests/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".test.jsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".spec.js") ||
    normalized.endsWith(".spec.jsx") ||
    normalized.endsWith("_test.go") ||
    normalized.endsWith("_test.py") ||
    normalized.endsWith("_spec.rb") ||
    normalized.endsWith("test.py")
  );
}

function cloneMutation(mutation: MutationRecord): MutationRecord {
  return { ...mutation };
}

function cloneProofCheckpoint(checkpoint: ProofCheckpoint | null): ProofCheckpoint | null {
  return checkpoint
    ? {
        ...checkpoint,
        testFiles: [...checkpoint.testFiles],
      }
    : null;
}

function extractMvRenames(command: string): Array<[string, string]> {
  return command
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .flatMap(parseMvRename);
}

function parseMvRename(segment: string): Array<[string, string]> {
  const tokens = segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  const [commandToken] = tokens;
  if (tokens.length < 3 || !commandToken || stripQuotes(commandToken) !== "mv") {
    return [];
  }

  const args = tokens.slice(1).map(stripQuotes);
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (paths.length !== 2) {
    return [];
  }

  return [[paths[0], paths[1]]];
}

function stripQuotes(token: string): string {
  if (
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith("\"") && token.endsWith("\""))
  ) {
    return token.slice(1, -1);
  }

  return token;
}
