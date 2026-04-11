import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PROMPT_NAMES, loadPrompt, loadPromptList, resolvePromptUrl, type PromptName } from "../src/prompt-loader.ts";
import { PhaseStateMachine } from "../src/phase.ts";
import { buildSystemPrompt } from "../src/system-prompt.ts";
import { resolveGuidelines } from "../src/guidelines.ts";

const GREEN_IMPLEMENTATION_GUIDANCE =
  "Write the smallest correct implementation to pass the current failing unit or integration test.";
const GREEN_SCOPE_GUIDANCE =
  "Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.";

describe("prompts", () => {
  it("loads every declared prompt file", () => {
    for (const name of PROMPT_NAMES) {
      expect(loadPrompt(name)).not.toBe("");
    }
  });

  it("resolves prompt paths from both src and dist module URLs", () => {
    const expected = "file:///repo/prompts/preflight-system.md";

    expect(resolvePromptUrl("preflight-system", "file:///repo/src/prompt-loader.ts").href).toBe(expected);
    expect(resolvePromptUrl("preflight-system", "file:///repo/dist/prompt-loader.js").href).toBe(expected);
  });

  it("loads bullet-list prompt files as plain guideline strings", () => {
    expect(loadPromptList("tool-engage-guidelines")).toEqual([
      "Call tdd_start at the start of any feature or bug-fix work, before any code changes. Use phase='SPEC' if requirements need clarification, phase='RED' if you can write the first failing test immediately.",
      "Before feature work, check whether the repository already has a runnable test command or test framework.",
      "If the harness is missing, stay dormant and set up the minimal test harness that fits the stack, or ask the user when the framework choice is ambiguous or would introduce meaningful new tooling.",
      "Stay dormant for investigation, navigation, branch management, code review, research, repository scaffolding, and initial test-harness setup. Engage TDD only once the project can host a failing test for the requested behavior.",
      "Do not invent scaffold-only acceptance criteria like \"build passes\", \"Vitest is configured\", \"folders exist\", or \"route shells compile\" to justify entering SPEC or RED.",
      "Once a runnable test harness exists, call tdd_start immediately before continuing any user-visible feature or bug-fix work.",
      "If you engage into SPEC, use tdd_refine_feature_spec to persist or revise the checklist before calling tdd_preflight or entering RED.",
      "SPEC covers both authoring the checklist and tightening it until RED can start cleanly.",
      "For API, route, redirect, page, or form requests, shape the checklist around those user-visible seams first instead of starting with helpers, schema, migrations, or service internals.",
      "When transitioning into RED, the readiness check can draft the first checklist from a clear request.",
      "If the repo already contains scaffolded files or placeholder tests from before TDD was engaged, treat them as baseline and use TDD for the next concrete behavior you change rather than trying to re-TDD the whole scaffold at once.",
      "When transitioning into RED, the readiness check runs automatically. If the checklist is close but weak, Pi may sharpen it once inside SPEC. If the behavior is still ambiguous, Pi should ask the user a concise clarification question instead of stalling.",
      "Call tdd_stop when feature work is finished — post-flight will run automatically to verify the work delivered what was asked.",
    ]);
  });

  it("loads preflight tool guidance as plain guideline strings", () => {
    expect(loadPromptList("tool-preflight-guidelines")).toEqual([
      "tdd_preflight is the same RED-readiness check that runs automatically when entering RED via tdd_start(phase: 'RED').",
      "Use it when you want to inspect or sharpen the checklist while still in SPEC.",
      "If the request is clearly about an API, route, redirect, page, or form, treat helper/schema/service-first checklists as misaligned and rewrite them toward that business seam.",
      "If the request is only schema, migration, database, or setup work, push back and clarify whether it should be folded under the first business slice instead of treated as a standalone feature.",
      "If the checklist is empty but the request is clear, RED readiness may draft the first checklist from that request.",
      "If the checklist is close but not quite ready, the readiness check may refine it once for you instead of only sending it back unchanged.",
      "If the behavior is still ambiguous after that refinement pass, ask the user 1-2 concise clarification questions before retrying RED.",
    ]);
  });

  it("loads spec-tool guidance as plain guideline strings", () => {
    expect(loadPromptList("tool-spec-guidelines")).toEqual([
      "Use tdd_refine_feature_spec in SPEC to write or replace the checklist without overriding the read-only file gate.",
      "Keep each item concrete, observable, and behavior-focused. Do not store implementation tasks or file-edit plans as spec items.",
      "For route, API, redirect, page, or form requests, keep the first items at that user-visible seam. Helper/schema/service checks are support work unless the user explicitly asked for internals.",
      "When RED readiness says the checklist is still weak, revise it with tdd_refine_feature_spec before retrying RED.",
    ]);
  });

  it("parses real markdown lists with headings and wrapped lines", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-tdd-prompts-"));
    mkdirSync(join(root, "prompts"));
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "prompts", "tool-engage-guidelines.md"),
      [
        "# Engage Tool",
        "",
        "- First guideline wraps",
        "  onto a second line.",
        "",
        "1. Second guideline uses numbered markdown.",
      ].join("\n")
    );

    const moduleUrl = pathToFileURL(join(root, "src", "prompt-loader.ts")).href;
    expect(loadPromptList("tool-engage-guidelines", moduleUrl)).toEqual([
      "First guideline wraps onto a second line.",
      "Second guideline uses numbered markdown.",
    ]);
  });

  it("rejects prompt-list files that contain stray prose", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-tdd-prompts-"));
    mkdirSync(join(root, "prompts"));
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "prompts", "tool-engage-guidelines.md"),
      [
        "# Engage Tool",
        "",
        "This sentence is not a markdown list item.",
      ].join("\n")
    );

    const moduleUrl = pathToFileURL(join(root, "src", "prompt-loader.ts")).href;
    expect(() => loadPromptList("tool-engage-guidelines", moduleUrl)).toThrow(/must contain markdown list items/);
  });

  it("throws a targeted error when a prompt file is missing", () => {
    expect(() => loadPrompt("missing-prompt" as PromptName)).toThrow(/Failed to load prompt "missing-prompt"/);
    expect(() => loadPrompt("missing-prompt" as PromptName)).toThrow(/missing-prompt\.md/);
  });

  it("keeps GREEN guidance aligned across the phase machine, system prompt, and skill", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
      reviewModels: {},
      runPreflightOnRed: true,
      engageOnTools: [],
      disengageOnTools: [],
      guidelines: resolveGuidelines({}),
    });
    const skill = readFileSync("skills/pi-tdd/SKILL.md", "utf8");

    expect(machine.allowedActions()).toContain(GREEN_IMPLEMENTATION_GUIDANCE);
    expect(prompt).toContain("Write the smallest correct implementation for the behavior the failing test asserts.");
    expect(prompt).toContain(GREEN_SCOPE_GUIDANCE);
    expect(skill).toContain("- Write the smallest correct code for the behavior the failing test asserts.");
    expect(skill).toContain(`- ${GREEN_SCOPE_GUIDANCE}`);
  });

  it("teaches dormant guidance to keep scaffolding outside the TDD loop", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
      reviewModels: {},
      runPreflightOnRed: true,
      engageOnTools: [],
      disengageOnTools: [],
      guidelines: resolveGuidelines({}),
    });
    const skill = readFileSync("skills/pi-tdd/SKILL.md", "utf8");

    expect(prompt).toContain("check whether the repository already has a runnable test command");
    expect(prompt).toContain("set up the minimal test harness");
    expect(prompt).toContain("Do not invent scaffold-only acceptance criteria");
    expect(prompt).toContain("'build passes'");
    expect(prompt).toContain("If the request is only schema, migration, database, or setup work");
    expect(prompt).toContain("call `tdd_start` immediately");
    expect(prompt).toContain("tdd_refine_feature_spec");
    expect(prompt).toContain("RED entry runs a readiness check");
    expect(prompt).toContain("draft the first checklist");
    expect(prompt).toContain("treat them as baseline");
    expect(skill).toContain("Before feature work, check whether the repository already has a runnable test command or test framework.");
    expect(skill).toContain("If the harness is missing, stay dormant and set up the minimal test harness");
    expect(skill).toContain("Project scaffolding is not itself a user-visible behavior.");
    expect(skill).toContain("If a story is only schema, migration, database, or setup work");
    expect(skill).toContain("\"the build passes\"");
    expect(skill).toContain("Keep subsequent feature work inside SPEC -> RED -> GREEN -> REFACTOR.");
    expect(skill).toContain("treat that scaffold as the baseline state of the project");
    expect(skill).toContain("tdd_refine_feature_spec");
  });

  it("keeps SPEC guidance explicit that preflight does not unlock writes", () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "SPEC",
      plan: ["Redirecting an existing slug returns a 302 to the stored destination URL."],
    });
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
      reviewModels: {},
      runPreflightOnRed: true,
      engageOnTools: [],
      disengageOnTools: [],
      guidelines: resolveGuidelines({}),
    });
    const skill = readFileSync("skills/pi-tdd/SKILL.md", "utf8");

    expect(prompt).toContain("SPEC includes both authoring the checklist and tightening it");
    expect(prompt).toContain("draft the first checklist from the request");
    expect(prompt).toContain("clarification questions");
    expect(skill).toContain("Treat `SPEC` as the place where the checklist is both authored and tightened");
    expect(skill).toContain("Entering `RED` runs a readiness check");
    expect(skill).toContain("draft the first checklist from a clear request");
    expect(skill).toContain("optional RED-readiness check inside SPEC");
  });

  it("keeps the built-in prompt markdown focused on TDD workflow instead of coding style", () => {
    expect(loadPrompt("guidelines-green")).toContain("Implement only the behavior required to make the current failing test pass.");
    expect(loadPrompt("guidelines-red")).toContain("Use unit tests for isolated logic and integration tests for boundaries, contracts, or wiring.");
    expect(loadPrompt("guidelines-red")).toContain("define the proof target for this cycle");
    expect(loadPrompt("guidelines-red")).toContain("If the test already passes, RED is not complete yet.");
    expect(loadPrompt("guidelines-green")).toContain("Drive the active proof target to green");
    expect(loadPrompt("guidelines-refactor")).toContain("Start a fresh RED cycle when the proving test needs a material behavior change.");
    expect(loadPrompt("guidelines-spec")).toContain("Start at the outermost seam that honestly proves the request.");
    expect(loadPrompt("guidelines-spec")).toContain("If the request is entirely schema, migration, database, or setup work");
    expect(loadPrompt("guidelines-spec")).toContain("Choose one cheapest honest first proof level");
    expect(loadPrompt("guidelines-green")).not.toContain("Favor pure functions");
    expect(loadPrompt("guidelines-green")).not.toContain("Functions: 25-30 lines max");
    expect(loadPrompt("guidelines-refactor")).not.toContain("Unix philosophy");
    expect(loadPrompt("guidelines-universal")).toContain("AGENTS.md");
  });

  it("does not inject repository-author coding-style guidance into the system prompt", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "REFACTOR" });
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
      reviewModels: {},
      runPreflightOnRed: true,
      engageOnTools: [],
      disengageOnTools: [],
      guidelines: resolveGuidelines({}),
    });

    expect(prompt).not.toContain("coding guidelines");
    expect(prompt).toContain("Preserve behavior while refining the code from this cycle");
  });

  it("keeps the postflight prompt focused on spec delivery and project fit", () => {
    const postflight = loadPrompt("postflight-system");

    expect(postflight).toContain("delivered what its spec asked for and fits the project it was added to");
    expect(postflight).toContain("The proving tests are at the right level for the behavior");
    expect(postflight).toContain("the proving slice reaches that business seam instead of stopping at helper, schema, migration, or service tests");
    expect(postflight).toContain("The proof target for the cycle went from red to green");
    expect(postflight).toContain("aligns with the repository's documented instructions, established code patterns, and chosen tech stack");
    expect(postflight).toContain("When the cycle is complete, return `ok: true`");
    expect(postflight).not.toContain("NOT to police whether the implementation was minimal");
  });

  it("surfaces the active proof target in the system prompt once RED has established it", () => {
    const machine = new PhaseStateMachine({
      enabled: true,
      phase: "GREEN",
      plan: ["persist settings through the HTTP API"],
      proofCheckpoint: {
        itemIndex: 1,
        item: "persist settings through the HTTP API",
        seam: "business_http",
        command: "npm run test:integration",
        commandFamily: "npm:test:integration",
        level: "integration",
        testFiles: ["tests/http/settings.integration.test.ts"],
        mutationCountAtCapture: 1,
      },
    });
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
      reviewModels: {},
      runPreflightOnRed: true,
      engageOnTools: [],
      disengageOnTools: [],
      guidelines: resolveGuidelines({}),
    });

    expect(prompt).toContain("Active proof target: Spec item 1 | INTEGRATION | npm run test:integration");
    expect(prompt).toContain("Drive the active proof target to green before chasing unrelated test output.");
  });

  it("teaches preflight to reason about proof level", () => {
    const preflight = loadPrompt("preflight-system");

    expect(preflight).toContain("proof seam and proof level");
    expect(preflight).toContain("Boundary-heavy items should usually be provable with integration tests");
    expect(preflight).toContain("helper/schema/service checks are support work");
    expect(preflight).toContain("Approve spec items that are concrete, observable, distinct, behavior-focused");
  });

  it("teaches refinement and clarification prompts to push back on support-only stories", () => {
    const refinement = loadPrompt("spec-refinement-system");
    const clarification = loadPrompt("spec-clarification-system");
    const preflightGuidelines = loadPromptList("tool-preflight-guidelines");

    expect(refinement).toContain("do not launder it into pseudo-feature checks");
    expect(clarification).toContain("When the request is only support work or scaffolding");
    expect(preflightGuidelines).toContain(
      "If the request is only schema, migration, database, or setup work, push back and clarify whether it should be folded under the first business slice instead of treated as a standalone feature."
    );
  });

  it("keeps tiny tool snippets inline instead of as prompt files", () => {
    expect(PROMPT_NAMES).not.toContain("tool-engage-snippet");
    expect(PROMPT_NAMES).not.toContain("tool-disengage-snippet");
    expect(PROMPT_NAMES).not.toContain("tool-preflight-snippet");
    expect(PROMPT_NAMES).not.toContain("tool-postflight-snippet");
    expect(PROMPT_NAMES).not.toContain("tool-spec-snippet");
  });
});
