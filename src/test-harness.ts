import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isTestCommand } from "./transition.js";

const BUILT_IN_TEST_STACK_MARKERS = [
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "deno.jsonc",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];

const TEST_HARNESS_MARKERS = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
  "jest.config.ts",
  "jest.config.js",
  "jest.config.mjs",
  "pytest.ini",
  "tox.ini",
  ".rspec",
  "spec/spec_helper.rb",
  "conftest.py",
];

const NODE_TEST_PACKAGES = new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "uvu",
  "tap",
  "cypress",
  "@playwright/test",
]);

export function hasRunnableTestHarness(cwd: string | undefined): boolean {
  if (!cwd) {
    return true;
  }

  return (
    BUILT_IN_TEST_STACK_MARKERS.some((marker) => existsSync(join(cwd, marker))) ||
    TEST_HARNESS_MARKERS.some((marker) => existsSync(join(cwd, marker))) ||
    hasNodeTestHarness(cwd) ||
    hasPythonTestHarness(cwd) ||
    hasRubyTestHarness(cwd)
  );
}

function hasNodeTestHarness(cwd: string): boolean {
  const pkg = readJSONObject(join(cwd, "package.json"));
  if (!pkg) {
    return false;
  }

  const scripts = valuesOfRecord(pkg.scripts);
  if (scripts.some((value) => typeof value === "string" && isTestCommand(value))) {
    return true;
  }

  const packages = [
    ...keysOfRecord(pkg.dependencies),
    ...keysOfRecord(pkg.devDependencies),
    ...keysOfRecord(pkg.peerDependencies),
    ...keysOfRecord(pkg.optionalDependencies),
  ];
  return packages.some((name) => NODE_TEST_PACKAGES.has(name));
}

function hasPythonTestHarness(cwd: string): boolean {
  return (
    fileContains(join(cwd, "pyproject.toml"), /\bpytest\b/i) ||
    fileContains(join(cwd, "requirements.txt"), /\bpytest\b/i) ||
    fileContains(join(cwd, "requirements-dev.txt"), /\bpytest\b/i) ||
    fileContains(join(cwd, "setup.py"), /\bpytest\b/i)
  );
}

function hasRubyTestHarness(cwd: string): boolean {
  return fileContains(join(cwd, "Gemfile"), /\brspec\b/i);
}

function readJSONObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function fileContains(path: string, pattern: RegExp): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return pattern.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

function keysOfRecord(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.keys(value as Record<string, unknown>);
}

function valuesOfRecord(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.values(value as Record<string, unknown>);
}
