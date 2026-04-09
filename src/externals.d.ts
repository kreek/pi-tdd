// Keep in sync with the installed @mariozechner/pi-ai and @mariozechner/pi-coding-agent versions.
declare module "@mariozechner/pi-ai" {
  export type Provider = string;
  export type Api = string;

  export interface TextContent {
    type: "text";
    text: string;
  }

  export interface ImageContent {
    type: "image";
    image: string;
    mimeType?: string;
  }

  export interface ToolCall {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }

  export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

  export interface UserMessage {
    role: "user";
    content: (TextContent | ImageContent)[];
    timestamp: number;
  }

  export interface AssistantMessage {
    role: "assistant";
    content: (TextContent | ToolCall)[];
    api: Api;
    provider: Provider;
    model: string;
    usage?: unknown;
    stopReason: StopReason;
    errorMessage?: string;
    timestamp: number;
  }

  export interface ToolResultMessage<TDetails = unknown> {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: (TextContent | ImageContent)[];
    details?: TDetails;
    isError: boolean;
    timestamp: number;
  }

  export type Message = UserMessage | AssistantMessage | ToolResultMessage;

  export interface Context {
    systemPrompt?: string;
    messages: Message[];
  }

  export interface Model<TApi extends Api = Api> {
    id: string;
    name: string;
    api: TApi;
    provider: Provider;
    baseUrl: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    headers?: Record<string, string>;
  }

  export interface ProviderStreamOptions {
    temperature?: number;
    signal?: AbortSignal;
    apiKey?: string;
    headers?: Record<string, string>;
    reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  }

  export function complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions
  ): Promise<AssistantMessage>;
}

