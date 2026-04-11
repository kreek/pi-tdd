import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PhaseStateMachine } from "./phase.js";
import { loadConfig } from "./config.js";
import { gateSingleToolCall } from "./gate.js";
import { evaluateTransition, extractTestSignal } from "./transition.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { handleTddCommand } from "./commands.js";
import { persistState, restoreState } from "./persistence.js";
import {
  applyLifecycleHooks,
  createEndTool,
  createStartTool,
  type LifecycleDeps,
} from "./engagement.js";
import { createPostflightTool, createPreflightTool } from "./review-tools.js";
import { createRefineFeatureSpecTool } from "./spec-tools.js";
import type { TDDConfig, TestSignal } from "./types.js";
import { buildHudLines, hiddenThinkingLabel } from "./hud.js";
import {
  captureExactText,
  captureText,
  debugRunLogger,
  logDebugRunEvent,
  summarizeConfig,
  summarizeGateResult,
  summarizeState,
  summarizeTestSignal,
  summarizeToolCall,
  summarizeToolResult,
} from "./debug-run-log.js";

const STATUS_KEY = "tdd-gate";
const OUTPUT_TYPE = "tdd-gate-output";
const OUTPUT_WIDGET_KEY = "tdd-gate-command-output";
const HUD_WIDGET_KEY = "tdd-gate-hud";

function createInitialMachine(): PhaseStateMachine {
  return new PhaseStateMachine({
    phase: "RED",
    enabled: false,
  });
}

