import { describe, expect, it } from "vitest";

import { evaluateTestResult, shouldRunTests } from "../src/tdd-state.js";

describe("shouldRunTests", () => {
  it("skips config files in every phase", () => {
    expect(shouldRunTests("specifying", "package.json")).toBe(false);
    expect(shouldRunTests("implementing", "tsconfig.json")).toBe(false);
    expect(shouldRunTests("refactoring", "vitest.config.ts")).toBe(false);
  });

  it("only auto-runs during specifying for test files", () => {
    expect(shouldRunTests("specifying", "src/math.test.ts")).toBe(true);
    expect(shouldRunTests("specifying", "src/math.ts")).toBe(false);
  });

  it("runs after production edits outside specifying", () => {
    expect(shouldRunTests("implementing", "src/math.ts")).toBe(true);
    expect(shouldRunTests("refactoring", "src/math.ts")).toBe(true);
  });
});

describe("evaluateTestResult", () => {
  it("keeps specifying active for missing-module failures and allows stubs", () => {
    const result = evaluateTestResult({
      output: "Error: Cannot find module './calculator'",
      passed: false,
      phase: "specifying",
    });

    expect(result.nextPhase).toBeUndefined();
    expect(result.stubAllowed).toBe(true);
    expect(result.testEvidenceObserved).toBe(false);
    expect(result.appendText).toContain("You may now create a minimal stub");
  });

  it("moves from specifying to implementing after a failing assertion", () => {
    const result = evaluateTestResult({
      output: " FAIL  src/math.test.ts\n✗ adds two numbers",
      passed: false,
      phase: "specifying",
    });

    expect(result.nextPhase).toBe("implementing");
    expect(result.stubAllowed).toBe(false);
    expect(result.testEvidenceObserved).toBe(true);
  });

  it("moves from implementing to refactoring after a passing run", () => {
    const result = evaluateTestResult({
      durationMs: 1250,
      output: "✓ adds two numbers",
      passed: true,
      phase: "implementing",
    });

    expect(result.nextPhase).toBe("refactoring");
    expect(result.summary.duration).toBe("1.3s");
    expect(result.appendText).toContain("[TDD IMPLEMENTING] Tests PASS");
  });
});
