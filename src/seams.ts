import type { BehaviorSeam } from "./types.js";

const HTTP_TEXT_PATTERNS = [
  /\b(?:get|post|put|patch|delete|head|options)\b/i,
  /\bapi\b/i,
  /\/api\//i,
  /\bendpoint\b/i,
  /\broute\b/i,
  /\bredirect(?:s|ion)?\b/i,
  /\bresponse\b/i,
  /\bstatus(?:\s+code)?\b/i,
  /\bjson\b/i,
  /\b(?:302|400|401|403|404|410|422|500)\b/,
  /\[[^/\]]+\]/,
];

const UI_TEXT_PATTERNS = [
  /\bpage\b/i,
  /\bform\b/i,
  /\bbutton\b/i,
  /\bdashboard\b/i,
  /\bmodal\b/i,
  /\blayout\b/i,
  /\bcomponent\b/i,
  /\btoast\b/i,
  /\bclipboard\b/i,
  /\bhome page\b/i,
  /\bcopy button\b/i,
  /\blink list\b/i,
];

const INTERNAL_TEXT_PATTERNS = [
  /\bschema\b/i,
  /\bmigration(?:s)?\b/i,
  /\bdrizzle\b/i,
  /\bsqlite\b/i,
  /\bdatabase\b/i,
  /\bconnection\b/i,
  /\bjournal mode\b/i,
  /\bwal\b/i,
  /\bpragma\b/i,
  /\bforeign key\b/i,
  /\bindex(?:es)?\b/i,
  /\bcolumns?\b/i,
  /\butility\b/i,
  /\bhelper\b/i,
  /\bservice\b/i,
  /\btest harness\b/i,
  /\bDEFAULT_[A-Z0-9_]+\b/,
  /\bcrypto\.getRandomValues\b/,
  /\b(?:generateSlug|validateCustomSlug|normalizeUrl|createDatabaseConnection|runMigrations)\b/,
  /\.ts\b/,
];

const HTTP_PATH_PATTERNS = [
  /\/routes\/.*\+server\./i,
  /\/routes\/api\//i,
  /\/routes\/.*\[[^/\]]+\].*/i,
  /\/tests\/(?:http|api|routes?)\//i,
];

const UI_PATH_PATTERNS = [
  /\.svelte(?:\.[^/]+)?$/i,
  /\/routes\/.*\+(?:page|layout)(?:\.server)?\./i,
  /\/components?\//i,
  /\/tests\/(?:ui|components?|pages?)\//i,
];

const INTERNAL_PATH_PATTERNS = [
  /\/lib\/server\/utils\//i,
  /\/lib\/server\/db\//i,
  /\/migrations\//i,
  /\/schema\./i,
  /\/service\./i,
  /\/tests\/unit\//i,
];

const BEHAVIOR_VERBS = [
  /\bcreate\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\breturn(?:s)?\b/i,
  /\breject(?:s)?\b/i,
  /\baccept(?:s)?\b/i,
  /\bshow(?:s)?\b/i,
  /\bdisplay(?:s)?\b/i,
  /\bstore(?:s)?\b/i,
  /\brecord(?:s)?\b/i,
  /\bshorten(?:s)?\b/i,
];

const EXPLICIT_SUPPORT_CONTRACT_PATTERNS = [
  /\bdb(?:atabase)?[- ]level\b/i,
  /\bdatabase layer\b/i,
  /\bdata integrity\b/i,
  /\bconstraint\b/i,
  /\brollback\b/i,
  /\bbackfill\b/i,
  /\bupgrade\b/i,
  /\breopen\b/i,
  /\bsurvive(?:s|d)? restart\b/i,
  /\bdurab(?:ility|le)\b/i,
  /\bmust (?:reject|prevent|enforce|fail|preserve)\b/i,
  /\bguard against\b/i,
];

export interface ChecklistSeamSummary {
  requested: BehaviorSeam;
  current: BehaviorSeam | null;
  counts: Record<BehaviorSeam, number>;
}

export interface SupportWorkClarification {
  reason: string;
  issue: string;
  questions: string[];
}

export function classifyRequestedSeam(userStory?: string, spec: string[] = []): BehaviorSeam {
  const explicit = classifyTextSeam(userStory, { preferBusiness: true });
  if (explicit !== "unknown") {
    return explicit;
  }

  const specSeam = dominantSeam(spec.map((item) => classifyChecklistItemSeam(item)));
  return specSeam;
}

export function classifyChecklistItemSeam(item: string | null | undefined): BehaviorSeam {
  return classifyTextSeam(item, { preferBusiness: false });
}

export function classifyProofSeam(input: {
  item?: string | null;
  testFiles?: string[];
  command?: string;
}): BehaviorSeam {
  const fileSeams = (input.testFiles ?? [])
    .map((file) => classifyPathSeam(file))
    .filter((seam) => seam !== "unknown");

  if (fileSeams.includes("business_ui")) {
    return "business_ui";
  }
  if (fileSeams.includes("business_http")) {
    return "business_http";
  }
  if (fileSeams.includes("internal_support")) {
    return "internal_support";
  }

  if (typeof input.command === "string" && /\b(?:playwright|cypress|test:e2e|test:browser)\b/i.test(input.command)) {
    return "business_ui";
  }

  return classifyChecklistItemSeam(input.item);
}

