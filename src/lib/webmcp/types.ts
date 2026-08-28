/**
 * Minimal typings for the WebMCP Model Context API.
 * Spec: https://webmachinelearning.github.io/webmcp/
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolExecuteCallbackOptions {
  signal?: AbortSignal;
}

export type ToolExecuteCallback = (
  input: Record<string, unknown>,
  options?: ToolExecuteCallbackOptions,
) => unknown | Promise<unknown>;

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  execute: ToolExecuteCallback;
}

export interface ModelContextRegisterToolOptions {
  signal?: AbortSignal;
}

export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
}

export interface ModelContextLike {
  registerTool: (
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions,
  ) => Promise<void> | void;
  getTools?: (options?: unknown) => Promise<RegisteredTool[]> | RegisteredTool[];
  executeTool?: (
    tool: RegisteredTool | string,
    inputObject?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<string> | string;
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
