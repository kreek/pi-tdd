import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type { BehaviorSeam, TDDConfig } from "./types.js";
import {
  formatPreflightResult,
  runPreflight,
  type PreflightInput,
  type PreflightIssue,
  type PreflightResult,
} from "./preflight.js";
import { loadPrompt } from "./prompt-loader.js";
import { extractJSON, runReview } from "./reviews.js";
import { classifyRequestedSeam, seamLabel, supportWorkClarification } from "./seams.js";

const SPEC_REFINEMENT_SYSTEM_PROMPT = loadPrompt("spec-refinement-system");
const SPEC_CLARIFICATION_SYSTEM_PROMPT = loadPrompt("spec-clarification-system");

export interface SpecRefinementInput {
  spec: string[];
  userStory?: string;
  requestedSeam: BehaviorSeam;
  issues: PreflightIssue[];
}

export interface SpecRefinementResult {
  reason: string;
  items: string[];
  questions: string[];
}

export interface SpecClarificationResult {
  reason: string;
  questions: string[];
}

export interface RedReadinessResult {
  ok: boolean;
  requestedSeam: BehaviorSeam;
  initial: PreflightResult;
  final: PreflightResult;
  refined: boolean;
  refinedSpec: string[] | null;
  refinementReason: string | null;
  refinementError: string | null;
  clarificationQuestions: string[];
}

