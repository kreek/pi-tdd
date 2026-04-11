import type { PhaseState, TDDConfig, TestProofLevel } from "./types.js";
import { seamShortLabel } from "./seams.js";

const MAX_SPEC_ITEMS = 4;
const MAX_LINE_LENGTH = 100;
const MAX_COMMAND_LENGTH = 72;
const MAX_ITEM_LENGTH = 84;
const MAX_FILES_LENGTH = 88;
const MAX_RESULT_LENGTH = 88;

type HudThemeColor = "accent" | "success" | "error" | "warning" | "muted" | "dim" | "text";

export interface HudTheme {
  fg(color: HudThemeColor, text: string): string;
  bold(text: string): string;
}

export function buildHudLines(
  state: Readonly<PhaseState>,
  config: Pick<TDDConfig, "enabled">,
  theme?: HudTheme
): string[] | undefined {
  if (!config.enabled || !state.enabled) {
    return undefined;
  }

  const lastTest = state.recentTests[state.recentTests.length - 1] ?? null;
  const lines = [buildHeader(state, lastTest, theme)];

  if (state.plan.length > 0) {
    lines.push(buildSpecHeader(state, theme));
    lines.push(...specLines(state.plan, theme));
  }

  if (lastTest) {
    lines.push(buildTestLine(lastTest, theme));
    const resultLine = buildResultLine(lastTest, theme);
    if (resultLine) {
      lines.push(resultLine);
    }
  }

  if (shouldShowSeamLine(state)) {
    lines.push(buildSeamLine(state, theme));
  }

  if (state.proofCheckpoint) {
    lines.push(buildProofLine(state.proofCheckpoint, theme));
    if (state.proofCheckpoint.testFiles.length > 0) {
      lines.push(buildFilesLine(state.proofCheckpoint.testFiles, theme));
    }
  } else if (state.phase === "RED") {
    lines.push(buildPendingProofLine(theme));
  }

  return lines;
}

export function hiddenThinkingLabel(
  state: Readonly<PhaseState>,
  config: Pick<TDDConfig, "enabled">
): string | undefined {
  if (!config.enabled) {
    return undefined;
  }

  if (!state.enabled) {
    return "pi-tdd: dormant";
  }

  if (!state.requestedSeam) {
    return `pi-tdd: ${state.phase}`;
  }

  const proofSeam = state.proofCheckpoint?.seam ?? null;
  const drift = proofSeam && proofSeam !== "unknown" && proofSeam !== state.requestedSeam;
  const seamLabel = drift
    ? `${seamShortLabel(state.requestedSeam)} -> ${seamShortLabel(proofSeam)}`
    : seamShortLabel(state.requestedSeam);
  return `pi-tdd: ${state.phase} | ${seamLabel}`;
}

function buildHeader(
  state: Readonly<PhaseState>,
  lastTest: PhaseState["recentTests"][number] | null,
  theme?: HudTheme
): string {
  const parts = [
    {
      raw: `[pi-tdd] ${state.enabled ? state.phase : "dormant"}`,
      styled: `${styleBrand(theme)} ${stylePhase(state, theme)}`,
    },
  ];

  if (state.enabled) {
    parts.push(headerPart(`cycle ${state.cycleCount}`, styleMeta(`cycle ${state.cycleCount}`, theme)));
  }

  if (state.plan.length > 0) {
    parts.push(
      headerPart(
        `spec ${state.plan.length}`,
        styleMeta(`spec ${state.plan.length}`, theme)
      )
    );
  }

  if (lastTest) {
    parts.push(
      headerPart(
        `last ${lastTest.failed ? "FAIL" : "PASS"}`,
        `${styleMeta("last", theme)} ${styleTestStatus(lastTest.failed, theme)}`
      )
    );

    const used = joinRawParts(parts).length + 3;
    const command = truncate(lastTest.command, Math.max(16, Math.min(MAX_COMMAND_LENGTH, MAX_LINE_LENGTH - used)));
    parts.push(headerPart(command, styleMeta(command, theme)));
  }

  return joinStyledParts(parts, theme);
}

function buildSpecHeader(state: Readonly<PhaseState>, theme?: HudTheme): string {
  const title = styleBold("spec", "accent", theme);
  const count = styleMeta(`${state.plan.length} item(s)`, theme);
  return `${title}: ${count}`;
}

function buildTestLine(lastTest: PhaseState["recentTests"][number], theme?: HudTheme): string {
  const command = truncate(lastTest.command, MAX_LINE_LENGTH - 13);
  return [
    styleLabel("test", theme),
    styleTestStatus(lastTest.failed, theme),
    styleDim("|", theme),
    styleText(command, theme),
  ].join(" ");
}

function buildResultLine(lastTest: PhaseState["recentTests"][number], theme?: HudTheme): string | null {
  const summary = summarizeTestOutput(lastTest.output);
  if (!summary) {
    return null;
  }

  return `${styleLabel("result", theme)} ${styleMeta(truncate(summary, MAX_RESULT_LENGTH), theme)}`;
}

