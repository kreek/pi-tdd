# pi-tdd architecture

This document explains how the `pi-tdd` Pi extension is wired together: what
each file does, how the runtime flow moves through them, and where the
important decisions are made.

It is written to be read top-to-bottom. The first half walks through the
runtime as a story (session start → engagement → cycle → disengagement). The
second half is a per-file reference that you can dip into when you need detail
on a specific module.

## 1. What the extension is

`pi-tdd` is a Pi extension that injects a TDD phase gate into a Pi session. It
keeps a coding agent inside a deliberate `SPEC → RED → GREEN → REFACTOR` loop
when it is doing feature or bug-fix work, and stays out of the way otherwise.

It does this by hooking into Pi's extension API:

- It registers four LLM-callable tools: `tdd_engage`, `tdd_disengage`,
  `tdd_preflight`, `tdd_postflight`.
- It registers a `/tdd` slash command for the human operator.
- It listens to Pi's session, turn, tool-call, tool-result, and turn-end
  events.
- It maintains an in-memory `PhaseStateMachine` that tracks the current phase,
  spec checklist, test result, cycle count, and engagement flag.
- It persists that state into the Pi session log so it survives reloads and
  in-session navigation.

The extension is **dormant by default**: a fresh session does not gate
anything. It only activates when the agent calls `tdd_engage`, when the user
runs an explicit `/tdd <phase>` command, or when a configured lifecycle hook
fires.

## 2. The runtime flow

The diagram below shows the high-level flow of a single session.

```
                      ┌─────────────────────────┐
                      │  Pi loads the extension │
                      │   (activate(pi))        │
                      └────────────┬────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────┐
              │  index.ts: registers tools, command, │
              │  and event handlers; creates an      │
              │  initial dormant PhaseStateMachine.  │
              └────────────┬─────────────────────────┘
                           │
                           ▼
                ┌──────────────────────────┐
                │  session_start /         │
                │  session_tree event      │
                │  → rehydrateState()      │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │  loadConfig() reads      │
                │  global + project        │
                │  .pi/settings.json       │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │  restoreState() pulls    │
                │  the last persisted      │
                │  TDD state if any        │
                └────────────┬─────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │  Each user prompt = a turn loop:           │
        │                                            │
        │   before_agent_start → buildSystemPrompt   │
        │           ↓                                │
        │   turn_start (clear pending signals)       │
        │           ↓                                │
        │   tool_call → applyLifecycleHooks          │
        │             → gateSingleToolCall           │
        │           ↓                                │
        │   tool_result → extractTestSignal          │
        │           ↓                                │
        │   turn_end → evaluateTransition            │
        │             → persistState                 │
        └────────────────────────────────────────────┘
```

The rest of this section walks each phase of that flow in order.

### 2.1 Activation

`src/index.ts:activate(pi)` is the entry point Pi calls when it loads the
extension. It:

1. Constructs an initial `PhaseStateMachine` in `RED`, `enabled: false`. This
   placeholder is replaced as soon as `session_start` fires and the real
   config is loaded — but the machine instance itself lives for the whole
   session and is the single source of truth for engagement and phase.
2. Builds an `EngagementDeps` bundle (`pi`, `machine`, `getConfig`) that the
   four LLM tools share so they can read config lazily after `loadConfig` has
   run.
3. Registers the four tools (`createEngageTool`, `createDisengageTool`,
   `createPreflightTool`, `createPostflightTool`) and the `/tdd` slash
   command.
4. Wires up handlers for the Pi session events: `session_start`,
   `session_tree`, `before_agent_start`, `turn_start`, `tool_call`,
   `tool_result`, `turn_end`.

There is no `judge.ts` anymore. Per-tool-call LLM gating was deliberately
removed: the system prompt steers the agent during the cycle, deterministic
test signals drive transitions, and LLM review only fires at cycle boundaries
(preflight and postflight).

### 2.2 Session start and rehydration

When Pi starts a session, two events can fire: `session_start` (a brand-new
session, reload, or fork) and `session_tree` (in-session navigation between
branches of the conversation tree). Both routes call `rehydrateState`.

`rehydrateState(ctx, { freshSession })` does three things:

1. **Refreshes the config.** `refreshConfig(ctx)` calls `loadConfig(ctx.cwd)`
   and caches the result keyed on `ctx.cwd`. Switching projects mid-session
   reloads the right config.
