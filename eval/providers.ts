import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EvalConfig, ModelConfig } from "./types.js";

const ALWAYS_SUBSCRIPTION_BACKED_PROVIDERS = new Set([
  "github-copilot",
  "google-antigravity",
  "google-gemini-cli",
  "openai-codex",
]);

interface PiSettings {
  defaultProvider?: string;
}

interface StoredCredential {
  type?: string;
}

function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function findNearestProjectSettings(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, ".pi", "settings.json");
    if (fs.existsSync(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return undefined;
    currentDir = parentDir;
  }
}

export function readPiSettings(startDir = process.cwd(), homeDir = os.homedir()): PiSettings {
  const globalSettingsPath = path.join(homeDir, ".pi", "agent", "settings.json");
  const projectSettingsPath = findNearestProjectSettings(startDir);
  const globalSettings = readJsonFile<PiSettings>(globalSettingsPath) ?? {};
  const projectSettings = projectSettingsPath ? (readJsonFile<PiSettings>(projectSettingsPath) ?? {}) : {};

  return {
    ...globalSettings,
    ...projectSettings,
  };
}

export function readAuthTypes(homeDir = os.homedir()): Record<string, string | undefined> {
  const authPath = path.join(homeDir, ".pi", "agent", "auth.json");
  const authData = readJsonFile<Record<string, StoredCredential>>(authPath) ?? {};

  return Object.fromEntries(Object.entries(authData).map(([provider, credential]) => [provider, credential.type]));
}

export function resolveProvider(
  config: ModelConfig | undefined,
  fallbackProvider: string | undefined,
): string | undefined {
  return config?.provider ?? fallbackProvider;
}

export function getActiveEvalProviders(
  config: EvalConfig,
  options: { noJudge?: boolean; startDir?: string; homeDir?: string } = {},
): string[] {
  const settings = readPiSettings(options.startDir, options.homeDir);
  const workerProvider = resolveProvider(config.worker, settings.defaultProvider);
  const judgeProvider = options.noJudge ? undefined : resolveProvider(config.judge, settings.defaultProvider);

  return [...new Set([workerProvider, judgeProvider].filter((provider): provider is string => Boolean(provider)))];
}

export function isSubscriptionBackedProvider(provider: string, authTypes: Record<string, string | undefined>): boolean {
  if (ALWAYS_SUBSCRIPTION_BACKED_PROVIDERS.has(provider)) return true;
  if (provider === "anthropic") return authTypes[provider] === "oauth";
  return false;
}

export function getSubscriptionBackedProviders(providers: string[], options: { homeDir?: string } = {}): string[] {
  const authTypes = readAuthTypes(options.homeDir);
  return providers.filter((provider) => isSubscriptionBackedProvider(provider, authTypes));
}

export function validateSuiteConcurrency(
  concurrency: number,
  providers: string[],
  options: { homeDir?: string } = {},
): string | undefined {
  if (concurrency <= 1) return undefined;

  const subscriptionBackedProviders = getSubscriptionBackedProviders(providers, options);
  if (subscriptionBackedProviders.length === 0) return undefined;

  return `Concurrency ${concurrency} is not allowed for subscription-backed providers: ${subscriptionBackedProviders.join(", ")}. Use --concurrency 1 instead.`;
}
