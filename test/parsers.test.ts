import { describe, expect, it } from "vitest";
import { defaultParsers, formatDuration, parseTestOutput } from "../src/parsers.js";

// Helper: run a single parser against a line
function parseLine(parserName: string, line: string) {
  const parser = defaultParsers.find((p) => p.name === parserName);
  if (!parser) throw new Error(`Unknown parser: ${parserName}`);
  return parser.parseLine(line);
}

describe("individual parsers", () => {
  describe("jest-vitest", () => {
    it("parses passing test with checkmark", () => {
      expect(parseLine("jest-vitest", "✓ adds two numbers")).toEqual({ name: "adds two numbers", passed: true });
    });

    it("parses passing test with duration", () => {
      expect(parseLine("jest-vitest", "✓ adds two numbers (5ms)")).toEqual({ name: "adds two numbers", passed: true });
    });

    it("parses failing test with cross", () => {
      expect(parseLine("jest-vitest", "✗ adds two numbers")).toEqual({ name: "adds two numbers", passed: false });
    });

    it("returns null for non-matching line", () => {
      expect(parseLine("jest-vitest", "PASS src/math.test.ts")).toBeNull();
    });
  });

  describe("go", () => {
    it("parses passing test", () => {
      expect(parseLine("go", "--- PASS: TestAdd (0.00s)")).toEqual({ name: "TestAdd", passed: true });
    });

    it("parses failing test", () => {
      expect(parseLine("go", "--- FAIL: TestAdd (0.01s)")).toEqual({ name: "TestAdd", passed: false });
    });

    it("returns null for summary line", () => {
      expect(parseLine("go", "PASS")).toBeNull();
    });
  });

  describe("pytest", () => {
    it("parses passing test", () => {
      expect(parseLine("pytest", "test_math.py::test_add PASSED")).toEqual({
        name: "test_math.py::test_add",
        passed: true,
      });
    });

    it("parses failing test", () => {
      expect(parseLine("pytest", "test_math.py::test_add FAILED")).toEqual({
        name: "test_math.py::test_add",
        passed: false,
      });
    });

    it("returns null for collection line", () => {
      expect(parseLine("pytest", "collected 5 items")).toBeNull();
    });
  });

  describe("cargo", () => {
    it("parses passing test", () => {
      expect(parseLine("cargo", "test math::tests::test_add ... ok")).toEqual({
        name: "math::tests::test_add",
        passed: true,
      });
    });

    it("parses failing test", () => {
      expect(parseLine("cargo", "test math::tests::test_add ... FAILED")).toEqual({
        name: "math::tests::test_add",
        passed: false,
      });
    });
  });

  describe("tap", () => {
    it("parses passing test", () => {
      expect(parseLine("tap", "ok 1 - should add numbers")).toEqual({ name: "should add numbers", passed: true });
    });

    it("parses failing test", () => {
      expect(parseLine("tap", "not ok 2 - should handle zero")).toEqual({ name: "should handle zero", passed: false });
    });
  });

  describe("rspec", () => {
    it("parses failing test", () => {
      expect(parseLine("rspec", "adds two numbers (FAILED - 1)")).toEqual({ name: "adds two numbers", passed: false });
    });

    it("returns null for passing test line (no explicit pass marker)", () => {
      expect(parseLine("rspec", "  adds two numbers")).toBeNull();
    });
  });

  describe("dotnet", () => {
    it("parses passing test", () => {
      expect(parseLine("dotnet", "  Passed MathTests.TestAdd")).toEqual({ name: "MathTests.TestAdd", passed: true });
    });

    it("parses failing test", () => {
      expect(parseLine("dotnet", "  Failed MathTests.TestAdd")).toEqual({ name: "MathTests.TestAdd", passed: false });
    });
  });

  describe("jest-vitest with bracket duration (Bun)", () => {
    it("parses passing test with bracket duration", () => {
      expect(parseLine("jest-vitest", "✓ adds two numbers [0.06ms]")).toEqual({
        name: "adds two numbers",
        passed: true,
      });
    });

    it("parses failing test with bracket duration", () => {
      expect(parseLine("jest-vitest", "✗ adds two numbers [1ms]")).toEqual({ name: "adds two numbers", passed: false });
    });
  });

  describe("python-unittest", () => {
    it("parses passing test", () => {
      expect(parseLine("python-unittest", "test_add (test_math.TestMath) ... ok")).toEqual({
        name: "test_math.TestMath.test_add",
        passed: true,
      });
    });

    it("parses failing test", () => {
      expect(parseLine("python-unittest", "test_divide (test_math.TestMath) ... FAIL")).toEqual({
        name: "test_math.TestMath.test_divide",
        passed: false,
      });
    });

    it("parses error test", () => {
      expect(parseLine("python-unittest", "test_divide (test_math.TestMath) ... ERROR")).toEqual({
        name: "test_math.TestMath.test_divide",
        passed: false,
      });
    });
  });

  describe("minitest", () => {
    it("parses passing test", () => {
      expect(parseLine("minitest", "TestMath#test_add = 0.00 s = .")).toEqual({
        name: "TestMath#test_add",
        passed: true,
      });
    });

    it("parses failing test", () => {
      expect(parseLine("minitest", "TestMath#test_add = 0.01 s = F")).toEqual({
        name: "TestMath#test_add",
        passed: false,
      });
    });

    it("parses error test", () => {
      expect(parseLine("minitest", "TestMath#test_add = 0.00 s = E")).toEqual({
        name: "TestMath#test_add",
        passed: false,
      });
    });
  });

  describe("gradle", () => {
    it("parses passing test", () => {
      expect(parseLine("gradle", "MathTest > testAdd() PASSED")).toEqual({ name: "MathTest.testAdd()", passed: true });
    });

    it("parses failing test", () => {
      expect(parseLine("gradle", "MathTest > testDivide() FAILED")).toEqual({
        name: "MathTest.testDivide()",
        passed: false,
      });
    });
  });

  describe("xctest", () => {
    it("parses passing test", () => {
      expect(parseLine("xctest", "Test Case '-[MathTests testAdd]' passed (0.001 seconds).")).toEqual({
        name: "MathTests.testAdd",
        passed: true,
      });
    });

    it("parses failing test", () => {
      expect(parseLine("xctest", "Test Case '-[MathTests testDivide]' failed (0.002 seconds).")).toEqual({
        name: "MathTests.testDivide",
        passed: false,
      });
    });
  });

  describe("phpunit", () => {
    it("parses passing test", () => {
      expect(parseLine("phpunit", "✔ It adds two numbers")).toEqual({ name: "It adds two numbers", passed: true });
    });

    it("parses failing test", () => {
      expect(parseLine("phpunit", "✘ It adds two numbers")).toEqual({ name: "It adds two numbers", passed: false });
    });
  });

  describe("exunit", () => {
    it("parses passing test", () => {
      expect(parseLine("exunit", "  * test adds two numbers (0.1ms)")).toEqual({
        name: "adds two numbers",
        passed: true,
      });
    });

    it("parses passing test without duration", () => {
      expect(parseLine("exunit", "  * test adds two numbers")).toEqual({ name: "adds two numbers", passed: true });
    });
  });
});

