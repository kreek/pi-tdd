import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads static prompt text from the project-root `prompts/` directory.
 *
 * Prompts are stored as `.md` files so they can be edited as real markdown
 * without escape hazards or awkward diffs. They are read synchronously at
 * module-init time (matching the `readFileSync` pattern used in config.ts).
 *
 * The path resolves correctly from both runtime entry points:
 *   - src/prompts.ts  (pi extension loads TS source directly)
 *   - dist/prompts.js (npm library consumers load compiled output)
 * Both locations are siblings of `prompts/` under the package root, so
 * `../prompts/` works uniformly.
 */
const PROMPTS_BASE = new URL("../prompts/", import.meta.url);

export function loadPrompt(name: string): string {
  const url = new URL(`${name}.md`, PROMPTS_BASE);
  return readFileSync(fileURLToPath(url), "utf8").trimEnd();
}
