---
name: pi-tdd
description: Use pi-tdd's SPEC, RED, GREEN, and REFACTOR workflow to translate user requests into testable specifications and implement behavior one acceptance criterion at a time.
---

# pi-tdd

Use this skill when the task is being handled inside `pi-tdd` or when the user wants help working in a strict TDD loop with Pi.

## Purpose

`pi-tdd` is not just about "write a failing test first". Its value comes from making sure the requested feature is translated into testable behavior before implementation starts.

Use the repository's own instructions, such as `AGENTS.md` or the active system prompt, for broader coding conventions. This skill only adds TDD workflow guidance.

Use `SPEC` as an optional preflight step when the user's request can't yet be translated directly into a failing test — the user story, expected behavior, or acceptance criteria need to be pinned down first.

Before feature work, check whether the repository already has a runnable test command or test framework.

If the harness is missing, stay dormant and set up the minimal test harness that fits the stack. Ask the user instead when the framework choice is ambiguous, would introduce meaningful new tooling, or would commit the project to a testing direction the request did not imply.

Stay dormant for repository scaffolding, project bootstrap, and initial test-harness setup. Engage the TDD loop only once the project can host a failing test for the requested behavior.

Project scaffolding is not itself a user-visible behavior. Do not invent scaffold-only TDD criteria like "the build passes", "Vitest is configured", "directories exist", "routes are stubbed", or "placeholder utilities have tests" just to justify entering SPEC or RED.

If a story is only schema, migration, database, or setup work, treat it as support work first. Ask which real feature it supports before giving it its own TDD cycle, unless the user clearly wants to prove a specific internal contract or risk at that layer.

If you inherit a repo that already has a runnable test harness and a large pre-existing scaffold, treat that scaffold as the baseline state of the project. Do not try to retroactively force every existing file back through TDD, and do not keep feature work dormant just because earlier files were created before TDD was engaged.

When the user asks for a broad scaffold:

1. Stay dormant.
2. Check whether the scaffold already includes a runnable test command or framework.
3. If not, create the project structure, config, dependencies, and minimal test harness needed to make future TDD possible, or ask the user if that choice is not obvious.
4. Be explicit about which work is still scaffolding versus which work is real feature delivery.
5. As soon as the harness exists, call `tdd_start` before implementing the first concrete behavior the scaffold is meant to support.
6. Keep subsequent feature work inside SPEC -> RED -> GREEN -> REFACTOR. Do not drift back into dormant mode for user-visible behavior just because the project started as a scaffold.

When inheriting an already scaffolded repo:

1. Check whether the test harness already runs.
2. Treat existing files and tests as the current baseline, even if they were not created in a clean TDD cycle.
3. Pick the next concrete user-visible behavior or bug fix.
4. Tighten or replace weak placeholder tests only for the area you are touching.
5. Run the next change inside SPEC -> RED -> GREEN -> REFACTOR from that point forward.

## SPEC Workflow

When the request needs sharpening:

1. Restate the user request in plain language.
2. Identify the user story:
   What does this enable for the user?
3. Identify the need:
   What problem or pain point is being solved?
4. Write observable acceptance criteria:
   How will we know the feature is done?
5. Translate each acceptance criterion into one or more test cases and start from the outermost seam that honestly proves the request. Route, API, redirect, page, and form requests should begin there, not in helpers, services, schema, or migrations.
6. Capture those checks as the `SPEC` list with `tdd_refine_feature_spec` when working through agent tools.
7. Treat `SPEC` as the place where the checklist is both authored and tightened until RED can start cleanly.
8. Entering `RED` runs a readiness check on that checklist. It may draft the first checklist from a clear request, sharpen a weak checklist once automatically, or ask the user a concise clarification question when the behavior is still ambiguous.
9. Move into `RED` explicitly with `tdd_start(phase: 'RED')` once the requested behavior is testable.

If you cannot explain the user-visible behavior and the acceptance criteria, do not rush into `RED`.

## Phase Semantics

### SPEC

- Clarify the request.
- Produce a user story, acceptance criteria, and testable specifications.
- Use `tdd_refine_feature_spec` to persist or revise the checklist.
- Treat `tdd_preflight` as an optional RED-readiness check inside SPEC. It may draft or refine the checklist for you when the issues are straightforward, or help you identify the clarification question to ask next.
- Do not edit files.
- Do not do implementation planning unrelated to testable behavior.

### RED

- Add or modify the cheapest failing test for a single acceptance criterion.
- Use unit tests for isolated logic and integration tests when the bug or feature lives at a boundary, contract, or wiring seam.
- For user-facing API or UI requests, start RED at that user-visible seam before drilling into support tests.
- Confirm the test fails for the expected reason.
- Do not implement the fix yet.

### GREEN

- Write the smallest correct code for the behavior the failing test asserts.
- Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.

### REFACTOR

- Refine the code from this cycle without changing behavior: naming, readability, duplication, structure.
- If a test breaks, you changed behavior — revert and try a different approach.
- Stay scoped to this cycle's work.

## Command Surface

Slash command:

- `/tdd <feature or bug request>`
- `/tdd on`
- `/tdd off`

## Good Output Shape In SPEC

When producing a spec, prefer this structure:

1. User story
2. Acceptance criteria
3. Testable specification list

Example:

```text
User story:
As a shopper, I want checkout to reject an empty cart so I do not place an invalid order.

Acceptance criteria:
1. Checkout fails when the cart has no items.
2. The user sees a clear validation message.
3. Checkout succeeds once at least one item is present.

Testable specification:
1. rejects checkout when the cart is empty
2. shows a clear validation message for an empty cart
3. allows checkout when the cart contains at least one item
```

## Guardrails

- Do not treat `SPEC` as vague brainstorming.
- Do not use TDD to justify directory creation, config wiring, dependency installation, placeholder routes, schemas, interfaces, or empty service shells.
- Do not retrofit non-behavioral scaffold work into fake acceptance criteria just because the user asked for a large project setup.
- Do not keep implementing user-visible feature work in dormant mode once the repository can run a failing test.
- Do not pause feature work to retroactively re-TDD the entire inherited scaffold. Focus on the next behavior change and bring that slice under TDD.
- Do not treat passing tests as success unless the tests actually prove the requested behavior.
- Do not rely on mocked unit tests alone when the real risk is at a boundary between units.
- Do not write tests that read back static declarations, schema shapes, or configuration constants. These mirror source code rather than proving behavior. Test what the system does through the declaration (e.g., "can I insert and query a link?" not "does the schema have 9 columns?").
- Prefer one acceptance criterion per RED/GREEN cycle when possible.
- When uncertain, tighten the specification before writing more code.
