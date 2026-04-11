import { describe, expect, it } from "vitest";
import { buildHudLines, hiddenThinkingLabel, type HudTheme } from "../src/hud.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig, PhaseState } from "../src/types.ts";

function makeConfig(overrides: Partial<TDDConfig> = {}): TDDConfig {
  return {
    enabled: true,
    reviewModel: null,
    reviewProvider: null,
    reviewModels: {},
    autoTransition: true,
    refactorTransition: "user",
    allowReadInAllPhases: true,
    maxDiffsInContext: 5,
    persistPhase: true,
    startInSpecMode: false,
    defaultEngaged: false,
    runPreflightOnRed: true,
    engageOnTools: [],
    disengageOnTools: [],
    guidelines: resolveGuidelines({}),
    ...overrides,
  };
}

function makeState(overrides: Partial<PhaseState> = {}): PhaseState {
  return {
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
    ...overrides,
  };
}

function makeTheme(): HudTheme {
  return {
    fg: (color, text) => `<${color}>${text}</${color}>`,
    bold: (text) => `*${text}*`,
  };
}

describe("buildHudLines", () => {
  it("hides the HUD when dormant", () => {
    const lines = buildHudLines(makeState(), makeConfig());

    expect(lines).toBeUndefined();
  });

  it("keeps SPEC visibly read-only after the checklist exists", () => {
    const lines = buildHudLines(
      makeState({
        enabled: true,
        phase: "SPEC",
        plan: ["Redirecting an existing slug returns a 302 to the stored destination."],
      }),
      makeConfig()
    );

    expect(lines?.[0]).toContain("[pi-tdd] SPEC");
    expect(lines).toContain("spec: 0/1");
  });

  it("shows phase, checklist, last test, and proof checkpoint when engaged", () => {
    const lines = buildHudLines(
      makeState({
        enabled: true,
        phase: "GREEN",
        cycleCount: 2,
        plan: [
          "After creating a link via POST /api/links, GET /[slug] redirects to the destination URL.",
          "GET /[slug] returns 404 when the slug does not exist.",
        ],
        recentTests: [
          {
            command: "npx vitest --run src/routes/[slug]/server.spec.ts",
            output: "1 failed",
            failed: true,
            level: "integration",
          },
        ],
        requestedSeam: "business_http",
        proofCheckpoint: {
          itemIndex: 1,
          item: "After creating a link via POST /api/links, GET /[slug] redirects to the destination URL.",
          seam: "business_http",
          command: "npx vitest --run src/routes/[slug]/server.spec.ts",
          commandFamily: "vitest",
          level: "integration",
          testFiles: ["src/routes/[slug]/server.spec.ts"],
          mutationCountAtCapture: 1,
        },
      }),
      makeConfig()
    );

    expect(lines?.[0]).toContain("[pi-tdd] GREEN");
    expect(lines?.[0]).toContain("cycle 2");
    expect(lines?.[0]).toContain("spec 0/2");
    expect(lines).toContain("spec: 0/2");
    expect(lines).toContain(
      "  >> 1. After creating a link via POST /api/links, GET /[slug] redirects to the..."
    );
    expect(lines).toContain("test: FAIL | npx vitest --run src/routes/[slug]/server.spec.ts");
    expect(lines).toContain("result: 1 failed");
    expect(lines).toContain("seam: HTTP -> HTTP");
    expect(lines).toContain(
      "proof: item 1 | INTEGRATION | npx vitest --run src/routes/[slug]/server.spec.ts"
    );
    expect(lines).toContain("files: src/routes/[slug]/server.spec.ts");
  });

  it("shows that RED is still waiting for the first failing proof when no checkpoint exists", () => {
    const lines = buildHudLines(
      makeState({
        enabled: true,
        phase: "RED",
        plan: [
          "POST /api/links with a missing or invalid destination URL returns a validation error response and does not create a link.",
        ],
        recentTests: [
          {
            command: "npm test -- src/routes/api/links/+server.spec.ts",
            output: "1 passed",
            failed: false,
            level: "integration",
          },
        ],
        requestedSeam: "business_http",
      }),
      makeConfig()
    );

    expect(lines).toContain("proof: none yet | item 1 needs first FAIL in RED");
  });

  it("styles the HUD like a test panel when a theme is available", () => {
    const lines = buildHudLines(
      makeState({
        enabled: true,
        phase: "GREEN",
        cycleCount: 1,
        requestedSeam: "business_http",
        plan: [
          "Generating a slug with a configured length returns that many characters.",
          "Generating a slug without config falls back to the default length.",
        ],
        planCompleted: 1,
        proofCheckpoint: {
          itemIndex: 2,
          item: "Generating a slug without config falls back to the default length.",
          seam: "internal_support",
          command: "npm run test:unit",
          commandFamily: "npm:test:unit",
          level: "unit",
          testFiles: ["src/lib/server/utils/slug.spec.ts"],
          mutationCountAtCapture: 1,
        },
        recentTests: [
          {
            command: "npm test",
            output: "Test Files  3 passed (3)\nTests  8 passed (8)",
            failed: false,
            level: "unknown",
          },
        ],
      }),
      makeConfig(),
      makeTheme()
    );

    expect(lines?.[0]).toContain("<accent>*[pi-tdd]*</accent>");
    expect(lines?.[0]).toContain("<success>GREEN</success>");
    expect(lines).toContain("<accent>*spec*</accent>: <muted>1/2</muted>");
    expect(lines).toContain(
      "  <success>OK</success> <muted>1.</muted> <muted>Generating a slug with a configured length returns that many characters.</muted>"
    );
    expect(lines).toContain(
      "  <accent>>></accent> <muted>2.</muted> <text>Generating a slug without config falls back to the default length.</text>"
    );
    expect(lines).toContain("<accent>*result*</accent>: <muted>Tests  8 passed (8)</muted>");
    expect(lines).toContain("<accent>*seam*</accent>: <accent>HTTP</accent> <dim>-></dim> <warning>SUPPORT</warning>");
  });
});

describe("hiddenThinkingLabel", () => {
  it("tracks dormant versus engaged phase labels", () => {
    expect(hiddenThinkingLabel(makeState(), makeConfig())).toBe("pi-tdd: dormant");
    expect(
      hiddenThinkingLabel(
        makeState({ enabled: true, phase: "SPEC" }),
        makeConfig()
      )
    ).toBe("pi-tdd: SPEC");
    expect(
      hiddenThinkingLabel(
        makeState({
          enabled: true,
          phase: "GREEN",
          requestedSeam: "business_http",
          proofCheckpoint: {
            itemIndex: 1,
            item: "works",
            seam: "internal_support",
            command: "npm run test:unit",
            commandFamily: "npm:test:unit",
            level: "unit",
            testFiles: [],
            mutationCountAtCapture: 0,
          },
        }),
        makeConfig()
      )
    ).toBe("pi-tdd: GREEN | HTTP -> SUPPORT");
  });
});
