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

/**
 * The API has lived on both document and navigator across drafts, so a browser
 * may expose either or both — and when it exposes both, they are often two
 * wrappers over one registry. Registering with each of them would then enter
 * every tool twice, and the bridge runs our handler once per entry: the first
 * confirm_plan applies the plan, the rest report "no pending plan", and the
 * caller is handed whichever result came last.
 *
 * So probe with the first tool: register it into one native context, then ask
 * the other whether it can already see it. Only a context with its own registry
 * is kept.
 */
async function resolveNativeTargets(
  firstTool: ModelContextTool,
): Promise<{ targets: ModelContextLike[]; seededInto: ModelContextLike | null }> {
  if (typeof document === 'undefined') return { targets: [], seededInto: null };

  const candidates: ModelContextLike[] = [];
  for (const candidate of [document.modelContext, navigator.modelContext]) {
    if (candidate && candidate !== fallback && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length < 2) return { targets: candidates, seededInto: null };

  const [first, ...rest] = candidates;
  try {
    await first.registerTool(firstTool);
  } catch {
    // Can't probe: try them all rather than silently dropping a context.
    return { targets: candidates, seededInto: null };
  }

  const targets = [first];
  for (const other of rest) {
    let sharesRegistry = false;
    try {
      const tools = (await other.getTools?.()) ?? [];
      sharesRegistry = tools.some((tool) => tool.name === firstTool.name);
    } catch {
      sharesRegistry = false;
    }
    if (!sharesRegistry) targets.push(other);
  }
  return { targets, seededInto: first };
}

/**
 * Tool names already registered with the native contexts. Registration is
 * page-lifetime and a native implementation is under no obligation to honour
 * the abort signal, so re-running the effect (React StrictMode remounts it in
 * development) must not enter a second copy of every tool.
 */
const nativelyRegistered = new Set<string>();
let probedTool: ModelContextTool | null = null;
let nativeSetup: Promise<{ targets: ModelContextLike[]; seededInto: ModelContextLike | null }> | null =
  null;

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
  const errors: string[] = [];

  // The in-page fallback is keyed by name and honours the abort signal, so
  // registering again replaces rather than duplicates.
  try {
    await fallback.registerTool(tool, options);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!nativeSetup) {
    probedTool = tool;
    nativeSetup = resolveNativeTargets(tool);
  }
  const { targets, seededInto } = await nativeSetup;

  if (!nativelyRegistered.has(tool.name)) {
    nativelyRegistered.add(tool.name);
    for (const ctx of targets) {
      // The probe already put this tool in that context.
      if (ctx === seededInto && seededInto !== null && tool === probedTool) continue;
      try {
        await ctx.registerTool(tool, options);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (errors.length > targets.length) {
    throw new Error(`Failed to register ${tool.name}: ${errors.join('; ')}`);
  }
}

/** Test seam: forget which tools were registered natively. */
export function resetWebmcpRegistrationsForTest(): void {
  nativelyRegistered.clear();
  nativeSetup = null;
  probedTool = null;
}
