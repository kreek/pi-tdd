import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PhaseState, TDDConfig } from "./types.js";
import { loadPrompt } from "./prompt-loader.js";
import { extractJSON, runReview } from "./reviews.js";

/**
 * Postflight — lightweight sanity check after the cycle reaches green.
 * Checks for gamed tests, code quality issues, and proof drift. Does NOT
 * try to map spec items to individual tests (it can't see test source).
 *
 * Auto-triggered on every end path (tdd_stop tool, /tdd off
 * command, and endOnTools lifecycle hooks) when there is real evidence
 * to review — see maybeRunPostflightOnEnd in engagement.ts.
 */

export interface PostflightInput {
  state: PhaseState;
  /** Optional user story / request text for context. */
  userStory?: string;
}

export interface PostflightGap {
  /** 1-based index of the spec item the gap applies to, or null for general gaps. */
  itemIndex: number | null;
  /** Short description of the gap. */
  message: string;
}

export type PostflightResult =
  | { ok: true; reason: string }
  | { ok: false; gaps: PostflightGap[]; reason: string };

const SYSTEM_PROMPT = loadPrompt("postflight-system");

export function buildPostflightUserPrompt(input: PostflightInput): string {
  const { state, userStory } = input;
  return [
    ...userStoryLines(userStory),
    ...specLines(state),
    "",
    ...testEvidenceLines(state),
    "",
    ...proofCheckpointLines(state),
    "",
    ...recentTestLines(state),
    "",
    ...diffLines(state),
    ...responseLines(),
  ].join("\n");
}

export async function runPostflight(
  input: PostflightInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<PostflightResult> {
  if (input.state.lastTestFailed === true) {
    return {
      ok: false,
      reason: "Last test run failed. Get the cycle to green before running postflight.",
      gaps: [
        { itemIndex: null, message: "Tests are not currently passing." },
      ],
    };
  }

  const raw = await runReview(
    {
      label: "postflight",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPostflightUserPrompt(input),
    },
    ctx,
    config
  );

  return parsePostflightResponse(raw.text);
}

export function parsePostflightResponse(raw: string): PostflightResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Postflight response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    throw new Error("Postflight response did not contain an `ok` field");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.ok !== "boolean") {
    throw new Error("Postflight response `ok` field must be boolean");
  }

  const ok = obj.ok;
  const reason = typeof obj.reason === "string" ? obj.reason : "";

  if (ok) {
    return { ok: true, reason };
  }

  const rawGaps = Array.isArray(obj.gaps) ? obj.gaps : [];
  const gaps: PostflightGap[] = rawGaps
    .map((gap): PostflightGap | null => {
      if (typeof gap !== "object" || gap === null) return null;
      const g = gap as Record<string, unknown>;
      const itemIndex =
        typeof g.itemIndex === "number"
          ? g.itemIndex
          : null;
      const message = typeof g.message === "string" ? g.message : "";
      if (!message) return null;
      return { itemIndex, message };
    })
    .filter((gap): gap is PostflightGap => gap !== null);

  return { ok: false, reason, gaps };
}

export function formatPostflightResult(result: PostflightResult): string {
  if (result.ok) {
    return `Post-flight OK — ${result.reason}`;
  }

  const lines = [`Post-flight found ${result.gaps.length} issue(s): ${result.reason}`];
  for (const gap of result.gaps) {
    lines.push(`  • ${gap.message}`);
  }
  return lines.join("\n");
}

function userStoryLines(userStory: string | undefined): string[] {
  if (!userStory?.trim()) {
    return [];
  }

  return ["User story / request:", userStory.trim(), ""];
}

function specLines(state: PhaseState): string[] {
  if (state.plan.length === 0) {
    return ["(no spec checklist was set)"];
  }

  return [
    "Spec checklist:",
    ...state.plan.map((item, index) => `${index + 1}. ${item}`),
  ];
}

function testEvidenceLines(state: PhaseState): string[] {
  const lines: string[] = [];

  if (state.lastTestFailed !== null) {
    lines.push(`Last test result: ${state.lastTestFailed ? "FAILED" : "PASSED"}`);
  }
  if (state.lastTestOutput) {
    lines.push("Last test output (truncated):");
    lines.push(truncateFromEnd(state.lastTestOutput, 1500));
  }

  return lines;
}

function recentTestLines(state: PhaseState): string[] {
  if (state.recentTests.length === 0) {
    return [];
  }

  return [
    "Test runs captured in this cycle:",
    ...state.recentTests.map(
      (test, index) =>
        `${index + 1}. ${test.failed ? "FAIL" : "PASS"} | ${test.command}`
    ),
  ];
}

function proofCheckpointLines(state: PhaseState): string[] {
  if (!state.proofCheckpoint) {
    return [];
  }

  const checkpoint = state.proofCheckpoint;
  const lines = [
    "Proof checkpoint (first failing test in RED):",
    `Command: ${checkpoint.command}`,
  ];

  if (checkpoint.testFiles.length > 0) {
    lines.push(`Test files: ${checkpoint.testFiles.join(", ")}`);
  }

  const driftFiles = changedProofFilesAfterCheckpoint(state);
  if (driftFiles.length > 0) {
    lines.push(`Proof files changed after checkpoint: ${driftFiles.join(", ")}`);
  }

  return lines;
}

function diffLines(state: PhaseState): string[] {
  if (state.diffs.length === 0) {
    return [];
  }

  return [
    "Recent mutations during the cycle:",
    ...state.diffs.map((diff) => `  - ${diff}`),
    "",
  ];
}

function responseLines(): string[] {
  return [
    "Check for gamed tests, code quality issues, or proof drift.",
    "Return ok: true unless you see clear evidence of problems.",
    "",
    "Respond with one of:",
    `{"ok": true, "reason": "short summary"}`,
    `{"ok": false, "reason": "short summary", "gaps": [{"itemIndex": null, "message": "..."}]}`,
  ];
}

function truncateFromEnd(value: string, max: number): string {
  return value.length > max ? `...${value.slice(-max)}` : value;
}

function changedProofFilesAfterCheckpoint(state: PhaseState): string[] {
  const checkpoint = state.proofCheckpoint;
  if (!checkpoint || checkpoint.testFiles.length === 0) {
    return [];
  }

  const checkpointFiles = new Set(checkpoint.testFiles);
  return [...new Set(
    state.mutations
      .slice(checkpoint.mutationCountAtCapture)
      .map((mutation) => mutation.path)
      .filter((path): path is string => !!path && checkpointFiles.has(path))
  )];
}
