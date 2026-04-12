/**
 * Test output parsers for multiple frameworks.
 *
 * Each parser handles one framework's output format. The main parseTestOutput
 * function iterates all parsers per line, taking the first match.
 */

// -- Types --------------------------------------------------------------------

export interface TestResult {
  name: string;
  passed: boolean;
}

export interface TestSummary {
  tests: TestResult[];
  passed: number;
  failed: number;
  duration?: string;
}

export interface TestLineParser {
  name: string;
  parseLine(line: string): TestResult | null;
}

// -- Helpers ------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// -- Parsers ------------------------------------------------------------------

const jestVitest: TestLineParser = {
  // Covers Jest, Vitest, Mocha, Bun, AVA, Pest (PHP) — all use Unicode check/cross markers
  // Duration in parens (Xms) or brackets [Xms]
  name: "jest-vitest",
  parseLine(line) {
    let m;
    if ((m = line.match(/^[✓✔√]\s+(.+?)(?:\s+(?:\(\d+\s*m?s\)|\[\d+(?:\.\d+)?\s*m?s\]))?\s*$/))) {
      return { name: m[1], passed: true };
    }
    if ((m = line.match(/^[✗✕×]\s+(.+?)(?:\s+(?:\(\d+\s*m?s\)|\[\d+(?:\.\d+)?\s*m?s\]))?\s*$/))) {
      return { name: m[1], passed: false };
    }
    return null;
  },
};

const goTest: TestLineParser = {
  name: "go",
  parseLine(line) {
    const m = line.match(/^---\s+(PASS|FAIL):\s+(\S+)/);
    if (m) return { name: m[2], passed: m[1] === "PASS" };
    return null;
  },
};

const pytest: TestLineParser = {
  name: "pytest",
  parseLine(line) {
    const m = line.match(/^(\S+::\S+)\s+(PASSED|FAILED)/);
    if (m) return { name: m[1], passed: m[2] === "PASSED" };
    return null;
  },
};

const cargo: TestLineParser = {
  name: "cargo",
  parseLine(line) {
    const m = line.match(/^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED)/);
    if (m) return { name: m[1], passed: m[2] === "ok" };
    return null;
  },
};

const tap: TestLineParser = {
  name: "tap",
  parseLine(line) {
    const m = line.match(/^(not )?ok\s+\d+\s*-?\s*(.+)/);
    if (m) return { name: m[2].trim(), passed: !m[1] };
    return null;
  },
};

const rspec: TestLineParser = {
  name: "rspec",
  parseLine(line) {
    // RSpec verbose format: "  name (FAILED - 1)" or just "  name"
    // rspec -f documentation produces indented lines without explicit PASS markers
    let m;
    if ((m = line.match(/^(.+?)\s+\(FAILED(?:\s*-\s*\d+)?\)$/))) {
      return { name: m[1].trim(), passed: false };
    }
    return null;
  },
};

const dotnetTest: TestLineParser = {
  name: "dotnet",
  parseLine(line) {
    const m = line.match(/^\s*(Passed|Failed)\s+(\S+)/);
    if (m) return { name: m[2], passed: m[1] === "Passed" };
    return null;
  },
};

const phpunit: TestLineParser = {
  name: "phpunit",
  parseLine(line) {
    // PHPUnit verbose: ✔ testName or ✘ testName
    // Also: "  ✓ testName" or "  ✗ testName" — handled by jestVitest parser
    // PHPUnit --testdox: "✔ It does something" / "✘ It fails"
    const m = line.match(/^(✔|✘)\s+(.+)$/);
    if (m) return { name: m[2].trim(), passed: m[1] === "✔" };
    return null;
  },
};

const pythonUnittest: TestLineParser = {
  // unittest verbose: "test_name (test_module.TestClass) ... ok" / "... FAIL" / "... ERROR"
  name: "python-unittest",
  parseLine(line) {
    const m = line.match(/^(\S+)\s+\((\S+)\)\s+\.\.\.\s+(ok|FAIL|ERROR)/);
    if (m) return { name: `${m[2]}.${m[1]}`, passed: m[3] === "ok" };
    return null;
  },
};

