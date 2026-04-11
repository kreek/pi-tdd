import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

const ORIGINAL_HOME = process.env.HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
    return;
  }

  process.env.HOME = ORIGINAL_HOME;
});

describe("loadConfig", () => {
  it("ignores the removed temperature setting when loading config", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-tdd-home-"));
    const project = mkdtempSync(join(tmpdir(), "pi-tdd-project-"));
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    mkdirSync(join(project, ".pi"), { recursive: true });
    writeFileSync(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({
        tddGate: {
          enabled: false,
          temperature: 0.9,
        },
      })
    );

    process.env.HOME = home;

    const config = loadConfig(project) as Record<string, unknown>;

    expect(config.enabled).toBe(false);
    expect(config.temperature).toBeUndefined();
    expect(Object.hasOwn(config, "temperature")).toBe(false);
  });
});
