/**
 * WebMCP Model Context API types.
 * Spec: https://webmachinelearning.github.io/webmcp/
 */

export type JsonSchema = Record<string, unknown>;

/**
 * WebMCP spec: ToolExecuteCallbackOptions dictionary
 * - signal (required): AbortSignal for cancellation
 */
export interface ToolExecuteCallbackOptions {
  signal: AbortSignal;
}

export type ToolExecuteCallback = (
  input: Record<string, unknown>,
  options: ToolExecuteCallbackOptions,
) => unknown | Promise<unknown>;

/**
 * WebMCP spec: ToolAnnotations dictionary
 * - readOnlyHint: indicates tool only reads data
 * - untrustedContentHint: indicates output contains untrusted data
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

/**
 * WebMCP spec: ModelContextTool dictionary for registration
 * - name (required): unique identifier, 1-128 chars, alphanumeric + _ - .
 * - title (optional): human-readable label for UI
 * - description (required): natural language description
 * - inputSchema (optional): JSON Schema for parameters
 * - execute (required): callback invoked when tool is called
 * - annotations (optional): metadata hints
 */
export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  execute: ToolExecuteCallback;
  annotations?: ToolAnnotations;
}

export interface ModelContextRegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

/**
 * WebMCP spec: RegisteredTool dictionary returned by getTools()
 * - name (required): unique identifier
 * - title: human-readable label (empty string if not provided)
 * - description (required): natural language description
 * - inputSchema: JSON Schema for parameters
 * - window (required): the Window that registered the tool
 * - origin (required): origin of the document that registered the tool
 * - annotations: metadata hints
 */
export interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: JsonSchema;
  /** The Window of the document that registered the tool (WebMCP spec required) */
  window?: Window;
  /** Origin of the document that registered this tool (WebMCP spec required) */
  origin: string;
  annotations?: ToolAnnotations;
}

/**
 * WebMCP spec: ModelContext interface
 * Extends EventTarget for toolchange events
 */
export interface ModelContextLike extends Partial<EventTarget> {
  registerTool: (
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions,
  ) => Promise<void>;
  getTools: (options?: { fromOrigins?: string[] }) => Promise<RegisteredTool[]>;
  executeTool: (
    tool: RegisteredTool | string,
    inputObject?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<string>;
  /** Event handler for toolchange events */
  ontoolchange?: ((e: Event) => void) | null;
}

export interface AgentCityBridge {
  native: boolean;
  getTools: () => Promise<RegisteredTool[]>;
  executeTool: (name: string, input?: Record<string, unknown>) => Promise<string>;
  listToolNames: () => string[];
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }
  interface Navigator {
    modelContext?: ModelContextLike;
  }
  interface Window {
    __webmcp?: ModelContextLike;
    __agentCity?: AgentCityBridge;
  }
}

export {};
