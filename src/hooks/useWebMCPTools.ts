'use client';

import { useEffect, useRef } from 'react';
import type { JsonSchema, ModelContextTool } from '@/lib/webmcp/types';
import { installWebmcpPolyfill, registerToolEverywhere } from '@/lib/webmcp/registry';

type Runner = (name: string, input: Record<string, unknown>) => unknown;

const empty: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

const xy = {
  x: { type: 'number' },
  y: { type: 'number' },
};

const TOOLS: Array<{ name: string; description: string; inputSchema: JsonSchema }> = [
  {
    name: 'get_city_state',
    description:
      'Read live city stats from the canvas sim: money, population, jobs, demand, tax, budget, date. Use this first — the map is HTML canvas so you cannot scrape tiles.',
    inputSchema: empty,
  },
  {
    name: 'inspect_region',
    description: 'Inspect a neighborhood around (x,y). Returns an ASCII tile map and per-tile JSON. Radius 0-12.',
    inputSchema: {
      type: 'object',
      properties: { ...xy, radius: { type: 'number', description: 'Chebyshev radius, default 4' } },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_problems',
    description:
      'Find unpowered buildings, traffic jams, fires, abandoned buildings, demand issues. Also paints problem highlights on the map the human is looking at.',
    inputSchema: empty,
  },
  {
    name: 'get_pending_plan',
    description: 'Show the ghost plan waiting for human approval (or confirm_plan if role is co-builder).',
    inputSchema: empty,
  },
  {
    name: 'get_agent_status',
    description:
      'Second Mayor role, whether a plan is pending, undo stack size. This is co-op: do not autoplay the city.',
    inputSchema: empty,
  },
  {
    name: 'highlight_tiles',
    description: 'Point at tiles on the shared isometric map. Visual only — does not build.',
    inputSchema: {
      type: 'object',
      properties: {
        tiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ...xy, kind: { type: 'string' }, label: { type: 'string' } },
            required: ['x', 'y'],
          },
        },
      },
      required: ['tiles'],
      additionalProperties: false,
    },
  },
  { name: 'clear_highlights', description: 'Clear map highlights.', inputSchema: empty },
  {
    name: 'focus_tile',
    description: 'Pan the human camera toward a tile and mark it.',
    inputSchema: {
      type: 'object',
      properties: { ...xy, label: { type: 'string' } },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_agent_role',
    description:
      'advisor = inspect/propose only (human must click Approve). co-builder = may call confirm_plan after proposing. Default advisor.',
    inputSchema: {
      type: 'object',
      properties: { role: { type: 'string', description: 'advisor | co-builder' } },
      required: ['role'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_agent_note',
    description: 'Speak to the human in the co-op HUD. Short, about this neighborhood.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_zone_region',
    description:
      'Ghost a rectangular zone. Does NOT build until the human Approves or confirm_plan is used in co-builder role.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number' },
        y1: { type: 'number' },
        x2: { type: 'number' },
        y2: { type: 'number' },
        zone: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['x1', 'y1', 'x2', 'y2', 'zone'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_road_path',
    description: 'Ghost a road (or rail) path between two tiles. Human must approve before it is built.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number' },
        y1: { type: 'number' },
        x2: { type: 'number' },
        y2: { type: 'number' },
        tool: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_placements',
    description: 'Ghost a batch of tile tools (road, park, tree, ...). Does not commit.',
    inputSchema: {
      type: 'object',
      properties: {
        placements: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ...xy, tool: { type: 'string' } },
            required: ['x', 'y', 'tool'],
          },
        },
        reason: { type: 'string' },
      },
      required: ['placements'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_service',
    description:
      'Ghost a service building (fire_station, police_station, hospital, school, power_plant, water_tower, ...).',
    inputSchema: {
      type: 'object',
      properties: { ...xy, tool: { type: 'string' }, reason: { type: 'string' } },
      required: ['x', 'y', 'tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_bulldoze',
    description: 'Ghost a bulldoze rectangle. Requires approval.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number' },
        y1: { type: 'number' },
        x2: { type: 'number' },
        y2: { type: 'number' },
      },
      required: ['x1', 'y1'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_tax_rate',
    description: 'Propose a tax change. Never applied silently.',
    inputSchema: {
      type: 'object',
      properties: { rate: { type: 'number' }, reason: { type: 'string' } },
      required: ['rate'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_budget',
    description: 'Propose department funding 0-100. Requires approval.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, funding: { type: 'number' }, reason: { type: 'string' } },
      required: ['key', 'funding'],
      additionalProperties: false,
    },
  },
  {
    name: 'confirm_plan',
    description:
      'Commit the ghost plan. Only allowed in co-builder role. Otherwise the human must click Approve on the page.',
    inputSchema: empty,
  },
  { name: 'reject_plan', description: 'Discard the ghost plan without building.', inputSchema: empty },
  {
    name: 'undo_agent_actions',
    description: 'Undo the last committed Second Mayor plan. Does not undo the human player.',
    inputSchema: empty,
  },
];

export function useWebMCPTools(run: Runner, onNative: (native: boolean) => void) {
  const runRef = useRef(run);
  runRef.current = run;
  const onNativeRef = useRef(onNative);
  onNativeRef.current = onNative;

  useEffect(() => {
    const { native } = installWebmcpPolyfill();
    onNativeRef.current(native);
    const ac = new AbortController();
    const dispatch: Runner = (name, input) => runRef.current(name, input);

    const tools: ModelContextTool[] = TOOLS.map((def) => ({
      name: def.name,
      title: def.name.replace(/_/g, ' '),
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input) => dispatch(def.name, (input || {}) as Record<string, unknown>),
    }));

    void Promise.all(tools.map((item) => registerToolEverywhere(item, { signal: ac.signal }))).catch(
      (error) => {
        console.warn('[webmcp] tool registration', error);
      },
    );

    return () => ac.abort();
  }, []);
}
