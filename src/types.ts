export type TDDPhase = "SPEC" | "RED" | "GREEN" | "REFACTOR";
export type TestProofLevel = "unit" | "integration" | "unknown";
export type BehaviorSeam =
  | "business_http"
  | "business_ui"
  | "business_domain"
  | "internal_support"
  | "unknown";

export interface TestSignal {
  command: string;
  output: string;
  failed: boolean;
  level: TestProofLevel;
}

export interface ProofCheckpoint {
  /** 1-based spec item position being proven, or null when no checklist item is active. */
  itemIndex: number | null;
  item: string | null;
  seam: BehaviorSeam;
  command: string;
  commandFamily: string;
  level: TestProofLevel;
  /** Test files touched before the proving failure was first observed in RED. */
  testFiles: string[];
  /** Mutation count at the moment the checkpoint was captured. */
  mutationCountAtCapture: number;
}

export interface MutationRecord {
  toolName: string;
  phase: TDDPhase;
  path?: string;
  command?: string;
}

export interface PhaseState {
  phase: TDDPhase;
  diffs: string[];
  mutations: MutationRecord[];
  lastTestOutput: string | null;
  lastTestFailed: boolean | null;
  recentTests: TestSignal[];
  proofCheckpoint: ProofCheckpoint | null;
  cycleCount: number;
  enabled: boolean;
  plan: string[];
  planCompleted: number;
  requestedSeam: BehaviorSeam | null;
}

export interface PhaseTransitionLog {
  from: TDDPhase;
  to: TDDPhase;
  reason: string;
  timestamp: number;
  override: boolean;
}

export interface GuidelinesConfig {
  spec: string | null;
  red: string | null;
  green: string | null;
  refactor: string | null;
  universal: string | null;
  security: string | null;
}

export interface ReviewModelRef {
  provider: string;
  model: string;
}

export interface ReviewModels {
  preflight?: ReviewModelRef;
  postflight?: ReviewModelRef;
  specClarification?: ReviewModelRef;
  specRefinement?: ReviewModelRef;
}

export interface TDDConfig {
  enabled: boolean;
  reviewModel: string | null;
  reviewProvider: string | null;
  reviewModels: ReviewModels;
  autoTransition: boolean;
  refactorTransition: "user" | "agent" | "timeout";
  allowReadInAllPhases: boolean;
  maxDiffsInContext: number;
  persistPhase: boolean;
  startInSpecMode: boolean;
  /**
   * If true, every fresh session starts with TDD active (legacy behavior).
   * If false (default), sessions start dormant — TDD only starts when the
   * agent calls tdd_start, when a configured lifecycle hook fires, or when
   * the user runs /tdd on or /tdd with a feature/bug request.
   */
  defaultStarted: boolean;
  /**
   * If true (default), transitioning out of SPEC into RED automatically fires
   * the preflight check first. If preflight finds issues, the transition is
   * blocked (or warned, depending on the dialog response) so the spec gets
   * tightened before the cycle starts.
   */
  runPreflightOnRed: boolean;
  /**
   * Tool names that auto-start TDD when called. Useful for hooking task or
   * feature management tools (e.g., manifest's start_feature) into the TDD
   * lifecycle without requiring the agent to remember tdd_start.
   */
  startOnTools: string[];
  /**
   * Tool names that auto-end TDD when called. Pair with startOnTools to
   * close out a feature lifecycle (e.g., manifest's complete_feature).
   */
  endOnTools: string[];
  guidelines: GuidelinesConfig;
}