export function summarizeChecklistSeams(
  spec: string[],
  requested: BehaviorSeam,
  planCompleted = 0
): ChecklistSeamSummary {
  const counts = emptySeamCounts();
  for (const item of spec) {
    counts[classifyChecklistItemSeam(item)] += 1;
  }

  const currentItem = spec[currentIndex(spec.length, planCompleted)] ?? null;

  return {
    requested,
    current: currentItem ? classifyChecklistItemSeam(currentItem) : null,
    counts,
  };
}

export function seamSatisfiesRequest(requested: BehaviorSeam, observed: BehaviorSeam): boolean {
  if (requested === "unknown" || requested === "internal_support") {
    return true;
  }

  if (requested === "business_http" || requested === "business_ui") {
    return observed === "business_http" || observed === "business_ui";
  }

  return observed === "business_domain" || observed === "business_http" || observed === "business_ui";
}

export function seamLabel(seam: BehaviorSeam): string {
  switch (seam) {
    case "business_http":
      return "HTTP/API contract";
    case "business_ui":
      return "UI/page behavior";
    case "business_domain":
      return "business behavior";
    case "internal_support":
      return "internal support work";
    default:
      return "unknown seam";
  }
}

export function seamShortLabel(seam: BehaviorSeam | null | undefined): string {
  switch (seam) {
    case "business_http":
      return "HTTP";
    case "business_ui":
      return "UI";
    case "business_domain":
      return "DOMAIN";
    case "internal_support":
      return "SUPPORT";
    default:
      return "UNKNOWN";
  }
}

export function isBusinessRequestSeam(seam: BehaviorSeam): boolean {
  return seam === "business_http" || seam === "business_ui" || seam === "business_domain";
}

export function supportWorkClarification(
  userStory?: string,
  spec: string[] = []
): SupportWorkClarification | null {
  const story = userStory?.trim();
  if (!story) {
    return null;
  }

  if (classifyRequestedSeam(story, spec) !== "internal_support") {
    return null;
  }

  if (matchesAny(story, EXPLICIT_SUPPORT_CONTRACT_PATTERNS)) {
    return null;
  }

  if (spec.length > 0 && spec.some((item) => isBusinessRequestSeam(classifyChecklistItemSeam(item)))) {
    return null;
  }

  return {
    reason:
      "This request reads like support work or scaffolding, not a user-visible feature slice. Decide whether it should be folded under the first business behavior it enables, or whether you intentionally need a dedicated internal contract cycle.",
    issue:
      "The request is entirely support work right now. Prefer proving it through the first user-visible behavior it enables instead of creating a standalone feature slice for schema, migrations, or setup chores.",
    questions: [
      "Which user-visible feature should this support first, so RED can prove the behavior through that slice?",
      "If you want a dedicated support-work cycle, what internal contract or risk must it prove beyond setting up schema, migrations, or tooling?",
    ],
  };
}

function classifyTextSeam(
  text: string | null | undefined,
  options: { preferBusiness: boolean }
): BehaviorSeam {
  const value = text?.trim();
  if (!value) {
    return "unknown";
  }

  if (matchesAny(value, HTTP_TEXT_PATTERNS)) {
    return "business_http";
  }
  if (matchesAny(value, UI_TEXT_PATTERNS)) {
    return "business_ui";
  }
  if (matchesAny(value, INTERNAL_TEXT_PATTERNS)) {
    return "internal_support";
  }
  if (options.preferBusiness || matchesAny(value, BEHAVIOR_VERBS)) {
    return "business_domain";
  }
  return "unknown";
}

function classifyPathSeam(path: string): BehaviorSeam {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (matchesAny(normalized, UI_PATH_PATTERNS)) {
    return "business_ui";
  }
  if (matchesAny(normalized, HTTP_PATH_PATTERNS)) {
    return "business_http";
  }
  if (matchesAny(normalized, INTERNAL_PATH_PATTERNS)) {
    return "internal_support";
  }
  return "unknown";
}

function dominantSeam(seams: BehaviorSeam[]): BehaviorSeam {
  const counts = emptySeamCounts();
  for (const seam of seams) {
    counts[seam] += 1;
  }

  if (counts.business_http > 0 && counts.business_http >= counts.business_ui) {
    return "business_http";
  }
  if (counts.business_ui > 0) {
    return "business_ui";
  }
  if (counts.business_domain > 0) {
    return "business_domain";
  }
  if (counts.internal_support > 0) {
    return "internal_support";
  }
  return "unknown";
}

function emptySeamCounts(): Record<BehaviorSeam, number> {
  return {
    business_http: 0,
    business_ui: 0,
    business_domain: 0,
    internal_support: 0,
    unknown: 0,
  };
}

function currentIndex(length: number, planCompleted: number): number {
  if (length === 0) {
    return 0;
  }
  if (planCompleted < 0) {
    return 0;
  }
  if (planCompleted >= length) {
    return length - 1;
  }
  return planCompleted;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}
