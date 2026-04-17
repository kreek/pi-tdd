import { isConfigFile, isTestFile } from "./file-classification.js";
import { formatDuration, parseTestOutput, type TestSummary } from "./parsers.js";
import type { Phase } from "./prompt.js";

const IMPORT_ERROR_PATTERNS = [
  "Cannot find module",
  "Module not found",
  "ModuleNotFoundError",
  "ImportError",
  "unresolved import",
  "cannot find package",
  "no required module",
  "Could not resolve",
];

const IMPORT_ERROR_RE = new RegExp(IMPORT_ERROR_PATTERNS.join("|"), "i");

export interface EvaluatedTestResult {
  appendText: string;
  nextPhase: Phase | undefined;
  stubAllowed: boolean;
  summary: TestSummary;
  testEvidenceObserved: boolean;
}

function isImportOnlyFailure(output: string, summary: TestSummary): boolean {
  const noTestsRan = summary.passed === 0 && summary.failed === 0 && summary.tests.length === 0;
  return noTestsRan && IMPORT_ERROR_RE.test(output);
}

export function getStringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

export function shouldRunTests(phase: Phase, filePath: string): boolean {
  if (isConfigFile(filePath)) return false;

  switch (phase) {
    case "specifying":
      return isTestFile(filePath);
    case "implementing":
    case "refactoring":
      return true;
    default:
      return false;
  }
}

export function evaluateTestResult(params: {
  durationMs?: number;
  output: string;
  passed: boolean;
  phase: Phase;
}): EvaluatedTestResult {
  const { durationMs, output, passed, phase } = params;
  const summary = parseTestOutput(output);

  if (durationMs != null && !summary.duration) {
    summary.duration = formatDuration(durationMs);
  }

  const testEvidenceObserved = phase === "specifying" && !passed && summary.failed > 0;
  const label = `[TDD ${phase.toUpperCase()}] Tests ${passed ? "PASS" : "FAIL"}`;
  let appendText = `\n${label}:\n${output}`;
  let nextPhase: Phase | undefined;
  let stubAllowed = false;

  if (phase === "specifying" && !passed && isImportOnlyFailure(output, summary)) {
    stubAllowed = true;
    appendText +=
      "\n\n[TDD HINT] Tests failed due to a missing module, not a failing assertion." +
      " You may now create a minimal stub (empty class/function with the right exports)" +
      " so the tests can load and fail on actual behavioral assertions. Stay in SPECIFYING" +
      " — do not implement business logic yet. The stub allowance will clear after the next test run.";
  } else if (phase === "specifying" && !passed) {
    nextPhase = "implementing";
  } else if (phase === "implementing" && passed) {
    nextPhase = "refactoring";
  }

  return { appendText, nextPhase, stubAllowed, summary, testEvidenceObserved };
}