2. **Restores persisted state.** If `persistPhase` is on, `restoreState(ctx)`
   walks the session entries backwards looking for the most recent
   `tdd_state` custom entry and rebuilds a `PersistedTddState`.
3. **Decides whether to be engaged.** This is the important rule:
   - On a **fresh** session (`freshSession: true`), engagement is set to
     `defaultEngaged` regardless of what was persisted. Engagement does not
     leak between sessions — every new session starts dormant unless the
     user opted into legacy always-on behaviour via `defaultEngaged: true`.
   - On a **session_tree** navigation, engagement comes from the persisted
     state. Within-session branch navigation preserves the live state.

The phase, spec checklist, cycle count, and last test result are restored
either way. The machine is then handed back via `machine.restore(...)`, and
the bottom-bar status is updated.

### 2.3 Building the system prompt for each turn

When the agent is about to start a turn, Pi fires `before_agent_start` with
the current system prompt. The handler appends `buildSystemPrompt(machine,
config)` to it. That function (in `src/prompt.ts`) returns one of three things:

- **Config disabled.** A short `[TDD MODE - DISABLED]` line.
- **Dormant.** A `[TDD MODE - dormant]` block telling the agent that TDD is
  not enforcing anything right now and instructing it to call `tdd_engage`
  before starting feature or bug-fix work, plus a list of any
  `engageOnTools` it should know about.
- **Engaged.** A phase-specific block:
  - the phase header,
  - a few phase-specific bullet points (RED: write failing test first; GREEN:
    minimum implementation; etc.),
  - the resolved guidelines from `guidelinesForPhase` (phase + universal +
    security),
  - the current spec item if a checklist exists,
  - the allowed/prohibited summary from the state machine,
  - last test result and cycle count.

This is the only place the agent gets phase guidance during the cycle. There
is no per-tool-call LLM judge whispering in its ear — the system prompt does
the steering.

### 2.4 Tool calls: lifecycle hooks and the gate

`turn_start` clears `pendingSignals` (the buffer of test signals seen during
the turn).

For every tool the agent tries to call, Pi fires `tool_call`. The handler runs
two passes:

1. **`applyLifecycleHooks(toolName, deps, ctx)`** in `src/engagement.ts`
   handles two things:
   - If the tool is one of `tdd_engage`, `tdd_disengage`, `tdd_preflight`,
     `tdd_postflight`, it returns `{ isControlTool: true }` so the gate
     skips it. Control tools are never themselves gated.
   - Otherwise, it checks `engageOnTools` and `disengageOnTools` from the
     config. If the tool name matches one of those, the machine is flipped
     on or off accordingly. The disengage path runs postflight first via
     `maybeRunPostflightOnDisengage` so lifecycle-driven disengagement
     honours the same proving step as `tdd_disengage`.
2. **`gateSingleToolCall(event, machine, config, ctx)`** in `src/gate.ts` is
   the actual gate. The rules are very small:
   - If TDD is dormant or config-disabled, every call passes through.
   - Read-only tools (`read`, `grep`, `find`, `ls`) pass through if
     `allowReadInAllPhases` is on.
   - A `bash` call that runs a test command is allowed in any phase except
     SPEC, with the diff recorded for downstream review.
   - In `SPEC`, a `write`, `edit`, or `bash` call is blocked unless the user
     confirms an override. Blocking returns `{ block: true, reason }` to Pi,
     which short-circuits the tool call and reports the reason to the agent.
   - In `RED`, `GREEN`, and `REFACTOR`, the gate is a passthrough — it just
     records the diff into `machine.diffs` for postflight context.

The gate's design intent: **the cycle should run unimpeded once it starts**.
The expensive review steps live at the boundaries (`tdd_engage → preflight`
and `tdd_disengage → postflight`), not at every keystroke.

### 2.5 Tool results: collecting test signals

For every `tool_result`, the handler calls
`extractTestSignal(event)` from `src/transition.ts`. That function:

- Returns `null` for any non-`bash` result.
- Returns `null` if the executed command does not look like a test command,
  using `isTestCommand` (which understands `npm test`, `pnpm test`,
  `pytest`, `cargo test`, `go test`, `vitest`, `jest`, `rspec`, shell
  wrappers, and `./scripts/test*` style invocations).
