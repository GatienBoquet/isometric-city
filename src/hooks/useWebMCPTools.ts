'use client';

import { useEffect, useRef } from 'react';
import type { JsonSchema, ModelContextTool } from '@/lib/webmcp/types';
import { installWebmcpPolyfill, registerToolEverywhere } from '@/lib/webmcp/registry';

type Runner = (name: string, input: Record<string, unknown>) => unknown;

const emptyObject: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function tool(
  name: string,
  description: string,
  inputSchema: JsonSchema,
  run: Runner,
): ModelContextTool {
  return {
    name,
    title: name.replace(/_/g, ' '),
    description,
    inputSchema,
    execute: async (input) => run(name, (input || {}) as Record<string, unknown>),
  };
}

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

    const tools: ModelContextTool[] = [
      tool(
        'get_city_state',
        'Read live city stats from the canvas sim: money, population, jobs, demand, tax, budget, date. Use this first — the map is HTML canvas so you cannot scrape tiles.',
        emptyObject,
        dispatch,
      ),
      tool(
        'inspect_region',
        'Inspect a neighborhood around (x,y). Returns an ASCII tile map and per-tile JSON. Radius 0-12.',
        {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Tile X' },
            y: { type: 'number', description: 'Tile Y' },
            radius: { type: 'number', description: 'Chebyshev radius, default 4' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'get_problems',
        'Find unpowered buildings, traffic jams, fires, abandoned buildings, demand issues. Also paints problem highlights on the map the human is looking at.',
        emptyObject,
        dispatch,
      ),
      tool(
        'get_pending_plan',
        'Show the ghost plan waiting for human approval (or confirm_plan if role is co-builder).',
        emptyObject,
        dispatch,
      ),
      tool(
        'get_agent_status',
        'Second Mayor role, whether a plan is pending, undo stack size. This is co-op: do not autoplay the city.',
        emptyObject,
        dispatch,
      ),
      tool(
        'highlight_tiles',
        'Point at tiles on the shared isometric map. Visual only — does not build.',
        {
          type: 'object',
          properties: {
            tiles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  kind: { type: 'string', description: 'problem | focus | ghost | ok' },
                  label: { type: 'string' },
                },
                required: ['x', 'y'],
              },
            },
          },
          required: ['tiles'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool('clear_highlights', 'Clear map highlights.', emptyObject, dispatch),
      tool(
        'focus_tile',
        'Pan the human camera toward a tile and mark it.',
        {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            label: { type: 'string' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'set_agent_role',
        'advisor = inspect/propose only (human must click Approve). co-builder = may call confirm_plan after proposing. Default advisor.',
        {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'advisor | co-builder' },
          },
          required: ['role'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'add_agent_note',
        'Speak to the human in the co-op HUD. Short, about this neighborhood.',
        {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'propose_zone_region',
        'Ghost a rectangular zone. Does NOT build until the human Approves or confirm_plan is used in co-builder role.',
        {
          type: 'object',
          properties: {
            x1: { type: 'number' },
            y1: { type: 'number' },
            x2: { type: 'number' },
            y2: { type: 'number' },
            zone: {
              type: 'string',
              description: 'zone_residential | zone_commercial | zone_industrial | zone_dezone',
            },
            reason: { type: 'string' },
          },
          required: ['x1', 'y1', 'x2', 'y2', 'zone'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'propose_road_path',
        'Ghost a road (or rail) path between two tiles. Human must approve before it is built.',
        {
          type: 'object',
          properties: {
            x1: { type: 'number' },
            y1: { type: 'number' },
            x2: { type: 'number' },
            y2: { type: 'number' },
            tool: { type: 'string', description: 'road (default) or rail' },
            reason: { type: 'string' },
          },
          required: ['x1', 'y1', 'x2', 'y2'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'propose_placements',
        'Ghost a batch of tile tools (road, park, tree, ...). Does not commit.',
        {
          type: 'object',
          properties: {
            placements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  tool: { type: 'string' },
                },
                required: ['x', 'y', 'tool'],
              },
            },
            reason: { type: 'string' },
          },
          required: ['placements'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'propose_service',
        'Ghost a service building (fire_station, police_station, hospital, school, power_plant, water_tower, ...).',
        {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            tool: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['x', 'y', 'tool'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'propose_bulldoze',
        'Ghost a bulldoze rectangle. Requires approval.',
        {
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
        dispatch,
      ),
      tool(
        'propose_tax_rate',
        'Propose a tax change. Never applied silently.',
        {
          type: 'object',
          properties: {
            rate: { type: 'number', description: '0-100' },
            reason: { type: 'string' },
          },
          required: ['rate'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'propose_budget',
        'Propose department funding 0-100. Requires approval.',
        {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'police|fire|health|education|transportation|parks|power|water',
            },
            funding: { type: 'number' },
            reason: { type: 'string' },
          },
          required: ['key', 'funding'],
          additionalProperties: false,
        },
        dispatch,
      ),
      tool(
        'confirm_plan',
        'Commit the ghost plan. Only allowed in co-builder role. Otherwise the human must click Approve on the page.',
        emptyObject,
        dispatch,
      ),
      tool('reject_plan', 'Discard the ghost plan without building.', emptyObject, dispatch),
      tool(
        'undo_agent_actions',
        'Undo the last committed Second Mayor plan. Does not undo the human player.',
        emptyObject,
        dispatch,
      ),
    ];

    void Promise.all(tools.map((item) => registerToolEverywhere(item, { signal: ac.signal }))).catch(
      (error) => {
        console.warn('[webmcp] tool registration', error);
      },
    );

    return () => ac.abort();
  }, []);
}
