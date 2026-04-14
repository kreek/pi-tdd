import type { TrialConfig } from "../../types.js";

const config: TrialConfig = {
  name: "palindrome-check",
  description: "Palindrome checker with Unicode support",
  prdFile: "PRD.md",
  taskCount: 1,
  plugin: "pi-tdd",
  features: ["test-command-detect", "phase-gating", "red-green-refactor"],
  variants: {
    "typescript-vitest": {
      stacks: { language: "TypeScript", testFramework: "Vitest" },
    },
    "python-pytest": {
      stacks: { language: "Python", testFramework: "pytest", setup: "Create a pyproject.toml." },
    },
    "go-gotest": {
      stacks: { language: "Go", testFramework: "go test", setup: "Create a go.mod." },
    },
  },
};

export default config;
