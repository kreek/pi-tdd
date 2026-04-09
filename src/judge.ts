import { complete, type Model } from "@mariozechner/pi-ai";
import type { ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import type { JudgeVerdict, PhaseState, TDDConfig, TDDPhase, TransitionVerdict } from "./types.js";

function phaseRules(phase: TDDPhase): string {
  switch (phase) {
    case "SPEC":
      return `Phase: SPEC
ALLOWED: Reading files, exploring the codebase, clarifying the user's request, defining the user story and acceptance criteria, and translating them into testable specifications.
BLOCKED: Writing or editing files, behavior-changing commands, implementation work, and generic implementation planning not tied to testable behavior.`;
    case "RED":
      return `Phase: RED
ALLOWED: Writing or modifying tests, running tests to confirm failure, reading files.
BLOCKED: Writing implementation code, broad refactors, modifying non-test source files unless absolutely necessary to create a failing test.`;
    case "GREEN":
      return `Phase: GREEN
ALLOWED: Minimal implementation changes required to make the failing test pass, running tests.
BLOCKED: Refactors, speculative abstractions, unrelated cleanup, feature creep.`;
    case "REFACTOR":
      return `Phase: REFACTOR
ALLOWED: Restructuring code without changing behavior, running tests to verify behavior.
BLOCKED: New behavior, new scope, new tests for new functionality.`;
  }
}

function summarizeToolCall(event: ToolCallEvent): string {
  const parts = [`Tool: ${event.toolName}`];
  const input = event.input as Record<string, unknown>;

  if (typeof input.path === "string") {
    parts.push(`Path: ${input.path}`);
  }
  if (typeof input.command === "string") {
    parts.push(`Command: ${truncate(input.command, 300)}`);
  }
  if (typeof input.content === "string") {
    parts.push(`Content preview: ${truncate(input.content, 300)}`);
  }
  if (typeof input.oldText === "string") {
    parts.push(`Old text: ${truncate(input.oldText, 200)}`);
  }
  if (typeof input.newText === "string") {
    parts.push(`New text: ${truncate(input.newText, 200)}`);
  }

  const extraKeys = Object.keys(input).filter(
    (key) => !["path", "command", "content", "oldText", "newText", "timeout"].includes(key)
  );
  if (extraKeys.length > 0) {
    parts.push(`Other args: ${truncate(JSON.stringify(pickFields(input, extraKeys)), 300)}`);
  }

  return parts.join("\n");
}

function contextBlock(state: PhaseState, maxDiffs: number): string {
  const lines: string[] = [];

  if (state.plan.length > 0) {
    lines.push(`Spec progress: ${state.planCompleted}/${state.plan.length}`);
    lines.push(`Current spec item: ${state.plan[state.planCompleted] ?? "(completed)"}`);
  }
  if (state.lastTestOutput) {
    lines.push(`Last test output (truncated):\n${truncateFromEnd(state.lastTestOutput, 700)}`);
  }
  if (state.lastTestFailed !== null) {
    lines.push(`Last test result: ${state.lastTestFailed ? "FAILED" : "PASSED"}`);
  }

  const diffs = state.diffs.slice(-maxDiffs);
  if (diffs.length > 0) {
    lines.push(`Recent allowed mutations:\n${diffs.join("\n---\n")}`);
  }

  return lines.length > 0 ? lines.join("\n\n") : "No accumulated context yet.";
}

function buildGatePrompt(event: ToolCallEvent, state: PhaseState, config: TDDConfig): string {
  return `You are a TDD enforcement judge. Decide whether the proposed tool call is allowed in the current TDD phase.

${phaseRules(state.phase)}

Context:
${contextBlock(state, config.maxDiffsInContext)}

Proposed tool call:
${summarizeToolCall(event)}

Guidance:
- SPEC blocks file mutations and behavior-changing commands.
- SPEC exists to translate the user's request into testable specifications that set up the rest of the TDD loop for success.
- RED allows test work and test execution only.
- GREEN allows only the minimum implementation to satisfy the failing test.
- REFACTOR allows cleanup without behavior changes.
- Test-running bash commands are allowed outside SPEC.
- Never allow secrets or credentials to be written.

Respond with JSON only:
{"allowed": true, "reason": "short explanation"}`;
}

function buildTransitionPrompt(state: PhaseState, config: TDDConfig, expectedNextPhase: TDDPhase): string {
  return `You are a TDD phase transition evaluator. Decide whether the cycle should advance to the immediate next phase only.

Current phase: ${state.phase}
Only legal next phase: ${expectedNextPhase}
Cycle count: ${state.cycleCount}

Transition rules:
- SPEC -> RED only when the user's request has been translated into a testable specification.
- RED -> GREEN only after a test has been written and confirmed failing.
- GREEN -> REFACTOR only after the failing test now passes.
- REFACTOR -> RED only when refactoring is complete and behavior is still passing.

Context:
${contextBlock(state, config.maxDiffsInContext)}

Respond with JSON only.
If yes: {"transition": "${expectedNextPhase}", "reason": "..."}
If no: {"transition": null, "reason": "..."}`;
}

export async function judgeToolCalls(
  ctx: ExtensionContext,
  events: ToolCallEvent[],
  state: PhaseState,
  config: TDDConfig
): Promise<JudgeVerdict[]> {
  const verdicts: JudgeVerdict[] = [];

  for (const event of events) {
    const raw = await runJudgePrompt(buildGatePrompt(event, state, config), ctx, config);
    verdicts.push(parseVerdict(raw));
  }

  return verdicts;
}

export async function judgeTransition(
  ctx: ExtensionContext,
  state: PhaseState,
  config: TDDConfig,
  expectedNextPhase: TDDPhase
): Promise<TransitionVerdict> {
  const raw = await runJudgePrompt(buildTransitionPrompt(state, config, expectedNextPhase), ctx, config);
  return parseTransitionVerdict(raw);
}

async function runJudgePrompt(prompt: string, ctx: ExtensionContext, config: TDDConfig): Promise<string> {
  const model = resolveJudgeModel(ctx, config);
  if (!model) {
    throw new Error("No judge model available");
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  if (!auth.apiKey) {
    throw new Error(`No API key configured for ${model.provider}/${model.id}`);
  }

  const response = await complete(
    model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: ctx.signal,
      temperature: config.temperature,
    }
  );

  if (response.stopReason === "aborted") {
    throw new Error("Judge request aborted");
  }
  if (response.stopReason === "error") {
    throw new Error(response.errorMessage ?? "Judge request failed");
  }

  const text = response.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Judge returned no text");
  }

  return text;
}