export default function activate(pi: ExtensionAPI): void {
  const machine = createInitialMachine();
  let config: TDDConfig | null = null;
  let configCwd: string | null = null;
  let pendingSignals: TestSignal[] = [];
  let loggedTransitionCount = 0;

  function refreshConfig(ctx: ExtensionContext): TDDConfig {
    if (!config || configCwd !== ctx.cwd) {
      config = loadConfig(ctx.cwd);
      configCwd = ctx.cwd;
    }
    return config;
  }

  function flushTransitionEvents(source: string): void {
    const history = machine.getHistory();
    if (loggedTransitionCount >= history.length) {
      return;
    }

    for (const transition of history.slice(loggedTransitionCount)) {
      logDebugRunEvent({
        type: "transition",
        source,
        transition,
        state: summarizeState(machine.getSnapshot()),
      });
    }
    loggedTransitionCount = history.length;
  }

  const lifecycleDeps: LifecycleDeps = {
    pi,
    machine,
    getConfig: () => {
      if (!config) {
        throw new Error("TDD config not initialised; lifecycle tool invoked before any session event");
      }
      return config;
    },
  };

  pi.registerTool(createStartTool(lifecycleDeps));
  pi.registerTool(createEndTool(lifecycleDeps));
  pi.registerTool(createRefineFeatureSpecTool(lifecycleDeps));
  pi.registerTool(createPreflightTool(lifecycleDeps));
  pi.registerTool(createPostflightTool(lifecycleDeps));

  function updateHud(ctx: ExtensionContext | ExtensionCommandContext, nextConfig?: TDDConfig): void {
    if (!ctx.hasUI) {
      return;
    }

    const configForHud = nextConfig ?? refreshConfig(ctx);
    ctx.ui.setWidget(
      HUD_WIDGET_KEY,
      buildHudLines(machine.getSnapshot(), configForHud, ctx.ui.theme),
      { placement: "aboveEditor" }
    );
    ctx.ui.setHiddenThinkingLabel(
      hiddenThinkingLabel(machine.getSnapshot(), configForHud)
    );
  }

  function rehydrateState(ctx: ExtensionContext, options: { freshSession: boolean }): void {
    const nextConfig = refreshConfig(ctx);
    const saved = restoreState(ctx);

    // Fresh sessions always start dormant. Within-session tree navigation
    // preserves the live lifecycle state from the saved branch.
    const desiredEnabled = nextConfig.enabled && !options.freshSession && (saved?.enabled ?? false);

    if (saved) {
      machine.restore({
        ...saved,
        enabled: desiredEnabled,
      });
    } else {
      machine.restore({
        phase: "RED",
        diffs: [],
        mutations: [],
        lastTestOutput: null,
        lastTestFailed: null,
        recentTests: [],
        proofCheckpoint: null,
        cycleCount: 0,
        enabled: false,
        plan: [],
        planCompleted: 0,
        requestedSeam: null,
      });
    }

    ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
    updateHud(ctx, nextConfig);
  }

  function publish(ctx: ExtensionContext | ExtensionCommandContext, text: string): void {
    if (ctx.hasUI) {
      const lines = text.split("\n");
      if (lines.length > 1) {
        ctx.ui.setWidget(OUTPUT_WIDGET_KEY, lines);
      } else {
        ctx.ui.setWidget(OUTPUT_WIDGET_KEY, undefined);
        ctx.ui.notify(text, "info");
      }
      return;
    }

    pi.sendMessage(
      {
        customType: OUTPUT_TYPE,
        content: text,
        display: true,
      },
      { triggerTurn: false }
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    pendingSignals = [];
    rehydrateState(ctx, { freshSession: true });
    loggedTransitionCount = machine.getHistory().length;
    const logPath = debugRunLogger.start({
      cwd: ctx.cwd,
      sessionFile: ctx.sessionManager.getSessionFile(),
      reason: _event.reason,
      previousSessionFile: _event.previousSessionFile,
      config: summarizeConfig(refreshConfig(ctx)),
      state: summarizeState(machine.getSnapshot()),
    });
    if (logPath && ctx.hasUI) {
      ctx.ui.notify(`pi-tdd debug logging -> ${logPath}`, "info");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    pendingSignals = [];
    rehydrateState(ctx, { freshSession: false });
    loggedTransitionCount = machine.getHistory().length;
    logDebugRunEvent({
      type: "session_tree",
      newLeafId: _event.newLeafId,
      oldLeafId: _event.oldLeafId,
      fromExtension: _event.fromExtension ?? false,
      state: summarizeState(machine.getSnapshot()),
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const nextConfig = refreshConfig(ctx);
    const tddPrompt = buildSystemPrompt(machine, nextConfig);
    logDebugRunEvent({
      type: "before_agent_start",
      state: summarizeState(machine.getSnapshot()),
      tddPrompt: captureText(tddPrompt),
    });
    return { systemPrompt: `${event.systemPrompt}\n\n${tddPrompt}` };
  });

  pi.on("turn_start", async (_event, _ctx) => {
    pendingSignals = [];
    logDebugRunEvent({
      type: "turn_start",
      turnIndex: _event.turnIndex,
      state: summarizeState(machine.getSnapshot()),
    });
  });

  pi.on("tool_call", async (event, ctx) => {
    const nextConfig = refreshConfig(ctx);
    const beforeState = summarizeState(machine.getSnapshot());
    const lifecycle = await applyLifecycleHooks(event.toolName, lifecycleDeps, ctx);
    if (lifecycle.isControlTool) {
      logDebugRunEvent({
        type: "tool_call",
        ...summarizeToolCall(event),
        lifecycle,
        gate: summarizeGateResult(undefined),
        beforeState,
        afterState: summarizeState(machine.getSnapshot()),
      });
      flushTransitionEvents("tool_call");
      // TDD control tools manipulate cycle state directly and are never gated.
      return undefined;
    }

    if (lifecycle.engaged || lifecycle.disengaged) {
      updateHud(ctx, nextConfig);
    }

    const gateResult = await gateSingleToolCall(event, machine, nextConfig, ctx);
    logDebugRunEvent({
      type: "tool_call",
      ...summarizeToolCall(event),
      lifecycle,
      gate: summarizeGateResult(gateResult),
      beforeState,
      afterState: summarizeState(machine.getSnapshot()),
    });
    flushTransitionEvents("tool_call");
    return gateResult;
  });

  pi.on("tool_result", async (event, ctx) => {
    const signal = extractTestSignal(event);
    if (signal) {
      pendingSignals.push(signal);
    }
    logDebugRunEvent({
      type: "tool_result",
      ...summarizeToolResult(event),
      testSignal: signal ? summarizeTestSignal(signal) : null,
      state: summarizeState(machine.getSnapshot()),
    });
    flushTransitionEvents("tool_result");
    updateHud(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const nextConfig = refreshConfig(ctx);
    const beforeState = summarizeState(machine.getSnapshot());
    const observedSignals = pendingSignals.map(summarizeTestSignal);
    await evaluateTransition(pendingSignals, machine, nextConfig, ctx);
    flushTransitionEvents("turn_end");

    persistState(pi, machine);
    pendingSignals = [];
    ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
    updateHud(ctx, nextConfig);
    logDebugRunEvent({
      type: "turn_end",
      turnIndex: _event.turnIndex,
      stopReason: _event.message.stopReason,
      assistantText: captureExactText(
        _event.message.content
          .filter((item): item is { type: "text"; text: string } => item.type === "text" && !!item.text)
          .map((item) => item.text)
          .join("\n")
      ),
      toolResultCount: _event.toolResults.length,
      observedSignals,
      beforeState,
      afterState: summarizeState(machine.getSnapshot()),
    });
  });

  pi.registerCommand("tdd", {
    description: "Start or end TDD, or begin TDD for a feature or bug request",
    getArgumentCompletions: (prefix) => {
      const commands = ["on", "off"];
      const filtered = commands.filter((command) => command.startsWith(prefix));
      return filtered.map((command) => ({ value: command, label: command }));
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const nextConfig = refreshConfig(ctx);
      const beforeState = summarizeState(machine.getSnapshot());
      await handleTddCommand(args, machine, ctx, (text) => publish(ctx, text), nextConfig);
      flushTransitionEvents("command");
      persistState(pi, machine);
      ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
      updateHud(ctx, nextConfig);
      logDebugRunEvent({
        type: "command",
        command: "/tdd",
        args,
        beforeState,
        afterState: summarizeState(machine.getSnapshot()),
      });
    },
  });
}

export { PhaseStateMachine } from "./phase.js";
export { loadConfig } from "./config.js";
export { gateSingleToolCall } from "./gate.js";
export { evaluateTransition, extractTestSignal, isTestCommand } from "./transition.js";
export { buildSystemPrompt } from "./system-prompt.js";
export { handleTddCommand } from "./commands.js";
export { guidelinesForPhase, resolveGuidelines, DEFAULTS as GUIDELINE_DEFAULTS } from "./guidelines.js";
export { persistState, restoreState, STATE_ENTRY_TYPE } from "./persistence.js";
export { runPreflight } from "./preflight.js";
export { runPostflight } from "./postflight.js";
export type * from "./types.js";
