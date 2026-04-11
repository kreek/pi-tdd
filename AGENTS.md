# AGENTS.md

This file provides guidance to coding agents working in this repository.

## What this is

`pi-tdd` is a Pi extension (Pi = the terminal coding agent at `@mariozechner/pi-coding-agent`). It injects a `SPEC → RED → GREEN → REFACTOR` phase gate into a Pi session, with LLM-backed pre-flight and post-flight reviews at cycle boundaries. It is loaded into Pi as an ESM extension package.

The extension is **dormant by default** — a fresh session does not gate anything until the agent calls `tdd_start`, the user runs an explicit `/tdd <phase>`, or a configured lifecycle hook (`engageOnTools`) fires.

## Commands

```bash
npm run build              # tsc → dist/
npm test                   # vitest run (one shot)
npx vitest run path/to/test.test.ts                   # single file
npx vitest run -t "name of the test"                  # single test by name
npm run watch              # tsc --watch
npm run pi:install         # build + install this checkout into ./.pi/settings.json
npm run pi:install:global  # build + install this checkout into ~/.pi/agent/settings.json
```

There is no lint script. Type checking happens through `tsc` (strict mode is on).

After `pi:install`, if Pi is already running, run `/reload` inside Pi to pick up the new build.

## Architecture

Quick mental model:

1. **`PhaseStateMachine` (`src/phase.ts`) is the only mutable state.** Phase, engagement flag, spec checklist, cycle count, last test signal, and a rolling diff buffer all live here. Pure data + logic — no Pi or LLM dependencies, so it is trivially unit-testable. Every other module reads or mutates it.

2. **`src/index.ts:activate(pi)` is the entry point.** It builds the machine, registers four LLM tools (`tdd_start`, `tdd_stop`, `tdd_preflight`, `tdd_postflight`), registers the `/tdd` slash command, and wires every Pi event (`session_start`, `session_tree`, `before_agent_start`, `turn_start`, `tool_call`, `tool_result`, `turn_end`) to the right module.

3. **The system prompt steers the agent during the cycle.** `src/prompt.ts:buildSystemPrompt` is appended to `before_agent_start`. There is no per-tool LLM judge — that was deliberately removed. The deterministic gate in `src/gate.ts` only blocks `write`/`edit`/`bash` in `SPEC` (with override). All other phases are passthrough that just record diffs into the machine for postflight context.

4. **Test signals drive transitions.** `src/transition.ts:extractTestSignal` converts a `bash` tool result into a pass/fail `TestSignal` (it knows about `npm test`, `pnpm test`, `pytest`, `cargo test`, `go test`, `vitest`, `jest`, `rspec`, etc.). At `turn_end`, `evaluateTransition` advances `RED → GREEN` on a failing signal and `GREEN → REFACTOR` on a passing one. `SPEC` and `REFACTOR → RED` are human-controlled by default.

5. **Cycle boundaries are where the LLM reviewers run.** `→ RED` runs **preflight** (`src/preflight.ts`) — validates the spec checklist; failure **blocks** entry into RED with no override. **Disengaging** runs **postflight** (`src/postflight.ts`) — validates that every spec item has a passing test; failure surfaces gaps but **does not block** disengage. Both go through `src/reviews.ts:runReview`, which resolves the model (configured `reviewProvider`/`reviewModel` or session active model), calls `complete`, and parses JSON. Standalone `tdd_preflight` / `tdd_postflight` tools (`src/review-tools.ts`) exist for ad-hoc checks but are usually not needed.

6. **Engagement is per-session, phase is persisted in-session.** `src/persistence.ts` writes a `tdd_state` custom entry on the Pi session log. `restoreState` walks the current branch backwards. `rehydrateState` in `index.ts` enforces the rule that a fresh `session_start` always starts dormant unless `defaultEngaged: true` is set, regardless of what was persisted; only `session_tree` (within-session navigation) preserves the live engagement flag.

7. **Lifecycle hooks (`src/engagement.ts:applyLifecycleHooks`)** check every `tool_call` against `engageOnTools` / `disengageOnTools` from config and flip the machine on/off. Disengage via lifecycle hook runs postflight first via the same `maybeRunPostflightOnDisengage` helper that the explicit disengage paths use.

### File map

| File | Role |
|---|---|
| `src/index.ts` | Activation, event wiring, command registration. |
| `src/phase.ts` | `PhaseStateMachine` — single source of truth. |
| `src/types.ts` | All shared types (`TDDPhase`, `TDDConfig`, `PhaseState`, `TestSignal`, etc.). |
| `src/config.ts` | Loads + merges `~/.pi/agent/settings.json` and `<cwd>/.pi/settings.json`. |
| `src/guidelines.ts` | Default per-phase prompt blocks; `guidelinesForPhase`. |
| `src/prompt.ts` | `buildSystemPrompt` (dormant / disabled / engaged). |
| `src/gate.ts` | Deterministic phase gate (SPEC blocks writes; other phases record diffs). |
| `src/transition.ts` | `extractTestSignal`, `isTestCommand`, `evaluateTransition`. |
| `src/engagement.ts` | `createEngageTool`, `createDisengageTool`, `applyLifecycleHooks`, `maybeRunPostflightOnDisengage`. |
| `src/review-tools.ts` | Standalone `tdd_preflight` / `tdd_postflight` agent tools. |
| `src/preflight.ts` | Spec checklist review (priming the cycle). Blocks entry to RED on failure. |
| `src/postflight.ts` | End-of-cycle review (proving the cycle). Surfaces gaps but does not block. |
| `src/reviews.ts` | `runReview`, `resolveReviewModel`, `extractJSON`. |
| `src/commands.ts` | `handleTddCommand` — every `/tdd` subcommand. |
| `src/persistence.ts` | `persistState` / `restoreState` for `tdd_state` session entries. |
| `src/externals.d.ts` | Hand-rolled type shim for `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`. |

### Backwards-compat aliases worth knowing

The codebase carries deprecated aliases that `loadConfig` translates on the fly: `startInPlanMode → startInSpecMode`, `judgeProvider/judgeModel → reviewProvider/reviewModel`, `guidelines.plan → guidelines.spec`, and the legacy phase value `"PLAN" → "SPEC"`. Internally, the spec checklist is still stored on `PhaseState.plan` / `planCompleted` — the field name is historical.

## Pi extension API

When you need to know the real shape of the Pi extension API, **read the source in `~/sandbox/pi-mono`, not `src/externals.d.ts`**. The shim is hand-maintained and lags behind. Key paths:

- `~/sandbox/pi-mono/packages/coding-agent/src/core/extensions/types.ts` — full `ExtensionAPI`, `ToolDefinition`, all event types
- `~/sandbox/pi-mono/packages/coding-agent/examples/extensions/` — working examples (`todo.ts` for `registerTool`, `dynamic-tools.ts` for `promptSnippet` / `promptGuidelines`)
- `~/sandbox/pi-mono/packages/coding-agent/docs/extensions.md` — extension docs

If you find the shim missing something Pi actually supports, update `src/externals.d.ts` to match.

## Coding guidelines

`CODING_GUIDELINES.md` is the project's style guide. Key points: simplicity first, no speculative features or future-proofing, functions ≤ ~30 lines, nesting ≤ 3 levels, prefer pure functions, and structure tests as specifications of behavior rather than implementation details.