- Otherwise, returns a `TestSignal` containing the command, the joined text
  output, and `event.isError` as the failed flag.

Each detected signal is pushed into `pendingSignals` for that turn.

### 2.6 Turn end: evaluating transitions and persisting

When the turn finishes, the handler calls
`evaluateTransition(pendingSignals, machine, config, ctx)` in
`src/transition.ts`.

`evaluateTransition` only acts if both config and machine are enabled and
`autoTransition` is on. It:

1. Records every signal into the machine via `recordTestResult` so the latest
   test output and pass/fail are stored.
2. Skips transition entirely while in `SPEC` (SPEC is human-controlled).
3. Skips `REFACTOR → RED` if `refactorTransition` is `"user"` (the default).
4. Asks `fallbackTransition` for a deterministic verdict:
   - `RED → GREEN` only if at least one signal failed (a confirmed RED).
   - `GREEN → REFACTOR` only if at least one signal passed.
5. If the verdict matches the expected next phase, calls `transitionTo` and
   updates the bottom-bar status with a notification.

After the transition pass, `persistState(pi, machine)` appends a `tdd_state`
custom entry to the Pi session log so the next `rehydrateState` can pick it
up. `pendingSignals` is reset.

### 2.7 The slash command

`/tdd` is registered with `pi.registerCommand("tdd", ...)`. The handler
delegates to `handleTddCommand` in `src/commands.ts`. That function:

- `/tdd status` — prints phase, enabled flag, cycle, test state, diff count,
  and spec progress.
- `/tdd spec | red | green | refactor` — engages TDD if dormant and
  transitions to the chosen phase. Crucially, `SPEC → RED` runs preflight
  first when `runPreflightOnRed` is on; if preflight fails, the transition
  is blocked with no override path.
- `/tdd spec-set "..." "..."` — replaces the spec checklist via
  `machine.setPlan(items)`. Older `plan-*` aliases still resolve here.
- `/tdd spec-show`, `/tdd spec-done` — display or advance the checklist.
- `/tdd preflight` / `/tdd postflight` — run those reviews on demand against
  the current state.
- `/tdd engage | on` / `/tdd disengage | off` — flip the machine on/off.
  `disengage` runs postflight via `maybeRunPostflightOnDisengage` first when
  eligible.
- `/tdd history` — print the in-memory transition log.

After every command, `persistState` is called (if persistence is on) and the
bottom bar is refreshed. Output goes through `publish()` in `index.ts`, which
either renders a multi-line widget in the UI or sends a custom message
without triggering a new turn.

### 2.8 Engagement, preflight, and postflight in detail

The engagement layer is the cycle's bookend. It is implemented in
`src/engagement.ts` and `src/review-tools.ts`, with the actual review logic
in `src/preflight.ts` and `src/postflight.ts` and a shared LLM helper in
`src/reviews.ts`.

**Engaging into RED** is the priming gate. Whether you arrive there via
`tdd_engage(phase: "RED")`, `/tdd red`, or by transitioning out of SPEC,
`runPreflight` is invoked against the current spec checklist:

1. If the checklist is empty, preflight returns a hard failure with no LLM
   call.
2. Otherwise, `runReview` is called with a strict reviewer system prompt.
   The reviewer is asked to verify each spec item is observable, testable,
   atomic, and tied to user-visible behaviour, and to flag gaps in coverage.
3. The model responds with JSON. `parsePreflightResponse` extracts it and
   produces a `{ ok, reason, issues }` shape.
4. If `ok` is false, the engage tool refuses to enter RED and tells the
   agent to refine the spec. The slash command path does the same with no
   override.

**Disengaging from a feature** is the proving gate. Whether you arrive there
via `tdd_disengage`, `/tdd disengage`, or a `disengageOnTools` lifecycle
hook, `maybeRunPostflightOnDisengage` is invoked. It only runs postflight
when:

- TDD was actually engaged,
- a spec checklist exists, and
- the most recent test signal was a *pass* (a `null` lastTestFailed — meaning
  no test was ever observed during the engagement — is *not* eligible).

When eligible, `runPostflight` builds a prompt that includes the spec
checklist, the cycle count, the last test result and (truncated) output, and
the recent diff summaries. The reviewer is asked to confirm every spec item
has a passing test, the implementation matches what the spec describes, and
there is no obvious gap or feature creep. The result is parsed into
`{ ok, reason, gaps }` and surfaced to the agent and user. **Postflight
failure never blocks disengagement** — the goal is to surface gaps, not to
trap the operator in a feature.

