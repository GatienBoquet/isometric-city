import type {
  AgentCityBridge,
  ModelContextLike,
  ModelContextTool,
  RegisteredTool,
} from './types';

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

class FallbackModelContext implements ModelContextLike {
  private tools = new Map<string, ModelContextTool>();

  async registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }) {
    if (!tool?.name || !tool?.description) {
      throw new Error('Tool name and description are required');
    }
    if (this.tools.has(tool.name)) {
      this.tools.delete(tool.name);
    }
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener(
      'abort',
      () => {
        this.tools.delete(tool.name);
      },
      { once: true },
    );
  }

  async getTools(): Promise<RegisteredTool[]> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async executeTool(
    tool: RegisteredTool | string,
    inputObject: Record<string, unknown> = {},
  ): Promise<string> {
    const name = typeof tool === 'string' ? tool : tool.name;
    const registered = this.tools.get(name);
    if (!registered) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const result = await registered.execute(inputObject || {}, {
      signal: new AbortController().signal,
    });
    return stringifyResult(result);
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }
}

const fallback = new FallbackModelContext();

function uniqueContexts(): ModelContextLike[] {
  const found: ModelContextLike[] = [fallback];
  const native = typeof document !== 'undefined' ? document.modelContext : undefined;
  if (native && native !== fallback) found.push(native);
  return found;
}

export function installWebmcpPolyfill(): { native: boolean } {
  if (typeof window === 'undefined') {
    return { native: false };
  }

  window.__webmcp = fallback;

  const nativeExisting =
    (document.modelContext && document.modelContext !== fallback) ||
    (navigator.modelContext && navigator.modelContext !== fallback);

  if (!nativeExisting) {
    try {
      if (!document.modelContext) {
        Object.defineProperty(document, 'modelContext', {
          value: fallback,
          configurable: true,
        });
      }
    } catch {
      // Some browsers expose a getter that cannot be replaced.
    }
    try {
      if (!navigator.modelContext) {
        Object.defineProperty(navigator, 'modelContext', {
          value: fallback,
          configurable: true,
        });
      }
    } catch {
      // ignore
    }
  }

  const bridge: AgentCityBridge = {
    native: Boolean(nativeExisting),
    getTools: async () => fallback.getTools(),
    executeTool: async (name, input) => fallback.executeTool(name, input),
    listToolNames: () => fallback.listNames(),
  };
  window.__agentCity = bridge;

  return { native: bridge.native };
}

export async function registerToolEverywhere(
  tool: ModelContextTool,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const contexts = uniqueContexts();
  const errors: string[] = [];
  for (const ctx of contexts) {
    try {
      await ctx.registerTool(tool, options);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length === contexts.length) {
    throw new Error(`Failed to register ${tool.name}: ${errors.join('; ')}`);
  }
}

