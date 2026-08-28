'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAgent } from '@/context/AgentContext';

const PRESETS: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: 'get_city_state', args: {} },
  { name: 'get_problems', args: {} },
  { name: 'inspect_region', args: { x: 20, y: 20, radius: 5 } },
  { name: 'get_agent_status', args: {} },
  {
    name: 'propose_zone_region',
    args: { x1: 18, y1: 18, x2: 22, y2: 22, zone: 'zone_residential', reason: 'Need housing' },
  },
  { name: 'confirm_plan', args: {} },
  { name: 'reject_plan', args: {} },
  { name: 'undo_agent_actions', args: {} },
];

export function AgentInspector() {
  const agent = useAgent();
  const [debug, setDebug] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('get_city_state');
  const [argsText, setArgsText] = useState('{}');
  const [result, setResult] = useState('');
  const names = useMemo(() => PRESETS.map((p) => p.name), []);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);

  if (!debug) return null;

  const run = async () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = argsText.trim() ? JSON.parse(argsText) : {};
    } catch {
      setResult('Invalid JSON args');
      return;
    }
    const output = agent.runTool(name, parsed);
    setResult(JSON.stringify(output, null, 2));
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="open-agent-inspector"
        onClick={() => setOpen(true)}
        className="absolute top-4 left-4 z-30 px-2 py-1 text-[11px] rounded bg-slate-950/80 border border-white/15 text-slate-300 hover:text-white"
      >
        Agent tools
      </button>
    );
  }

  return (
    <div
      className="absolute top-4 left-4 z-30 w-[min(360px,calc(100%-2rem))] rounded-lg border border-white/15 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl"
      data-testid="agent-inspector"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sky-200">WebMCP inspector</span>
        <button type="button" className="text-slate-400" onClick={() => setOpen(false)}>
          close
        </button>
      </div>
      <select
        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 mb-2"
        value={name}
        data-testid="inspector-tool"
        onChange={(e) => {
          const next = e.target.value;
          setName(next);
          const preset = PRESETS.find((p) => p.name === next);
          setArgsText(JSON.stringify(preset?.args ?? {}, null, 2));
        }}
      >
        {names.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <textarea
        className="w-full h-20 bg-slate-900 border border-white/10 rounded px-2 py-1 font-mono mb-2"
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
      />
      <button
        type="button"
        data-testid="inspector-run"
        onClick={run}
        className="px-3 py-1 rounded bg-sky-500 text-slate-950 font-semibold"
      >
        Execute
      </button>
      {result && (
        <pre
          data-testid="inspector-result"
          className="mt-2 max-h-40 overflow-auto bg-black/40 p-2 rounded text-[10px] leading-snug"
        >
          {result}
        </pre>
      )}
    </div>
  );
}
