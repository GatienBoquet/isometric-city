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

/**
 * Polyfill for document.modelContext that extends EventTarget to match
 * the native WebMCP API (https://webmachinelearning.github.io/webmcp/).
 * This allows browser agents to discover and invoke tools as if native WebMCP were present.
 */
class FallbackModelContext extends EventTarget implements ModelContextLike {
  private tools = new Map<string, ModelContextTool>();
  private _ontoolchange: ((e: Event) => void) | null = null;

  // WebMCP spec: ontoolchange event handler attribute
  get ontoolchange(): ((e: Event) => void) | null {
    return this._ontoolchange;
  }

  set ontoolchange(handler: ((e: Event) => void) | null) {
    if (this._ontoolchange) {
      this.removeEventListener('toolchange', this._ontoolchange);
    }
    this._ontoolchange = handler;
    if (handler) {
      this.addEventListener('toolchange', handler);
    }
  }

  async registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> {
    // Spec: name and description are required
    if (!tool?.name || !tool?.description) {
      throw new DOMException('Tool name and description are required', 'InvalidStateError');
    }
    // Spec: name must be 1-128 chars, alphanumeric + _ - .
    if (tool.name.length < 1 || tool.name.length > 128) {
      throw new DOMException('Tool name must be 1-128 characters', 'InvalidStateError');
    }
    if (!/^[a-zA-Z0-9_\-.]+$/.test(tool.name)) {
      throw new DOMException('Tool name must only contain alphanumeric, _, -, or . characters', 'InvalidStateError');
    }
    // Polyfill: allow replacement for React StrictMode compatibility
    // (Native spec would reject duplicates with InvalidStateError)
    // This is intentionally lenient since we're a polyfill, not native.
    this.tools.set(tool.name, tool);
    
    options?.signal?.addEventListener(
      'abort',
      () => {
        this.tools.delete(tool.name);
        this.#dispatchToolChange();
      },
      { once: true },
    );
    
    // Fire toolchange event per WebMCP spec
    this.#dispatchToolChange();
  }

  /**
   * WebMCP spec: getTools() returns RegisteredTool dictionaries with:
   * - name (required)
   * - title (optional, defaults to empty string)
   * - description (required)
   * - inputSchema (optional)
   * - window (required) - the Window that registered the tool
   * - origin (required) - the origin of the document
   * - annotations (optional)
   */
  async getTools(): Promise<RegisteredTool[]> {
    const win = typeof window !== 'undefined' ? window : undefined;
    const origin = typeof location !== 'undefined' ? location.origin : '';
    
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title ?? '',
      description: tool.description,
      inputSchema: tool.inputSchema,
      window: win,
      origin,
      annotations: tool.annotations,
    }));
  }

  /**
   * WebMCP spec: executeTool(tool, inputObject, options) executes a registered tool.
   * Returns a promise that resolves to the stringified result.
   */
  async executeTool(
    tool: RegisteredTool | string,
    inputObject: Record<string, unknown> = {},
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const name = typeof tool === 'string' ? tool : tool.name;
    const registered = this.tools.get(name);
    if (!registered) {
      throw new DOMException(`Tool "${name}" not found`, 'NotFoundError');
    }
    
    const controller = options?.signal ? undefined : new AbortController();
    const signal = options?.signal ?? controller?.signal ?? new AbortController().signal;
    
    const result = await registered.execute(inputObject || {}, { signal });
    return stringifyResult(result);
  }

  /** Non-spec helper: list tool names for debugging */
  listNames(): string[] {
    return [...this.tools.keys()];
  }

  #dispatchToolChange() {
    this.dispatchEvent(new Event('toolchange'));
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
  console.log(`[WebMCP] resolveNativeTargets found ${candidates.length} native context(s)`);
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
 * Tool names confirmed to be in native contexts (either via successful
 * registration or confirmed duplicate error). Used for debugging/verification.
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
    let docSet = false;
    let navSet = false;
    try {
      if (!document.modelContext) {
        Object.defineProperty(document, 'modelContext', {
          value: fallback,
          configurable: true,
          writable: true,
        });
        docSet = true;
      }
    } catch (err) {
      console.warn('[WebMCP] Could not set document.modelContext:', err);
    }
    try {
      if (!navigator.modelContext) {
        Object.defineProperty(navigator, 'modelContext', {
          value: fallback,
          configurable: true,
          writable: true,
        });
        navSet = true;
      }
    } catch (err) {
      console.warn('[WebMCP] Could not set navigator.modelContext:', err);
    }
    console.log('[WebMCP] Polyfill installed:', { docSet, navSet, nativeExisting });
  } else {
    console.log('[WebMCP] Native API detected, skipping polyfill');
  }

  const bridge: AgentCityBridge = {
    native: Boolean(nativeExisting),
    getTools: async () => fallback.getTools(),
    executeTool: async (name, input) => fallback.executeTool(name, input),
    listToolNames: () => fallback.listNames(),
  };
  window.__agentCity = bridge;

  // Expose a debug helper for verifying WebMCP registration from console
  (window as unknown as Record<string, unknown>).__webmcpDebug = {
    hasModelContext: () => Boolean(document.modelContext),
    modelContextType: () => typeof document.modelContext,
    listTools: () => fallback.listNames(),
    getTools: () => fallback.getTools(),
    native: nativeExisting,
    fallback,
  };

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
    console.log(`[WebMCP] Registered tool: ${tool.name}`);
  } catch (error) {
    console.error(`[WebMCP] Failed to register ${tool.name}:`, error);
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!nativeSetup) {
    probedTool = tool;
    nativeSetup = resolveNativeTargets(tool);
  }
  const { targets, seededInto } = await nativeSetup;

  // Always attempt native registration. If native already has the tool (e.g.,
  // from a previous Strict Mode mount where native didn't honor abort), the
  // registration will fail with InvalidStateError - that's fine, tool is there.
  for (const ctx of targets) {
    // The probe already put this tool in that context.
    if (ctx === seededInto && seededInto !== null && tool === probedTool) {
      console.log(`[WebMCP] Skipping ${tool.name} for seeded context (already probed)`);
      nativelyRegistered.add(tool.name);
      continue;
    }
    try {
      console.log(`[WebMCP] Registering ${tool.name} to native context...`);
      // Don't pass abort signal to native - native may not support it and we
      // want tools to persist. Fallback handles its own cleanup via signal.
      await ctx.registerTool(tool);
      nativelyRegistered.add(tool.name);
      console.log(`[WebMCP] Successfully registered ${tool.name} to native`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // InvalidStateError means tool already exists - that's okay
      if (msg.includes('InvalidState') || msg.includes('already registered')) {
        console.log(`[WebMCP] ${tool.name} already in native (probably from previous mount)`);
        nativelyRegistered.add(tool.name);
      } else {
        console.warn(`[WebMCP] Failed to register ${tool.name} to native:`, msg);
        errors.push(msg);
      }
    }
  }

  // NOTE: We do NOT clear nativelyRegistered on abort. Native implementations
  // may not honor abort signals, so the tool stays registered. Trying to
  // re-register on Strict Mode remount would just cause duplicate errors.
  // The fallback handles its own cleanup via abort signal in registerTool().

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