`tdd_preflight` and `tdd_postflight` exist as standalone tools so the agent
or user can explicitly request a mid-flow checkpoint, but the system is
designed so you do not normally need them — engaging and disengaging is
enough.

### 2.9 The phase state machine

`PhaseStateMachine` in `src/phase.ts` is the in-memory hub. It owns:

- the current `phase`,
- the `enabled` flag (engagement),
- the `diffs` rolling buffer (capped by `maxDiffsInContext`),
- `lastTestOutput` / `lastTestFailed` from the most recent test signal,
- the `cycleCount` (incremented on `REFACTOR → RED`),
- the spec checklist (`plan` is the historical field name) and its
  `planCompleted` cursor,
- a `history: PhaseTransitionLog[]` of every transition, which `/tdd history`
  reads.

Important methods:

- `transitionTo(target, reason, override?)` is the only way to change phase.
  It records a history entry, increments cycle count on `REFACTOR → RED`,
  and clears the `diffs` buffer (so each new phase starts with a fresh diff
  context).
- `nextPhase()` returns `RED → GREEN → REFACTOR → RED`, with `SPEC → RED` as
  a special case. SPEC sits outside the cycle.
- `restore(state)` overwrites the entire state from a persisted snapshot.
- `bottomBarText()` returns `undefined` when dormant so Pi hides the
  indicator entirely; otherwise it returns the formatted status.

The state machine has no awareness of LLM calls, config files, or Pi events
— everything that talks to it is in `index.ts`, `engagement.ts`,
`commands.ts`, `gate.ts`, `transition.ts`, and `prompt.ts`. This makes it
trivially unit-testable.

### 2.10 Configuration

`src/config.ts:loadConfig(cwd)` reads two JSON files and merges them:

1. `~/.pi/agent/settings.json` — global defaults for the user.
2. `<cwd>/.pi/settings.json` — per-project overrides.

The `tddGate` block from each is layered, with project settings winning. The
result is merged into `DEFAULTS`, with deprecated aliases (`startInPlanMode`,
`judgeProvider`, `judgeModel`, `guidelines.plan`) translated to their
current names. `resolveGuidelines` applies the default guidelines and
overlays any user overrides.

The full config shape lives in `src/types.ts:TDDConfig`. The fields most
relevant to the runtime flow are:

- `enabled` — master switch.
- `defaultEngaged` — whether fresh sessions auto-engage.
- `startInSpecMode` — if engaging, start in SPEC vs RED.
- `autoTransition` — whether `evaluateTransition` is allowed to move phases.
- `refactorTransition` — `"user"` (default), `"agent"`, or `"timeout"`.
- `runPreflightOnRed` — whether to gate `→ RED` with a preflight review.
- `engageOnTools` / `disengageOnTools` — lifecycle hook tool names.
- `reviewProvider` / `reviewModel` — pin a specific model for preflight and
  postflight reviews; defaults to the session's active model.
- `temperature`, `maxDiffsInContext`, `allowReadInAllPhases`, `persistPhase`.
- `guidelines` — overrideable per-phase prompt blocks.

### 2.11 Persistence

`src/persistence.ts` is intentionally tiny. It stores the
`PersistedTddState` shape (everything from `PhaseState` except history) as a
custom session entry with `customType: "tdd_state"`. `restoreState` walks
the current branch of the session tree backwards and returns the most
recent valid entry. Phase normalization handles the legacy `"PLAN"` value
by mapping it to `"SPEC"`.

This is also why `persistPhase` only controls in-session persistence:
engagement deliberately is *not* persisted across sessions. The
`rehydrateState` logic in `index.ts` overrides whatever was saved when a
fresh session starts.

## 3. Per-file reference

