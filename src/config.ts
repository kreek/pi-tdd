import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { GuidelinesConfig, ReviewModels, TDDConfig } from "./types.js";
import { resolveGuidelines } from "./guidelines.js";

const DEFAULTS: Omit<TDDConfig, "guidelines"> = {
  enabled: true,
  reviewModel: null,
  reviewProvider: null,
  reviewModels: {},
  autoTransition: true,
  refactorTransition: "user",
  allowReadInAllPhases: true,
  maxDiffsInContext: 5,
  persistPhase: true,
  startInSpecMode: false,
  defaultStarted: false,
  runPreflightOnRed: true,
  startOnTools: [],
  endOnTools: [],
};

type UserConfig = Partial<Omit<TDDConfig, "guidelines">> & {
  /** Deprecated alias for reviewProvider. */
  judgeProvider?: string | null;
  /** Deprecated alias for reviewModel. */
  judgeModel?: string | null;
  /** Deprecated removed option; ignored on load. */
  temperature?: number;
  /** Deprecated alias for defaultStarted. */
  defaultEngaged?: boolean;
  /** Deprecated alias for startOnTools. */
  engageOnTools?: string[];
  /** Deprecated alias for endOnTools. */
  disengageOnTools?: string[];
  guidelines?: Partial<GuidelinesConfig> & { plan?: string | null };
};

interface SettingsFileShape {
  tddGate?: UserConfig;
}

function readJSON(path: string): SettingsFileShape | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as SettingsFileShape;
  } catch (error) {
    console.error(`[tdd-gate] Failed to parse settings file ${path}:`, error);
    return undefined;
  }
}

function mergeGuidelines(
  base: Partial<GuidelinesConfig> | undefined,
  next: Partial<GuidelinesConfig> | undefined
): Partial<GuidelinesConfig> | undefined {
  if (!base && !next) return undefined;
  return { ...(base ?? {}), ...(next ?? {}) };
}

function mergeReviewModels(
  base: Partial<ReviewModels> | undefined,
  next: Partial<ReviewModels> | undefined
): Partial<ReviewModels> | undefined {
  if (!base && !next) return undefined;
  return { ...(base ?? {}), ...(next ?? {}) };
}

function mergeConfigLayers(
  base: UserConfig | undefined,
  next: UserConfig | undefined
): UserConfig {
  if (!base && !next) return {};
  const merged = { ...(base ?? {}), ...(next ?? {}) };
  merged.guidelines = mergeGuidelines(base?.guidelines, next?.guidelines);
  merged.reviewModels = mergeReviewModels(base?.reviewModels, next?.reviewModels);
  return merged;
}

export function loadConfig(cwd: string): TDDConfig {
  const globalSettings = readJSON(join(homedir(), ".pi", "agent", "settings.json"));
  const projectSettings = readJSON(join(cwd, ".pi", "settings.json"));

  const user = mergeConfigLayers(globalSettings?.tddGate, projectSettings?.tddGate);
  const guidelines = resolveGuidelines(user.guidelines);
  const reviewProvider = user.reviewProvider ?? user.judgeProvider;
  const reviewModel = user.reviewModel ?? user.judgeModel;
  const defaultStarted = user.defaultStarted ?? user.defaultEngaged;
  const startOnTools = user.startOnTools ?? user.engageOnTools;
  const endOnTools = user.endOnTools ?? user.disengageOnTools;
  const {
    guidelines: _ignoredGuidelines,
    judgeProvider: _ignoredJudgeProvider,
    judgeModel: _ignoredJudgeModel,
    temperature: _ignoredTemperature,
    defaultEngaged: _ignoredDefaultEngaged,
    engageOnTools: _ignoredEngageOnTools,
    disengageOnTools: _ignoredDisengageOnTools,
    ...rest
  } = user;

  return {
    ...DEFAULTS,
    ...(rest as Partial<TDDConfig>),
    reviewProvider: reviewProvider ?? DEFAULTS.reviewProvider,
    reviewModel: reviewModel ?? DEFAULTS.reviewModel,
    defaultStarted: defaultStarted ?? DEFAULTS.defaultStarted,
    startOnTools: startOnTools ?? DEFAULTS.startOnTools,
    endOnTools: endOnTools ?? DEFAULTS.endOnTools,
    guidelines,
  };
}

export { DEFAULTS };