function resolveJudgeModel(ctx: ExtensionContext, config: TDDConfig): Model | undefined {
  if (config.judgeProvider && config.judgeModel) {
    return ctx.modelRegistry.find(config.judgeProvider, config.judgeModel);
  }

  return ctx.model;
}

function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw.trim();
}

function parseVerdict(raw: string): JudgeVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Judge response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("allowed" in parsed)) {
    throw new Error("Judge response did not contain an allowed field");
  }

  const allowed = Boolean((parsed as Record<string, unknown>).allowed);
  const reason = String((parsed as Record<string, unknown>).reason ?? "");
  return { allowed, reason };
}

function parseTransitionVerdict(raw: string): TransitionVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Transition response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("transition" in parsed)) {
    throw new Error("Transition response did not contain a transition field");
  }

  const transition = (parsed as Record<string, unknown>).transition;
  if (
    transition !== null &&
    transition !== "PLAN" &&
    transition !== "SPEC" &&
    transition !== "RED" &&
    transition !== "GREEN" &&
    transition !== "REFACTOR"
  ) {
    throw new Error(`Invalid transition value: ${String(transition)}`);
  }

  return {
    transition: transition === "PLAN" ? "SPEC" : (transition as TDDPhase | null),
    reason: String((parsed as Record<string, unknown>).reason ?? ""),
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function truncateFromEnd(value: string, max: number): string {
  return value.length > max ? `...${value.slice(-max)}` : value;
}

function pickFields(
  input: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = input[key];
  }
  return out;
}
