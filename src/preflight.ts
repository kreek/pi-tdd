import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TDDConfig, TDDPhase } from "./types.js";
import { loadPrompt } from "./prompt-loader.js";
import { extractJSON, runReview } from "./reviews.js";
import {
  classifyChecklistItemSeam,
  classifyRequestedSeam,
  isBusinessRequestSeam,
  seamLabel,
  seamSatisfiesRequest,
  summarizeChecklistSeams,
} from "./seams.js";

/**
 * Preflight (priming the cycle) — runs before transitioning out of SPEC into
 * RED. Validates that the spec checklist is good enough to drive a clean
 * RED → GREEN → REFACTOR loop. Surfaces ambiguity, gaps, and items that
 * cannot be expressed as a failing test.
 */

export interface PreflightInput {
  /** The spec checklist items the user/agent has accumulated in SPEC. */
  spec: string[];
  /** Optional user story / request text for context. */
  userStory?: string;
  /** Current checklist position that RED would start proving. */
  planCompleted?: number;
}

export interface PreflightIssue {
  /** 1-based index of the spec item the issue applies to, or null for general issues. */
  itemIndex: number | null;
  /** Short description of the problem. */
  message: string;
}

export type PreflightResult =
  | { ok: true; reason: string }
  | { ok: false; issues: PreflightIssue[]; reason: string };

export function shouldRunPreflightOnRedEntry(
  currentPhase: TDDPhase,
  enabled: boolean,
  targetPhase: TDDPhase,
  config: Pick<TDDConfig, "runPreflightOnRed">
): boolean {
  return config.runPreflightOnRed && targetPhase === "RED" && (!enabled || currentPhase !== "RED");
}

const SYSTEM_PROMPT = loadPrompt("preflight-system");

export function buildPreflightUserPrompt(input: PreflightInput): string {
  const seamSummary = summarizeChecklistSeams(
    input.spec,
    classifyRequestedSeam(input.userStory, input.spec),
    input.planCompleted ?? 0
  );

  return [
    ...userStoryLines(input.userStory),
    ...specChecklistLines(input.spec),
    "",
    ...seamContextLines(seamSummary),
    "",
    "Choose the cheapest honest first proof level: unit or integration.",
    "For route, API, redirect, page, and form requests, RED should start at that outer seam rather than at helper, schema, or service checks.",
    "",
    "Decide whether this spec is ready to start a TDD cycle.",
    "",
    ...preflightResponseLines(),
  ].join("\n");
}

export async function runPreflight(
  input: PreflightInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<PreflightResult> {
  if (input.spec.length === 0) {
    return {
      ok: false,
      reason: "Spec checklist is still empty. Add at least one acceptance criterion before starting RED.",
      issues: [
        { itemIndex: null, message: "No spec items yet to drive the cycle." },
      ],
    };
  }

  const runtimeIssues = seamAlignmentIssues(input);
  if (runtimeIssues.length > 0) {
    return {
      ok: false,
      reason: "The checklist is not aligned with the seam the request actually needs to prove first.",
      issues: runtimeIssues,
    };
  }

  const raw = await runReview(
    {
      label: "preflight",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPreflightUserPrompt(input),
    },
    ctx,
    config
  );

  return parsePreflightResponse(raw.text);
}

export function parsePreflightResponse(raw: string): PreflightResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Preflight response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    throw new Error("Preflight response did not contain an `ok` field");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.ok !== "boolean") {
    throw new Error("Preflight response `ok` field must be boolean");
  }

  const ok = obj.ok;
  const reason = typeof obj.reason === "string" ? obj.reason : "";

  if (ok) {
    return { ok: true, reason };
  }

  const rawIssues = Array.isArray(obj.issues) ? obj.issues : [];
  const issues: PreflightIssue[] = rawIssues
    .map((issue): PreflightIssue | null => {
      if (typeof issue !== "object" || issue === null) return null;
      const i = issue as Record<string, unknown>;
      const itemIndex =
        typeof i.itemIndex === "number"
          ? i.itemIndex
          : i.itemIndex === null
            ? null
            : null;
      const message = typeof i.message === "string" ? i.message : "";
      if (!message) return null;
      return { itemIndex, message };
    })
    .filter((issue): issue is PreflightIssue => issue !== null);

  return { ok: false, reason, issues };
}

export function formatPreflightResult(result: PreflightResult): string {
  if (result.ok) {
    return `RED readiness OK — ${result.reason}`;
  }

  const lines = [`RED readiness suggests ${result.issues.length} refinement(s): ${result.reason}`];
  for (const issue of result.issues) {
    const prefix = issue.itemIndex === null ? "  •" : `  ${issue.itemIndex}.`;
    lines.push(`${prefix} ${issue.message}`);
  }
  return lines.join("\n");
}

function userStoryLines(userStory: string | undefined): string[] {
  if (!userStory?.trim()) {
    return [];
  }

  return ["User story / request:", userStory.trim(), ""];
}

function specChecklistLines(spec: string[]): string[] {
  const items = spec.length === 0
    ? ["(empty)"]
    : spec.map((item, index) => `${index + 1}. ${item}`);

  return ["Spec checklist (one item per line):", ...items];
}

function seamContextLines(summary: ReturnType<typeof summarizeChecklistSeams>): string[] {
  return [
    `Requested seam: ${seamLabel(summary.requested)}`,
    `Current RED target seam: ${summary.current ? seamLabel(summary.current) : "none"}`,
    `Checklist seam mix: HTTP ${summary.counts.business_http}, UI ${summary.counts.business_ui}, domain ${summary.counts.business_domain}, support ${summary.counts.internal_support}`,
  ];
}

function seamAlignmentIssues(input: PreflightInput): PreflightIssue[] {
  const requested = classifyRequestedSeam(input.userStory, input.spec);
  if (!isBusinessRequestSeam(requested)) {
    return [];
  }

  const matchingItems = input.spec
    .map((item, index) => ({ index, seam: classifyChecklistItemSeam(item) }))
    .filter((entry) => seamSatisfiesRequest(requested, entry.seam));
  const currentIndex = activeIndex(input.spec.length, input.planCompleted ?? 0);
  const currentItem = input.spec[currentIndex] ?? null;
  const currentSeam = currentItem ? classifyChecklistItemSeam(currentItem) : "unknown";
  const issues: PreflightIssue[] = [];

  if (matchingItems.length === 0) {
    issues.push({
      itemIndex: null,
      message:
        `The checklist never reaches the ${seamLabel(requested)}. Start with a user-visible slice at that seam before helper, schema, service, or migration work.`,
    });
  }

  if (currentItem && !seamSatisfiesRequest(requested, currentSeam)) {
    issues.push({
      itemIndex: currentIndex + 1,
      message:
        `Start RED at the ${seamLabel(requested)} for this request. This item is ${seamLabel(currentSeam)} and should be support work, not the proving slice.`,
    });
  }

  return issues;
}

function activeIndex(length: number, planCompleted: number): number {
  if (length === 0) {
    return 0;
  }
  if (planCompleted < 0) {
    return 0;
  }
  if (planCompleted >= length) {
    return length - 1;
  }
  return planCompleted;
}

function preflightResponseLines(): string[] {
  return [
    "Respond with one of:",
    `{"ok": true, "reason": "short explanation of why it's ready"}`,
    `{"ok": false, "reason": "short overall explanation", "issues": [{"itemIndex": 1, "message": "..."}, {"itemIndex": null, "message": "general gap"}]}`,
    "",
    "itemIndex is the 1-based position of the spec item, or null for issues that span the whole spec.",
  ];
}
