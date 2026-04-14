import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { stageTrialPrd } from "../workspace.js";

describe("stageTrialPrd", () => {
  it("copies the trial PRD into the run workspace", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tdd-workspace-"));
    const trialDir = path.join(rootDir, "trial");
    const workDir = path.join(rootDir, "work");
    const prdFile = "docs/PRD.md";

    fs.mkdirSync(path.join(trialDir, "docs"), { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(trialDir, prdFile), "# Trial PRD\n");

    const stagedPath = stageTrialPrd(trialDir, workDir, prdFile);

    expect(stagedPath).toBe(path.join(workDir, prdFile));
    expect(fs.readFileSync(stagedPath, "utf-8")).toBe("# Trial PRD\n");
  });

  it("throws when the trial PRD is missing", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tdd-workspace-"));
    const trialDir = path.join(rootDir, "trial");
    const workDir = path.join(rootDir, "work");

    fs.mkdirSync(trialDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    expect(() => stageTrialPrd(trialDir, workDir, "PRD.md")).toThrow(/Missing trial PRD/);
  });
});