function buildSeamLine(state: Readonly<PhaseState>, theme?: HudTheme): string {
  const requested = seamShortLabel(state.requestedSeam);
  const proof = seamShortLabel(state.proofCheckpoint?.seam);
  const drift = state.proofCheckpoint &&
    state.requestedSeam &&
    state.proofCheckpoint.seam !== "unknown" &&
    state.proofCheckpoint.seam !== state.requestedSeam;

  const proofColor = drift ? "warning" : "muted";
  return [
    styleLabel("seam", theme),
    styleText(requested, theme, "accent"),
    styleDim("->", theme),
    styleText(proof, theme, proofColor),
  ].join(" ");
}

function buildProofLine(
  proofCheckpoint: NonNullable<PhaseState["proofCheckpoint"]>,
  theme?: HudTheme
): string {
  const itemPart = proofCheckpoint.itemIndex ? `item ${proofCheckpoint.itemIndex}` : "item ?";
  const command = truncate(
    proofCheckpoint.command,
    MAX_LINE_LENGTH - itemPart.length - formatProofLevel(proofCheckpoint.level).length - 14
  );
  return [
    styleBold("proof", "accent", theme) + ":",
    styleMeta(itemPart, theme),
    styleDim("|", theme),
    styleProofLevel(proofCheckpoint.level, theme),
    styleDim("|", theme),
    styleText(command, theme),
  ].join(" ");
}

function buildFilesLine(testFiles: string[], theme?: HudTheme): string {
  const files = truncate(testFiles.join(", "), MAX_FILES_LENGTH - 7);
  return `${styleLabel("files", theme)} ${styleMeta(files, theme)}`;
}

function buildPendingProofLine(theme?: HudTheme): string {
  return [
    styleBold("proof", "accent", theme) + ":",
    styleText("none yet", theme, "warning"),
    styleDim("|", theme),
    styleMeta("needs first FAIL in RED", theme),
  ].join(" ");
}

function specLines(plan: string[], theme?: HudTheme): string[] {
  const visible = plan.slice(0, MAX_SPEC_ITEMS).map((item, index) => {
    const indexLabel = `${index + 1}.`;
    const itemText = truncate(item, MAX_ITEM_LENGTH - indexLabel.length - 4);
    if (!theme) {
      return `  ${indexLabel} ${itemText}`;
    }
    return [
      "  ",
      theme.fg("muted", indexLabel),
      " ",
      theme.fg("text", itemText),
    ].join("");
  });

  if (plan.length > MAX_SPEC_ITEMS) {
    const extra = `  .. ${plan.length - MAX_SPEC_ITEMS} more item(s)`;
    visible.push(theme ? `${theme.fg("dim", "  ..")} ${theme.fg("muted", `${plan.length - MAX_SPEC_ITEMS} more item(s)`)}` : extra);
  }

  return visible;
}

function shouldShowSeamLine(state: Readonly<PhaseState>): boolean {
  return !!state.requestedSeam || !!state.proofCheckpoint;
}

function formatProofLevel(level: TestProofLevel): string {
  switch (level) {
    case "unit":
      return "UNIT";
    case "integration":
      return "INTEGRATION";
    default:
      return "UNKNOWN";
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function summarizeTestOutput(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const summaryLine = [...lines].reverse().find((line) => /\b(?:passed|failed|errors?|skipped)\b/i.test(line));
  return summaryLine ?? lines[lines.length - 1] ?? null;
}

function styleBrand(theme?: HudTheme): string {
  return styleBold("[pi-tdd]", "accent", theme);
}

function stylePhase(state: Readonly<PhaseState>, theme?: HudTheme): string {
  if (!state.enabled) {
    return styleMeta("dormant", theme);
  }
  return styleText(state.phase, theme, phaseColor(state.phase));
}

function phaseColor(phase: PhaseState["phase"]): HudThemeColor {
  switch (phase) {
    case "SPEC":
      return "warning";
    case "RED":
      return "error";
    case "GREEN":
      return "success";
    case "REFACTOR":
      return "accent";
  }
}

function styleTestStatus(failed: boolean, theme?: HudTheme): string {
  return styleText(failed ? "FAIL" : "PASS", theme, failed ? "error" : "success");
}

function styleProofLevel(level: TestProofLevel, theme?: HudTheme): string {
  return styleText(formatProofLevel(level), theme, level === "unknown" ? "dim" : "accent");
}

function styleLabel(label: string, theme?: HudTheme): string {
  return `${styleBold(label, "accent", theme)}:`;
}

function styleMeta(text: string, theme?: HudTheme): string {
  return styleText(text, theme, "muted");
}

function styleDim(text: string, theme?: HudTheme): string {
  return styleText(text, theme, "dim");
}

function styleText(text: string, theme?: HudTheme, color: HudThemeColor = "text"): string {
  return theme ? theme.fg(color, text) : text;
}

function styleBold(text: string, color: HudThemeColor, theme?: HudTheme): string {
  if (!theme) {
    return text;
  }
  return theme.fg(color, theme.bold(text));
}

function headerPart(raw: string, styled: string): { raw: string; styled: string } {
  return { raw, styled };
}

function joinRawParts(parts: Array<{ raw: string }>): string {
  return parts.map((part) => part.raw).join(" | ");
}

function joinStyledParts(parts: Array<{ styled: string }>, theme?: HudTheme): string {
  const separator = theme ? theme.fg("dim", " | ") : " | ";
  return parts.map((part) => part.styled).join(separator);
}
