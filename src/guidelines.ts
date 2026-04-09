import type { GuidelinesConfig, TDDPhase } from "./types.js";

// ---------------------------------------------------------------------------
// Default guidelines — the built-in way of working, overridable via config
// ---------------------------------------------------------------------------

export const DEFAULTS: Readonly<GuidelinesConfig> = {
  spec: `Specification guidelines:
- Treat SPEC as an optional preflight step for turning the user's request into testable behavior.
- Translate the request into a user story, concrete acceptance criteria, and the tests that will prove them.
- Reason then code: show logic before implementing complex solutions.
- Default to established, proven technologies unless newer approaches are requested.
- Contract-first: define interfaces and contracts before implementation when building integrations.
- Offer alternatives with trade-offs when appropriate.
- Break down complex problems incrementally.
- Ask about backwards compatibility rather than assuming — it can add unnecessary code.`,

  red: `Testing guidelines:
- Tests as specifications: structure tests to articulate WHAT the code should do, not HOW.
- New developers should understand functionality by reading tests.
- Use unit tests for domain logic, integration tests for API contracts and component interactions.
- Start with the happy path test. Handle edge cases in subsequent RED cycles unless security concerns.`,

  green: `Implementation guidelines:
- Simplicity first: generate the most direct solution that meets the test.
- Implement ONLY what's asked. No extra features, no future-proofing unless requested.
- Write explicit, straightforward code. Avoid clever one-liners.
- Favor pure functions, minimize side effects.
- Functions: 25-30 lines max. Use early returns / guard clauses to reduce complexity.
- Skip retry logic and other complexity unless explicitly needed.
- Use built-in features when sufficient; add packages only when they save significant time.`,

  refactor: `Refactoring guidelines:
- Limit nesting: keep conditionals/loops under 3 layers.
- Unix philosophy: each function does one thing well. Prefer composition.
- Concrete over abstract: avoid abstraction unless it adds real value.
- Feature-first organization: group by functionality, then by type.
- Functions: 25-30 lines max. Break up longer functions.
- No unnecessary complexity. Clean, focused code only.`,

  universal: `General guidelines:
- Show your work: explain key decisions and non-obvious choices.
- Ask questions: clarify ambiguous requirements before proceeding.
- Implement only what's asked: no extra features or future-proofing unless requested.`,

  security: `Security guidelines:
- Think security: consider implications even when not mentioned.
- NEVER commit secrets, API keys, or credentials to version control.
- Use environment variables, secret management systems, or secure vaults.
- Validate inputs, especially user data, at system boundaries.`,
};

// ---------------------------------------------------------------------------
// Resolve config — merge user overrides with defaults
// ---------------------------------------------------------------------------

export function resolveGuidelines(
  user: (Partial<GuidelinesConfig> & { plan?: string | null }) | undefined
): GuidelinesConfig {
  if (!user) return { ...DEFAULTS };
  const spec =
    user.spec !== undefined
      ? user.spec
      : user.plan !== undefined
        ? user.plan
        : DEFAULTS.spec;
  return {
    spec,
    red: user.red === undefined ? DEFAULTS.red : user.red,
    green: user.green === undefined ? DEFAULTS.green : user.green,
    refactor: user.refactor === undefined ? DEFAULTS.refactor : user.refactor,
    universal: user.universal === undefined ? DEFAULTS.universal : user.universal,
    security: user.security === undefined ? DEFAULTS.security : user.security,
  };
}

// ---------------------------------------------------------------------------
// Select guidelines for the current phase
// ---------------------------------------------------------------------------

export function guidelinesForPhase(
  phase: TDDPhase,
  config: GuidelinesConfig
): string {
  const sections: string[] = [];

  // Phase-specific
  const phaseKey = phase.toLowerCase() as keyof GuidelinesConfig;
  const phaseBlock = config[phaseKey];
  if (phaseBlock) sections.push(phaseBlock);

  // Universal (always)
  if (config.universal) sections.push(config.universal);

  // Security (always)
  if (config.security) sections.push(config.security);

  return sections.join("\n\n");
}