export async function runRedReadinessCheck(
  input: PreflightInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<RedReadinessResult> {
  const userStory = resolveUserStory(input.userStory, ctx);
  const requestedSeam = classifyRequestedSeam(userStory, input.spec);
  const supportClarification = supportWorkClarification(userStory, input.spec);
  if (supportClarification) {
    const result: PreflightResult = {
      ok: false,
      reason: supportClarification.reason,
      issues: [{ itemIndex: null, message: supportClarification.issue }],
    };
    return {
      ok: false,
      requestedSeam,
      initial: result,
      final: result,
      refined: false,
      refinedSpec: null,
      refinementReason: supportClarification.reason,
      refinementError: null,
      clarificationQuestions: supportClarification.questions,
    };
  }

  const initial = await runPreflight(
    { spec: input.spec, userStory, planCompleted: input.planCompleted },
    ctx,
    config
  );
  if (initial.ok) {
    return {
      ok: initial.ok,
      requestedSeam,
      initial,
      final: initial,
      refined: false,
      refinedSpec: null,
      refinementReason: null,
      refinementError: null,
      clarificationQuestions: [],
    };
  }

  if (input.spec.length === 0 && !userStory) {
    return {
      ok: false,
      requestedSeam,
      initial,
      final: initial,
      refined: false,
      refinedSpec: null,
      refinementReason: null,
      refinementError: null,
      clarificationQuestions: fallbackClarificationQuestions(initial),
    };
  }

  try {
    const refinement = await runSpecRefinement(
      {
        spec: input.spec,
        userStory,
        requestedSeam,
        issues: initial.issues,
      },
      ctx,
      config
    );
    if (refinement.items.length === 0) {
      return {
        ok: false,
        requestedSeam,
        initial,
        final: initial,
        refined: false,
        refinedSpec: null,
        refinementReason: refinement.reason,
        refinementError: null,
        clarificationQuestions: refinement.questions,
      };
    }
    const final = await runPreflight(
        {
          spec: refinement.items,
          userStory,
          planCompleted: input.planCompleted,
        },
      ctx,
      config
    );

    if (!final.ok) {
      const clarification = await runSpecClarification(
        {
          spec: refinement.items,
          userStory,
          requestedSeam,
          issues: final.issues,
        },
        ctx,
        config
      );

      return {
        ok: false,
        requestedSeam,
        initial,
        final,
        refined: true,
        refinedSpec: refinement.items,
        refinementReason: refinement.reason,
        refinementError: null,
        clarificationQuestions: clarification.questions,
      };
    }

    return {
      ok: true,
      requestedSeam,
      initial,
      final,
      refined: true,
      refinedSpec: refinement.items,
      refinementReason: refinement.reason,
      refinementError: null,
      clarificationQuestions: [],
    };
  } catch (error) {
    return {
      ok: false,
      requestedSeam,
      initial,
      final: initial,
      refined: false,
      refinedSpec: null,
      refinementReason: null,
      refinementError: error instanceof Error ? error.message : String(error),
      clarificationQuestions: fallbackClarificationQuestions(initial),
    };
  }
}

export async function runSpecRefinement(
  input: SpecRefinementInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<SpecRefinementResult> {
  const raw = await runReview(
    {
      label: "specRefinement",
      systemPrompt: SPEC_REFINEMENT_SYSTEM_PROMPT,
      userPrompt: buildSpecRefinementUserPrompt(input),
    },
    ctx,
    config
  );

  return parseSpecRefinementResponse(raw.text);
}

export async function runSpecClarification(
  input: SpecRefinementInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<SpecClarificationResult> {
  const raw = await runReview(
    {
      label: "specClarification",
      systemPrompt: SPEC_CLARIFICATION_SYSTEM_PROMPT,
      userPrompt: buildSpecRefinementUserPrompt(input),
    },
    ctx,
    config
  );

  return parseSpecClarificationResponse(raw.text);
}

export function buildSpecRefinementUserPrompt(input: SpecRefinementInput): string {
  return [
    ...userStoryLines(input.userStory),
    `Requested seam: ${seamLabel(input.requestedSeam)}`,
    "",
    "Current spec checklist:",
    ...numberedLines(input.spec, "(empty)"),
    "",
    "Readiness issues to address:",
    ...issueLines(input.issues),
    "",
    "Rewrite the checklist so RED can start with the smallest meaningful failing test at the requested seam.",
    "Return JSON only.",
  ].join("\n");
}

export function parseSpecRefinementResponse(raw: string): SpecRefinementResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Spec refinement response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Spec refinement response must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  const items = normalizeItems(obj.items);
  const questions = normalizeItems(obj.questions);

  if (items.length === 0 && questions.length === 0) {
    throw new Error("Spec refinement response must contain at least one item or clarification question");
  }

  return {
    reason,
    items,
    questions,
  };
}

export function parseSpecClarificationResponse(raw: string): SpecClarificationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Spec clarification response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Spec clarification response must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  const questions = normalizeItems(obj.questions);

  if (questions.length === 0) {
    throw new Error("Spec clarification response must contain at least one question");
  }

  return { reason, questions };
}

export function formatRedReadinessResult(result: RedReadinessResult): string {
  const seamPrefix = `Target seam: ${seamLabel(result.requestedSeam)}.`;
  if (result.clarificationQuestions.length > 0) {
    const lines = [
      seamPrefix,
      "",
      result.refined
        ? "RED readiness tightened the spec, but it still needs clarification before RED can start."
        : "RED readiness needs clarification before RED can start.",
    ];
    if (result.refinementReason) {
      lines.push(result.refinementReason);
    }
    if (!result.final.ok) {
      lines.push("", formatPreflightResult(result.final));
    }
    lines.push("", "Ask the user:");
    lines.push(...result.clarificationQuestions.map((question, index) => `${index + 1}. ${question}`));
    return lines.join("\n");
  }

  if (result.refined && result.ok) {
    const lines = [seamPrefix, "", "RED readiness auto-refined the spec and it is ready."];
    if (result.refinementReason) {
      lines.push(result.refinementReason);
    }
    return lines.join(" ");
  }

  if (result.refined) {
    const lines = [seamPrefix, "", "RED readiness auto-refined the spec, but it still needs clarification."];
    if (result.refinementReason) {
      lines.push(result.refinementReason);
    }
    lines.push("", formatPreflightResult(result.final));
    return lines.join("\n");
  }

  if (result.refinementError) {
    return `${seamPrefix}\n\n${formatPreflightResult(result.final)}\n\nRED readiness could not auto-refine the spec: ${result.refinementError}`;
  }

  return `${seamPrefix}\n\n${formatPreflightResult(result.final)}`;
}

function numberedLines(items: string[], emptyLabel: string): string[] {
  if (items.length === 0) {
    return [emptyLabel];
  }

  return items.map((item, index) => `${index + 1}. ${item}`);
}

function issueLines(issues: PreflightIssue[]): string[] {
  if (issues.length === 0) {
    return ["(none)"];
  }

  return issues.map((issue) => {
    const prefix = issue.itemIndex === null ? "•" : `${issue.itemIndex}.`;
    return `${prefix} ${issue.message}`;
  });
}

function userStoryLines(userStory: string | undefined): string[] {
  if (!userStory?.trim()) {
    return [];
  }

  return ["User story / request:", userStory.trim(), ""];
}

function normalizeItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function fallbackClarificationQuestions(result: PreflightResult): string[] {
  if (!result.ok && result.issues.some((issue) => issue.message.includes("No spec items yet"))) {
    return [
      "What concrete user-visible behavior should the first TDD cycle prove?",
      "What is the first acceptance check or example this feature must satisfy?",
    ];
  }

  return ["What behavior is still missing or ambiguous enough that RED cannot start yet?"];
}

function resolveUserStory(userStory: string | undefined, ctx: ExtensionContext): string | undefined {
  const explicit = userStory?.trim();
  if (explicit) {
    return explicit;
  }

  return latestUserMessageText(ctx.sessionManager?.getBranch?.());
}

function latestUserMessageText(entries: SessionEntry[] | undefined): string | undefined {
  if (!entries) {
    return undefined;
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry || entry.type !== "message") {
      continue;
    }

    const message = (entry as { message?: { role?: string; content?: unknown } }).message;
    if (message?.role !== "user") {
      continue;
    }

    const text = flattenMessageContent(message.content);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function flattenMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (typeof item === "object" && item !== null && "type" in item && (item as { type?: string }).type === "text") {
        return typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || undefined;
}
