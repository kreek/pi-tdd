import { describe, expect, it } from "vitest";

// Mirror the regex from src/index.ts — tests verify the pattern covers all conventions
const TEST_FILE_RE = /\.test\.|\.spec\.|_test\.|_spec\.|(?:^|\/)__tests__\/|(?:^|\/)tests?\/|(?:^|\/|\\)test_[^/\\]*\./;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

describe("isTestFile", () => {
  describe("standard infix patterns", () => {
    it.each(["src/calc.test.ts", "src/calc.spec.ts", "src/calc_test.go", "src/calc_spec.rb"])("matches %s", (p) =>
      expect(isTestFile(p)).toBe(true));
  });

  describe("test directory patterns", () => {
    it.each([
      "test/calc.ts",
      "tests/todo_cli.rs",
      "__tests__/calc.js",
      "src/__tests__/helper.ts",
      "test/nested/deep.ts",
      "tests/integration/api.rs",
    ])("matches %s", (p) => expect(isTestFile(p)).toBe(true));
  });

  describe("Python test_ prefix", () => {
    it.each(["test_word_frequency.py", "tests/test_word_frequency.py", "src/test_calc.py"])("matches %s", (p) =>
      expect(isTestFile(p)).toBe(true));
  });

  describe("production files", () => {
    it.each([
      "src/calc.ts",
      "src/main.rs",
      "src/lib.rs",
      "src/word_frequency.py",
      "src/testing_utils.py",
      "src/contest.ts",
      "src/latest.go",
    ])("does not match %s", (p) => expect(isTestFile(p)).toBe(false));
  });
});