| File | Role |
|---|---|
| `src/index.ts` | Extension entry point. Builds the machine, loads config lazily, registers tools and the `/tdd` command, and wires every Pi event handler to the right module. |
| `src/types.ts` | All shared types: `TDDPhase`, `PhaseState`, `TDDConfig`, `JudgeVerdict`, `TransitionVerdict`, `PersistedTddState`, `TestSignal`, `GuidelinesConfig`. |
| `src/phase.ts` | `PhaseStateMachine`. The single in-memory source of truth for phase, engagement, spec checklist, cycle count, last test result, diff buffer, and transition history. Pure data + logic, no Pi or LLM dependencies. |
| `src/config.ts` | `loadConfig(cwd)`. Reads global + project `settings.json`, merges them, applies deprecated-alias translations, and resolves guidelines. |
| `src/guidelines.ts` | The default per-phase prompt guidelines (spec/red/green/refactor + universal + security), the merge logic for user overrides, and `guidelinesForPhase` which composes the right block for a phase. |
| `src/prompt.ts` | `buildSystemPrompt(machine, config)`. Produces the dormant / disabled / engaged prompt block that gets appended to every `before_agent_start`. The only thing the agent reads about TDD during a turn. |
| `src/gate.ts` | `gateToolCalls` / `gateSingleToolCall`. The deterministic gate. Blocks `write`/`edit`/`bash` in SPEC (with override prompt) and otherwise records diffs into the machine. No LLM calls. |
| `src/transition.ts` | `extractTestSignal` (turns a `bash` tool result into a pass/fail signal), `isTestCommand` (the test-command detector), and `evaluateTransition` (the deterministic state advance at `turn_end`). Also exports `fallbackTransition` for tests. |
| `src/engagement.ts` | The four control entry points: `createEngageTool`, `createDisengageTool`, `applyLifecycleHooks`, and the shared `maybeRunPostflightOnDisengage` helper. Implements the rule that `→ RED` runs preflight and disengagement runs postflight. |
| `src/review-tools.ts` | `createPreflightTool` / `createPostflightTool`. The standalone agent-callable wrappers around `runPreflight` / `runPostflight` for ad-hoc mid-flow checks. |
| `src/preflight.ts` | The "priming the cycle" review. Validates the spec checklist before RED. Builds a strict reviewer prompt, runs it via `runReview`, parses the JSON verdict into `{ ok, reason, issues }`, formats it for display. |
| `src/postflight.ts` | The "proving the cycle" review. Runs after green to validate every spec item has a passing test and the implementation matches the spec. Same shape as preflight but with `gaps` instead of `issues`. Refuses to run while tests are failing. |
| `src/reviews.ts` | Shared LLM infrastructure for preflight and postflight: `runReview` (resolves the model, gets the API key, calls `complete`, returns the text), `resolveReviewModel` (uses configured `reviewProvider`/`reviewModel` or falls back to the session's active model), and `extractJSON` (strips fenced code blocks). |
| `src/commands.ts` | `handleTddCommand`. Implements every `/tdd` subcommand: status, phase switches (with the same preflight gate as `tdd_engage`), spec-set/show/done, preflight, postflight, engage/disengage (with shared postflight helper), history. Also exports `splitCommandArgs` for shell-style argument parsing. |
| `src/persistence.ts` | `persistState` / `restoreState`. Writes and reads `tdd_state` custom entries on the Pi session log. Walks the branch backwards on restore so it picks up the latest snapshot for the current conversation tree branch. Normalises legacy phase values. |
| `src/externals.d.ts` | TypeScript declarations for `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, and the few `node:*` modules used. Lets the package compile without taking a hard dependency on Pi at the type level. |

## 4. The minimal mental model

If you keep these five facts in your head you can reason about the whole
extension:

1. **The `PhaseStateMachine` is the only mutable state.** Every event handler
   either reads or mutates it. Persistence is just snapshotting it onto the
   Pi session log.
2. **The system prompt steers the agent during the cycle.** There is no
   per-tool LLM judge. The gate's only deterministic block is "no
   write/edit/bash in SPEC".
3. **Test signals drive transitions.** `extractTestSignal` converts a `bash`
   tool result into pass/fail; `evaluateTransition` advances `RED → GREEN`
   on a fail and `GREEN → REFACTOR` on a pass. Everything else is human or
   agent driven.
4. **Cycle boundaries are where the LLM reviewers run.** `→ RED` runs
   preflight (priming); `disengage` runs postflight (proving). Both are JSON
   round-trips against a reviewer model. Postflight never blocks disengage;
   preflight does block engagement into RED.
5. **Engagement is per-session.** Persistence keeps the phase and spec but a
   fresh session always starts dormant unless `defaultEngaged: true`. This
   is enforced in `rehydrateState`, not in `restoreState`.
