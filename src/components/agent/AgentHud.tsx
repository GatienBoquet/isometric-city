'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgent } from '@/context/AgentContext';
import type { AgentLogKind } from '@/lib/agent/types';

const KIND_LABEL: Record<AgentLogKind, { tag: string; className: string }> = {
  proposed: { tag: 'proposed', className: 'text-amber-300' },
  applied: { tag: 'built', className: 'text-emerald-300' },
  rejected: { tag: 'rejected', className: 'text-slate-400' },
  undone: { tag: 'undo', className: 'text-sky-300' },
  note: { tag: 'said', className: 'text-slate-200' },
  role: { tag: 'mode', className: 'text-violet-300' },
  looked: { tag: 'looked', className: 'text-slate-400' },
};

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AgentHud() {
  const agent = useAgent();
  const plan = agent.pendingPlan;
  const [mounted, setMounted] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const log = [...agent.log].reverse();

  useEffect(() => {
    setMounted(true);
  }, []);

  const panel =
    mounted &&
    createPortal(
      <div
        className="fixed z-40 pointer-events-auto w-[min(380px,calc(100%-1.5rem))] max-md:left-3 max-md:bottom-28 md:left-[15.5rem] md:bottom-28"
        data-testid="agent-hud"
      >
        <div className="rounded-xl border border-sky-400/30 bg-slate-950/92 backdrop-blur-md shadow-2xl px-3 py-3 text-sm text-slate-100">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: agent.player.color }}
              />
              <div className="min-w-0">
                <div className="font-medium tracking-wide text-sky-200 whitespace-nowrap">
                  {agent.player.name}
                </div>
                <div className="text-[11px] text-slate-400 whitespace-nowrap">
                  {agent.webmcpNative ? 'WebMCP' : 'polyfill'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className={`px-2 py-1 text-[11px] rounded border ${
                  agent.role === 'advisor'
                    ? 'border-sky-400/50 bg-sky-400/10 text-sky-100'
                    : 'border-white/10 text-slate-400'
                }`}
                onClick={() => agent.setRole('advisor')}
              >
                Advisor
              </button>
              <button
                type="button"
                className={`px-2 py-1 text-[11px] rounded border ${
                  agent.role === 'co-builder'
                    ? 'border-amber-400/50 bg-amber-400/10 text-amber-100'
                    : 'border-white/10 text-slate-400'
                }`}
                onClick={() => agent.setRole('co-builder')}
                data-testid="role-cobuilder"
              >
                Co-builder
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="toggle-agent-log"
              onClick={() => setLogOpen((open) => !open)}
              className="text-[11px] text-slate-300 hover:text-white"
            >
              {logOpen ? 'Hide actions' : 'Show actions'}
              {log.length > 0 ? ` (${log.length})` : ''}
              <span className="ml-1 text-slate-500">{logOpen ? '▾' : '▸'}</span>
            </button>
            {agent.undoCount > 0 && (
              <button
                type="button"
                data-testid="undo-agent"
                onClick={() => agent.undoAgent()}
                className="text-[11px] text-sky-300 hover:text-sky-100"
              >
                Undo ({agent.undoCount})
              </button>
            )}
          </div>

          {logOpen && (
            <div className="mt-2 border-t border-white/10 pt-2">
              {log.length === 0 ? (
                <p className="text-[12px] text-slate-500">Nothing yet. When the agent proposes or builds, it shows up here.</p>
              ) : (
                <ul
                  className="max-h-40 overflow-y-auto space-y-1.5 pr-1"
                  data-testid="agent-action-log"
                >
                  {log.map((entry) => {
                    const meta = KIND_LABEL[entry.kind];
                    return (
                      <li key={entry.id} className="text-[12px] leading-snug">
                        <span className={`font-semibold uppercase tracking-wide text-[10px] ${meta.className}`}>
                          {meta.tag}
                        </span>
                        <span className="text-slate-500 text-[10px] ml-2">{formatTime(entry.at)}</span>
                        <div className="text-slate-200">{entry.text}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>,
      document.body,
    );

  const banner =
    mounted && plan
      ? createPortal(
          <div
            className="fixed inset-x-0 bottom-0 z-[10050] flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none"
            data-testid="agent-plan-banner"
          >
            <div className="pointer-events-auto w-[min(640px,100%)] rounded-2xl border-2 border-amber-300 bg-slate-950 shadow-[0_12px_50px_rgba(0,0,0,0.55)] px-5 py-4 text-slate-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-amber-300">
                    Second Mayor needs you
                  </div>
                  <div className="mt-1 text-lg font-semibold text-amber-50">{plan.title}</div>
                </div>
                <span className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">
                  {agent.role}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-200">{plan.summary}</p>
              {plan.reason && (
                <p className="mt-1 text-sm italic text-amber-100/80">{plan.reason}</p>
              )}
              {agent.lastError && (
                <p className="mt-2 text-sm text-red-300" data-testid="plan-error">
                  {agent.lastError}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  data-testid="approve-plan"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    agent.confirmPlan(plan);
                  }}
                  className="min-w-[140px] px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-sm font-bold shadow-lg"
                >
                  Approve
                </button>
                <button
                  type="button"
                  data-testid="reject-plan"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    agent.rejectPlan();
                  }}
                  className="min-w-[120px] px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {panel}
      {banner}
    </>
  );
}
