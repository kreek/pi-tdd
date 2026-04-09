export type TDDPhase = "SPEC" | "RED" | "GREEN" | "REFACTOR";

export interface PhaseState {
  phase: TDDPhase;
  diffs: string[];
  lastTestOutput: string | null;
  lastTestFailed: boolean | null;
  cycleCount: number;
  enabled: boolean;
  plan: string[];
  planCompleted: number;
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

export interface TDDConfig {
  enabled: boolean;
  judgeModel: string | null;
  judgeProvider: string | null;
  autoTransition: boolean;
  refactorTransition: "user" | "agent" | "timeout";
  allowReadInAllPhases: boolean;
  temperature: number;
  maxDiffsInContext: number;
  persistPhase: boolean;
  startInSpecMode: boolean;
  guidelines: GuidelinesConfig;
}

export interface JudgeVerdict {
  allowed: boolean;
  reason: string;
}

export interface TransitionVerdict {
  transition: TDDPhase | null;
  reason: string;
}

export interface PersistedTddState {
  phase: TDDPhase;
  diffs: string[];
  lastTestOutput: string | null;
  lastTestFailed: boolean | null;
  cycleCount: number;
  enabled: boolean;
  plan: string[];
  planCompleted: number;
}

export interface TestSignal {
  command: string;
  output: string;
  failed: boolean;
}
