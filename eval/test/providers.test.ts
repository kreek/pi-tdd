import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getActiveEvalProviders,
  getSubscriptionBackedProviders,
  readPiSettings,
  validateSuiteConcurrency,
} from "../providers.js";
import type { EvalConfig } from "../types.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tdd-providers-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readPiSettings", () => {
  it("prefers the nearest project settings over the global default provider", () => {
    const homeDir = makeTempDir();
    const projectDir = makeTempDir();
    const nestedDir = path.join(projectDir, "eval");
    fs.mkdirSync(nestedDir, { recursive: true });

    writeJson(path.join(homeDir, ".pi", "agent", "settings.json"), {
      defaultProvider: "openai-codex",
    });
    writeJson(path.join(projectDir, ".pi", "settings.json"), {
      defaultProvider: "github-copilot",
    });

    expect(readPiSettings(nestedDir, homeDir)).toEqual({
      defaultProvider: "github-copilot",
    });
  });
});

describe("getActiveEvalProviders", () => {
  it("uses Pi defaults when worker and judge providers are omitted", () => {
    const homeDir = makeTempDir();
    const projectDir = makeTempDir();

    writeJson(path.join(homeDir, ".pi", "agent", "settings.json"), {
      defaultProvider: "openai-codex",
    });

    const config: EvalConfig = {
      worker: {},
      judge: {},
    };

    expect(getActiveEvalProviders(config, { startDir: projectDir, homeDir })).toEqual(["openai-codex"]);
    expect(getActiveEvalProviders(config, { noJudge: true, startDir: projectDir, homeDir })).toEqual(["openai-codex"]);
  });

  it("includes both explicit worker and judge providers", () => {
    const homeDir = makeTempDir();
    const projectDir = makeTempDir();
    const config: EvalConfig = {
      worker: { provider: "openai" },
      judge: { provider: "openai-codex" },
    };

    expect(getActiveEvalProviders(config, { startDir: projectDir, homeDir })).toEqual(["openai", "openai-codex"]);
  });
});

describe("subscription-backed providers", () => {
  it("treats oauth Anthropic auth as subscription-backed", () => {
    const homeDir = makeTempDir();
    writeJson(path.join(homeDir, ".pi", "agent", "auth.json"), {
      anthropic: { type: "oauth" },
    });

    expect(getSubscriptionBackedProviders(["anthropic", "openai"], { homeDir })).toEqual(["anthropic"]);
    expect(validateSuiteConcurrency(2, ["anthropic", "openai"], { homeDir })).toContain("anthropic");
  });

  it("does not treat Anthropic API key auth as subscription-backed", () => {
    const homeDir = makeTempDir();
    writeJson(path.join(homeDir, ".pi", "agent", "auth.json"), {
      anthropic: { type: "api_key" },
    });

    expect(getSubscriptionBackedProviders(["anthropic"], { homeDir })).toEqual([]);
    expect(validateSuiteConcurrency(2, ["anthropic"], { homeDir })).toBeUndefined();
  });

  it("always treats OAuth-only subscription providers as subscription-backed", () => {
    const homeDir = makeTempDir();

    expect(getSubscriptionBackedProviders(["openai-codex", "github-copilot"], { homeDir })).toEqual([
      "openai-codex",
      "github-copilot",
    ]);
    expect(validateSuiteConcurrency(3, ["openai-codex", "github-copilot"], { homeDir })).toContain(
      "openai-codex, github-copilot",
    );
  });
});