declare module "@mariozechner/pi-coding-agent" {
  import type { AssistantMessage, Model, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";

  export interface CustomEntry<T = unknown> {
    type: "custom";
    customType: string;
    data?: T;
  }

  export interface MessageEntry {
    type: "message";
    message: AssistantMessage | ToolResultMessage | { role: string; content: unknown };
  }

  export type SessionEntry = CustomEntry | MessageEntry | { type: string; [key: string]: unknown };

  export interface ReadonlySessionManager {
    getEntries(): SessionEntry[];
    getBranch(): SessionEntry[];
    getSessionFile(): string;
  }

  export interface ResolvedRequestAuthOk {
    ok: true;
    apiKey?: string;
    headers?: Record<string, string>;
  }

  export interface ResolvedRequestAuthError {
    ok: false;
    error: string;
  }

  export type ResolvedRequestAuth = ResolvedRequestAuthOk | ResolvedRequestAuthError;

  export interface ModelRegistry {
    find(provider: string, modelId: string): Model | undefined;
    getApiKeyAndHeaders(model: Model): Promise<ResolvedRequestAuth>;
  }

  export interface ExtensionUIDialogOptions {
    signal?: AbortSignal;
    timeout?: number;
  }

  export interface ExtensionUIContext {
    select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
    confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
    input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
    setWidget(key: string, content: string[] | undefined, options?: unknown): void;
    setEditorText(text: string): void;
    custom<T>(
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: T) => void
      ) => unknown,
      options?: { overlay?: boolean }
    ): Promise<T>;
  }

  export interface ExtensionContext {
    ui: ExtensionUIContext;
    hasUI: boolean;
    cwd: string;
    sessionManager: ReadonlySessionManager;
    modelRegistry: ModelRegistry;
    model: Model | undefined;
    isIdle(): boolean;
    signal: AbortSignal | undefined;
    abort(): void;
    hasPendingMessages(): boolean;
    shutdown(): void;
    getContextUsage(): unknown;
    compact(options?: unknown): void;
    getSystemPrompt(): string;
  }

  export interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;
    newSession(options?: unknown): Promise<{ cancelled: boolean }>;
    fork(entryId: string): Promise<{ cancelled: boolean }>;
    navigateTree(targetId: string, options?: unknown): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
    reload(): Promise<void>;
  }

  interface ToolCallEventBase {
    type: "tool_call";
    toolCallId: string;
  }

  export interface BashToolCallEvent extends ToolCallEventBase {
    toolName: "bash";
    input: { command: string; timeout?: number };
  }

  export interface ReadToolCallEvent extends ToolCallEventBase {
    toolName: "read";
    input: { path: string; offset?: number; limit?: number };
  }

  export interface EditToolCallEvent extends ToolCallEventBase {
    toolName: "edit";
    input: { path: string; oldText: string; newText: string; replaceAll?: boolean };
  }

  export interface WriteToolCallEvent extends ToolCallEventBase {
    toolName: "write";
    input: { path: string; content: string };
  }

  export interface GrepToolCallEvent extends ToolCallEventBase {
    toolName: "grep";
    input: Record<string, unknown>;
  }

  export interface FindToolCallEvent extends ToolCallEventBase {
    toolName: "find";
    input: Record<string, unknown>;
  }

  export interface LsToolCallEvent extends ToolCallEventBase {
    toolName: "ls";
    input: Record<string, unknown>;
  }

  export interface CustomToolCallEvent extends ToolCallEventBase {
    toolName: string;
    input: Record<string, unknown>;
  }

  export type ToolCallEvent =
    | BashToolCallEvent
    | ReadToolCallEvent
    | EditToolCallEvent
    | WriteToolCallEvent
    | GrepToolCallEvent
    | FindToolCallEvent
    | LsToolCallEvent
    | CustomToolCallEvent;

  export interface BashToolDetails {
    truncation?: unknown;
    fullOutputPath?: string;
  }

  interface ToolResultEventBase {
    type: "tool_result";
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    content: Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }>;
    isError: boolean;
  }

  export interface BashToolResultEvent extends ToolResultEventBase {
    toolName: "bash";
    details?: BashToolDetails;
  }

  export type ToolResultEvent = BashToolResultEvent | ToolResultEventBase;

  export interface ToolCallEventResult {
    block?: boolean;
    reason?: string;
  }

  export interface SessionStartEvent {
    type: "session_start";
    reason: "startup" | "reload" | "new" | "resume" | "fork";
    previousSessionFile?: string;
  }

  export interface SessionTreeEvent {
    type: "session_tree";
    newLeafId: string | null;
    oldLeafId: string | null;
    summaryEntry?: unknown;
    fromExtension?: boolean;
  }

  export interface BeforeAgentStartEvent {
    type: "before_agent_start";
    prompt: string;
    images?: Array<{ type: "image"; image: string; mimeType?: string }>;
    systemPrompt: string;
  }

  export interface TurnStartEvent {
    type: "turn_start";
    turnIndex: number;
  }

  export interface TurnEndEvent {
    type: "turn_end";
    turnIndex: number;
    message: AssistantMessage;
    toolResults: ToolResultMessage[];
  }

  export interface RegisteredCommand {
    description?: string;
    getArgumentCompletions?: (argumentPrefix: string) => Array<{ value: string; label: string }> | null | Promise<Array<{ value: string; label: string }> | null>;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  }

  export interface ExtensionAPI {
    on(event: "session_start", handler: (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    on(event: "session_tree", handler: (event: SessionTreeEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    on(
      event: "before_agent_start",
      handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<{ systemPrompt?: string } | void> | { systemPrompt?: string } | void
    ): void;
    on(event: "turn_start", handler: (event: TurnStartEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    on(
      event: "tool_call",
      handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | void> | ToolCallEventResult | void
    ): void;
    on(event: "tool_result", handler: (event: ToolResultEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    on(event: "turn_end", handler: (event: TurnEndEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    registerCommand(name: string, options: RegisteredCommand): void;
    registerFlag(
      name: string,
      options: {
        description?: string;
        type: "boolean" | "string";
        default?: boolean | string;
      }
    ): void;
    getFlag(name: string): boolean | string | undefined;
    appendEntry<T = unknown>(customType: string, data?: T): void;
    sendMessage<T = unknown>(
      message: {
        customType: string;
        content: string;
        display: boolean;
        details?: T;
      },
      options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
    ): void;
  }

  export function isToolCallEventType(toolName: "bash", event: ToolCallEvent): event is BashToolCallEvent;
  export function isToolCallEventType(toolName: "read", event: ToolCallEvent): event is ReadToolCallEvent;
  export function isToolCallEventType(toolName: "edit", event: ToolCallEvent): event is EditToolCallEvent;
  export function isToolCallEventType(toolName: "write", event: ToolCallEvent): event is WriteToolCallEvent;
  export function isToolCallEventType(toolName: "grep", event: ToolCallEvent): event is GrepToolCallEvent;
  export function isToolCallEventType(toolName: "find", event: ToolCallEvent): event is FindToolCallEvent;
  export function isToolCallEventType(toolName: "ls", event: ToolCallEvent): event is LsToolCallEvent;
  export function isToolCallEventType<TInput extends Record<string, unknown>>(toolName: string, event: ToolCallEvent): event is CustomToolCallEvent & { input: TInput };
  export function isBashToolResult(event: ToolResultEvent): event is BashToolResultEvent;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:os" {
  export function homedir(): string;
}
