import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

type TestRule =
  | { marker: string; command: string }
  | {
      marker: string;
      command: string;
      when: (cwd: string) => Promise<boolean>;
    };

export interface TestProject {
  dir: string;
  name: string;
  command: string;
}

export interface TestConfig {
  command: string;
  cwd: string;
}

export type TestConfigUi = Pick<ExtensionContext["ui"], "input" | "select">;

const TEST_RULES: TestRule[] = [
  { marker: "package.json", command: "npm test", when: hasNpmTestScript },
  { marker: "Cargo.toml", command: "cargo test" },
  { marker: "go.mod", command: "go test ./..." },
  { marker: "pytest.ini", command: "pytest" },
  { marker: "pyproject.toml", command: "pytest" },
  { marker: "setup.py", command: "python -m unittest discover" },
  { marker: "Gemfile", command: "bundle exec rake test" },
  { marker: "mix.exs", command: "mix test" },
  { marker: "*.sln", command: "dotnet test" },
  { marker: "*.csproj", command: "dotnet test" },
  { marker: "*.fsproj", command: "dotnet test" },
  { marker: "pom.xml", command: "mvn test" },
  { marker: "build.gradle", command: "gradle test" },
  { marker: "build.gradle.kts", command: "gradle test" },
  { marker: "phpunit.xml", command: "vendor/bin/phpunit" },
  { marker: "phpunit.xml.dist", command: "vendor/bin/phpunit" },
  { marker: "Makefile", command: "make test", when: makefileHasTestTarget },
];

async function fileExists(cwd: string, name: string): Promise<boolean> {
  if (name.includes("*")) {
    const entries = await fs.promises.readdir(cwd);
    const ext = name.slice(1);
    return entries.some((entry) => entry.endsWith(ext));
  }

  try {
    await fs.promises.access(path.join(cwd, name));
    return true;
  } catch {
    return false;
  }
}

async function hasNpmTestScript(cwd: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(cwd, "package.json"), "utf-8"));
    return Boolean(pkg.scripts?.test);
  } catch {
    return false;
  }
}

async function makefileHasTestTarget(cwd: string): Promise<boolean> {
  try {
    const contents = await fs.promises.readFile(path.join(cwd, "Makefile"), "utf-8");
    return /^test\s*:/m.test(contents);
  } catch {
    return false;
  }
}

export async function inferTestCommand(cwd: string): Promise<string | undefined> {
  for (const rule of TEST_RULES) {
    if (!(await fileExists(cwd, rule.marker))) continue;
    if ("when" in rule && !(await rule.when(cwd))) continue;
    return rule.command;
  }

  return undefined;
}

export async function scanChildDirectories(cwd: string): Promise<TestProject[]> {
  const entries = await fs.promises.readdir(cwd, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const projects: TestProject[] = [];

  for (const entry of directories) {
    const dir = path.join(cwd, entry.name);
    const command = await inferTestCommand(dir);
    if (command) projects.push({ dir, name: entry.name, command });
  }

  return projects;
}

function buildSelectOptions(projects: TestProject[]): string[] {
  return [...projects.map((project) => `${project.name} \u2014 ${project.command}`), "Custom command..."];
}

export async function resolveTestConfig(
  rootCwd: string,
  ui: TestConfigUi | undefined,
): Promise<TestConfig | undefined> {
  const rootCommand = await inferTestCommand(rootCwd);
  if (rootCommand) return { command: rootCommand, cwd: rootCwd };

  const projects = await scanChildDirectories(rootCwd);

  if (projects.length === 1) {
    return { command: projects[0].command, cwd: projects[0].dir };
  }

  if (projects.length > 1 && ui) {
    const choice = await ui.select("Select test project", buildSelectOptions(projects));
    if (!choice) return undefined;

    const project = projects.find((candidate) => choice.startsWith(candidate.name));
    if (project) return { command: project.command, cwd: project.dir };
  }

  if (!ui) return undefined;

  const manualCommand = await ui.input("Test command", "npm test");
  if (!manualCommand) return undefined;

  return { command: manualCommand, cwd: rootCwd };
}
