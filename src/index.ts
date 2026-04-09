import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PhaseStateMachine } from "./phase.js";
import { loadConfig } from "./config.js";
import { gateSingleToolCall } from "./gate.js";
import { evaluateTransition, extractTestSignal } from "./transition.js";
import { buildSystemPrompt } from "./prompt.js";
import { handleTddCommand } from "./commands.js";
import { persistState, restoreState } from "./persistence.js";
import type { TDDConfig, TestSignal } from "./types.js";

const STATUS_KEY = "tdd-gate";
const OUTPUT_TYPE = "tdd-gate-output";
const OUTPUT_WIDGET_KEY = "tdd-gate-command-output";

function createInitialMachine(): PhaseStateMachine {
  return new PhaseStateMachine({
    phase: "RED",
    enabled: true,
  });
}

export default function activate(pi: ExtensionAPI): void {
  const machine = createInitialMachine();
  let config: TDDConfig | null = null;
  let configCwd: string | null = null;
  let pendingSignals: TestSignal[] = [];

  function refreshConfig(ctx: ExtensionContext): TDDConfig {
    if (!config || configCwd !== ctx.cwd) {
      config = loadConfig(ctx.cwd);
      configCwd = ctx.cwd;
    }
    return config;
  }

  function rehydrateState(ctx: ExtensionContext): void {
    const nextConfig = refreshConfig(ctx);
    const saved = nextConfig.persistPhase ? restoreState(ctx) : null;

    if (saved) {
      machine.restore(saved);
    } else {
      machine.restore({
        phase: nextConfig.startInSpecMode ? "SPEC" : "RED",
        diffs: [],
        lastTestOutput: null,
        lastTestFailed: null,
        cycleCount: 0,
        enabled: nextConfig.enabled,
        plan: [],
        planCompleted: 0,
      });
    }

    ctx.ui.setStatus(STATUS_KEY, machine.statusText());
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
    rehydrateState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    pendingSignals = [];
    rehydrateState(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const nextConfig = refreshConfig(ctx);
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt(machine, nextConfig)}`,
    };
  });

  pi.on("turn_start", async (_event, _ctx) => {
    pendingSignals = [];
  });

  pi.on("tool_call", async (event, ctx) => {
    const nextConfig = refreshConfig(ctx);
    return gateSingleToolCall(event, machine, nextConfig, ctx);
  });

  pi.on("tool_result", async (event, _ctx) => {
    const signal = extractTestSignal(event);
    if (signal) {
      pendingSignals.push(signal);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const nextConfig = refreshConfig(ctx);
    await evaluateTransition(pendingSignals, machine, nextConfig, ctx);

    if (nextConfig.persistPhase) {
      persistState(pi, machine);
    }

    pendingSignals = [];
    ctx.ui.setStatus(STATUS_KEY, machine.statusText());
  });

  pi.registerCommand("tdd", {
    description: "Control the TDD phase gate",
    getArgumentCompletions: (prefix) => {
      const commands = [
        "spec",
        "status",
        "red",
        "green",
        "refactor",
        "spec-set",
        "spec-show",
        "spec-done",
        "off",
        "on",
        "history",
      ];
      const filtered = commands.filter((command) => command.startsWith(prefix));
      return filtered.map((command) => ({ value: command, label: command }));
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const nextConfig = refreshConfig(ctx);
      await handleTddCommand(args, machine, ctx, (text) => publish(ctx, text));
      if (nextConfig.persistPhase) {
        persistState(pi, machine);
      }
      ctx.ui.setStatus(STATUS_KEY, machine.statusText());
    },
  });
}

export { PhaseStateMachine } from "./phase.js";
export { loadConfig } from "./config.js";
export { judgeToolCalls, judgeTransition } from "./judge.js";
export { gateSingleToolCall, gateToolCalls } from "./gate.js";
export { evaluateTransition, extractTestSignal, isTestCommand } from "./transition.js";
export { buildSystemPrompt } from "./prompt.js";
export { handleTddCommand } from "./commands.js";
export { guidelinesForPhase, resolveGuidelines, DEFAULTS as GUIDELINE_DEFAULTS } from "./guidelines.js";
export { persistState, restoreState, STATE_ENTRY_TYPE } from "./persistence.js";
export type * from "./types.js";