const minitest: TestLineParser = {
  // Minitest verbose: "TestClass#test_name = 0.00 s = ." / "= F" / "= E"
  name: "minitest",
  parseLine(line) {
    const m = line.match(/^(\S+#\S+)\s+=\s+[\d.]+\s+s\s+=\s+([.FE])/);
    if (m) return { name: m[1], passed: m[2] === "." };
    return null;
  },
};

const gradle: TestLineParser = {
  // Gradle verbose: "TestClass > testName() PASSED" / "FAILED"
  name: "gradle",
  parseLine(line) {
    const m = line.match(/^(\S+)\s+>\s+(\S+)\s+(PASSED|FAILED)/);
    if (m) return { name: `${m[1]}.${m[2]}`, passed: m[3] === "PASSED" };
    return null;
  },
};

const xctest: TestLineParser = {
  // XCTest: "Test Case '-[TestClass testMethod]' passed (0.001 seconds)."
  // Swift Testing: "✔ Test \"name\" passed" — handled by jest-vitest parser
  name: "xctest",
  parseLine(line) {
    const m = line.match(/^Test Case\s+'[^']+'\s+(passed|failed)/);
    if (m) {
      const nameMatch = line.match(/Test Case\s+'(?:-\[)?(\S+)\s+(\S+?)\]?'/);
      const name = nameMatch ? `${nameMatch[1]}.${nameMatch[2]}` : line;
      return { name, passed: m[1] === "passed" };
    }
    return null;
  },
};

const elixirExUnit: TestLineParser = {
  name: "exunit",
  parseLine(line) {
    // ExUnit verbose: "  * test name (0.1ms)" — all listed tests passed
    // Failures show as a separate block, not inline
    const m = line.match(/^\s+\*\s+test\s+(.+?)(?:\s+\([\d.]+m?s\))?$/);
    if (m) return { name: m[1], passed: true };
    return null;
  },
};

// Order matters: more specific parsers first to avoid false matches
export const defaultParsers: TestLineParser[] = [
  cargo,
  goTest,
  pytest,
  pythonUnittest,
  gradle,
  dotnetTest,
  xctest,
  rspec,
  minitest,
  phpunit,
  elixirExUnit,
  tap,
  jestVitest, // last — its broad Unicode markers could match other formats
];

// -- Main parser --------------------------------------------------------------

export function parseTestOutput(raw: string, parsers: TestLineParser[] = defaultParsers): TestSummary {
  const lines = raw.split("\n").map(stripAnsi);
  const tests: TestResult[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    for (const parser of parsers) {
      const result = parser.parseLine(trimmed);
      if (result) {
        tests.push(result);
        break;
      }
    }
  }

  // Summary counts: prefer parsed tests, fall back to regex on output
  const full = lines.join("\n");
  let passed = tests.filter((t) => t.passed).length;
  let failed = tests.filter((t) => !t.passed).length;

  if (tests.length === 0) {
    const pm = full.match(/(\d+)\s+pass(?:ed|ing)?/i);
    const fm = full.match(/(\d+)\s+fail(?:ed|ing|ures?)?/i);
    if (pm) passed = parseInt(pm[1], 10);
    if (fm) failed = parseInt(fm[1], 10);
  }

  // Duration
  let duration: string | undefined;
  const dm =
    full.match(/Finished in\s+([\d.]+\s*(?:seconds?|m?s))/i) ||
    full.match(/in\s+([\d.]+\s*m?s)/i) ||
    full.match(/Time:\s*([\d.]+\s*m?s)/i) ||
    full.match(/Duration\s+([\d.]+\s*m?s)/i);
  if (dm) duration = dm[1];

  return { tests, passed, failed, duration };
}
