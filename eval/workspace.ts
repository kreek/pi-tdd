import * as fs from "node:fs";
import * as path from "node:path";

export function stageTrialPrd(trialDir: string, workDir: string, prdFile: string): string {
  const sourcePath = path.join(trialDir, prdFile);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing trial PRD: ${sourcePath}`);
  }

  const destinationPath = path.join(workDir, prdFile);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}