describe("parseTestOutput", () => {
  describe("with vitest output", () => {
    const output = [
      "✓ adds two numbers (2ms)",
      "✓ subtracts two numbers (1ms)",
      "✗ divides by zero",
      "",
      "Test Files  1 passed (1)",
      "Tests  2 passed | 1 failed",
      "Duration  150ms",
    ].join("\n");

    it("parses individual test results", () => {
      const summary = parseTestOutput(output);
      expect(summary.tests).toHaveLength(3);
      expect(summary.tests[0]).toEqual({ name: "adds two numbers", passed: true });
      expect(summary.tests[2]).toEqual({ name: "divides by zero", passed: false });
    });

    it("counts passed and failed from parsed tests", () => {
      const summary = parseTestOutput(output);
      expect(summary.passed).toBe(2);
      expect(summary.failed).toBe(1);
    });

    it("extracts duration", () => {
      const summary = parseTestOutput(output);
      expect(summary.duration).toBe("150ms");
    });
  });

  describe("with go test output", () => {
    const output = [
      "=== RUN   TestAdd",
      "--- PASS: TestAdd (0.00s)",
      "=== RUN   TestDivide",
      "--- FAIL: TestDivide (0.01s)",
      "FAIL",
      "exit status 1",
    ].join("\n");

    it("parses pass and fail", () => {
      const summary = parseTestOutput(output);
      expect(summary.tests).toHaveLength(2);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
    });
  });

  describe("with summary-only output (no per-test lines)", () => {
    const output = "Tests: 5 passed, 2 failed\nTime: 3.2s";

    it("falls back to summary regex", () => {
      const summary = parseTestOutput(output);
      expect(summary.tests).toHaveLength(0);
      expect(summary.passed).toBe(5);
      expect(summary.failed).toBe(2);
    });

    it("extracts duration from Time: pattern", () => {
      const summary = parseTestOutput(output);
      expect(summary.duration).toBe("3.2s");
    });
  });

  describe("with ANSI escape codes", () => {
    it("strips ANSI before parsing", () => {
      const output = "\x1b[32m✓\x1b[0m adds numbers (2ms)";
      const summary = parseTestOutput(output);
      expect(summary.tests).toHaveLength(1);
      expect(summary.tests[0].passed).toBe(true);
    });
  });

  describe("with empty output", () => {
    it("returns zero counts", () => {
      const summary = parseTestOutput("");
      expect(summary.tests).toHaveLength(0);
      expect(summary.passed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.duration).toBeUndefined();
    });
  });

  describe("with Finished in duration (RSpec/ExUnit)", () => {
    it("extracts duration", () => {
      const output = "Finished in 0.42 seconds";
      const summary = parseTestOutput(output);
      expect(summary.duration).toBe("0.42 seconds");
    });
  });
});

describe("formatDuration", () => {
  it("formats milliseconds under 1000", () => {
    expect(formatDuration(150)).toBe("150ms");
  });

  it("formats seconds at 1000ms", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });

  it("formats seconds above 1000ms", () => {
    expect(formatDuration(3456)).toBe("3.5s");
  });
});
