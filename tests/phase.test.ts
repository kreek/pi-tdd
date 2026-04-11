import { describe, expect, it } from "vitest";
import { PhaseStateMachine } from "../src/phase.ts";

describe("PhaseStateMachine", () => {
  it("increments cycleCount only on REFACTOR to RED", () => {
    const machine = new PhaseStateMachine({ phase: "REFACTOR", cycleCount: 2 });

    machine.transitionTo("RED", "next slice");
    expect(machine.cycleCount).toBe(3);

    machine.transitionTo("GREEN", "manual");
    expect(machine.cycleCount).toBe(3);
  });

  it("reports SPEC as the next phase target for RED only through the cycle start", () => {
    const machine = new PhaseStateMachine({ phase: "SPEC" });
    expect(machine.nextPhase()).toBe("RED");
  });

  it("tracks recent test evidence and clears it when a new RED cycle starts", () => {
    const machine = new PhaseStateMachine({ phase: "GREEN", plan: ["persist settings"] });

    machine.recordMutation("edit", "tests/settings.integration.test.ts");
    machine.recordTestResult("1 failed", true, "npm run test:unit", "unit");
    machine.captureProofCheckpoint(
      { command: "npm run test:unit", output: "1 failed", failed: true, level: "unit" },
      "npm:test"
    );
    machine.recordTestResult("1 passed", false, "npm run test:integration", "integration");

    expect(machine.getSnapshot().recentTests).toEqual([
      {
        command: "npm run test:unit",
        output: "1 failed",
        failed: true,
        level: "unit",
      },
      {
        command: "npm run test:integration",
        output: "1 passed",
        failed: false,
        level: "integration",
      },
    ]);
    expect(machine.getSnapshot().proofCheckpoint).toEqual({
      itemIndex: null,
      item: null,
      seam: "unknown",
      command: "npm run test:unit",
      commandFamily: "npm:test",
      level: "unit",
      testFiles: ["tests/settings.integration.test.ts"],
      mutationCountAtCapture: 1,
    });

    machine.transitionTo("REFACTOR", "green reached");
    machine.transitionTo("RED", "next slice");

    expect(machine.lastTestFailed).toBeNull();
    expect(machine.lastTestOutput).toBeNull();
    expect(machine.getSnapshot().recentTests).toEqual([]);
    expect(machine.getSnapshot().mutations).toEqual([]);
    expect(machine.getSnapshot().proofCheckpoint).toBeNull();
  });

  it("keeps checkpoint test files in sync when the proving test file is renamed", () => {
    const machine = new PhaseStateMachine({
      phase: "REFACTOR",
      plan: ["persist settings"],
      proofCheckpoint: {
        itemIndex: 1,
        item: "persist settings",
        seam: "business_http",
        command: "npm run test:integration -- tests/http/settings.spec.ts",
        commandFamily: "npm:test:integration",
        level: "integration",
        testFiles: ["tests/http/settings.spec.ts"],
        mutationCountAtCapture: 1,
      },
    });

    machine.recordMutation(
      "bash",
      undefined,
      "mv tests/http/settings.spec.ts tests/http/api-settings.spec.ts"
    );

    expect(machine.getSnapshot().proofCheckpoint?.testFiles).toEqual([
      "tests/http/api-settings.spec.ts",
    ]);
  });
});
