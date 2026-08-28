'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useGame } from '@/context/GameContext';
import { Budget, GameState, Tool } from '@/types/game';
import { createBridgesOnPath } from '@/lib/simulation';
import { applyToolAtTile, cloneTile, tilesAffectedByPlacement } from '@/lib/agent/applyTool';
import { findProblems, inspectRegion, summarizeCity } from '@/lib/agent/inspect';
import { findBuildablePath, tilesInRect } from '@/lib/agent/path';
import {
  AGENT_PLAYER,
  AgentHighlight,
  AgentLogEntry,
  AgentLogKind,
  AgentPlacement,
  AgentRole,
  MAX_PLAN_TILES,
  PendingPlan,
  UndoRecord,
} from '@/lib/agent/types';
import { useWebMCPTools } from '@/hooks/useWebMCPTools';

type Json = Record<string, unknown>;

interface AgentContextValue {
  role: AgentRole;
  pendingPlan: PendingPlan | null;
  highlights: AgentHighlight[];
  lastToolName: string | null;
  undoCount: number;
  focus: { x: number; y: number } | null;
  webmcpNative: boolean;
  player: typeof AGENT_PLAYER;
  setRole: (role: AgentRole) => { ok: boolean; role: AgentRole };
  setWebmcpNative: (native: boolean) => void;
  confirmPlan: (plan?: PendingPlan | null) => Json;
  rejectPlan: () => Json;
  undoAgent: () => Json;
  runTool: (name: string, input: Json) => Json;
  lastError: string | null;
  log: AgentLogEntry[];
}

const AgentContext = createContext<AgentContextValue | null>(null);

function clampInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function asTool(value: unknown): Tool | null {
  return typeof value === 'string' ? (value as Tool) : null;
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const game = useGame();
  const { latestStateRef, mutateGameState, addNotification } = game;

  const [role, setRoleState] = useState<AgentRole>('advisor');
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [highlights, setHighlights] = useState<AgentHighlight[]>([]);
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoRecord[]>([]);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [webmcpNative, setWebmcpNative] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [log, setLog] = useState<AgentLogEntry[]>([]);
  const roleRef = useRef(role);
  const pendingRef = useRef(pendingPlan);
  roleRef.current = role;
  pendingRef.current = pendingPlan;

  const pushLog = useCallback((kind: AgentLogKind, text: string) => {
    setLog((prev) => {
      const entry: AgentLogEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        text,
        at: Date.now(),
      };
      return [...prev.slice(-29), entry];
    });
  }, []);

  const snapshotTiles = useCallback((placements: AgentPlacement[]): UndoRecord['tiles'] => {
    const state = latestStateRef.current;
    const seen = new Set<string>();
    const tiles: UndoRecord['tiles'] = [];
    for (const p of placements) {
      for (const cell of tilesAffectedByPlacement(state, p)) {
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tile = state.grid[cell.y]?.[cell.x];
        if (tile) tiles.push({ x: cell.x, y: cell.y, tile: cloneTile(tile) });
      }
    }
    return tiles;
  }, [latestStateRef]);

  const makePlan = useCallback(
    (partial: Omit<PendingPlan, 'id' | 'createdAt'>): PendingPlan => ({
      ...partial,
      id: `plan-${Date.now()}`,
      createdAt: Date.now(),
    }),
    [],
  );

  const revealPlan = useCallback(
    (plan: PendingPlan, marks: AgentHighlight[], focusTile?: { x: number; y: number }) => {
      pendingRef.current = plan;
      pushLog('proposed', plan.title);
      flushSync(() => {
        setPendingPlan(plan);
        setHighlights(marks);
        setLastError(null);
        if (focusTile) setFocus(focusTile);
      });
    },
    [pushLog],
  );

  const setRole = useCallback((next: AgentRole) => {
    setRoleState(next);
    pushLog('role', `Mode: ${next}`);
    return { ok: true, role: next };
  }, [pushLog]);

  const rejectPlan = useCallback(() => {
    if (!pendingRef.current) {
      return { ok: false, error: 'No pending plan to reject.' };
    }
    const title = pendingRef.current.title;
    pendingRef.current = null;
    pushLog('rejected', `Rejected: ${title}`);
    flushSync(() => {
      setPendingPlan(null);
      setLastError(null);
      setHighlights((prev) => prev.filter((h) => h.kind !== 'ghost'));
    });
    return { ok: true, rejected: title };
  }, [pushLog]);

  const confirmPlan = useCallback((explicit?: PendingPlan | null) => {
    const plan = explicit ?? pendingRef.current;
    if (!plan) {
      const error = 'No pending plan. Propose something first.';
      setLastError(error);
      return { ok: false, error };
    }

    const state = latestStateRef.current;
    const moneyBefore = state.stats.money;
    const undo: UndoRecord = {
      id: `undo-${Date.now()}`,
      description: plan.title,
      tiles: snapshotTiles(plan.placements),
      taxRate: plan.taxRate !== undefined ? state.taxRate : undefined,
      budget: plan.budget
        ? { key: plan.budget.key, funding: state.budget[plan.budget.key].funding }
        : undefined,
      createdAt: Date.now(),
    };

    let appliedCount = 0;
    let policyChanged = false;
    mutateGameState((prev) => {
      let next: GameState = prev;
      if (plan.taxRate !== undefined && plan.taxRate !== prev.taxRate) {
        next = { ...next, taxRate: Math.max(0, Math.min(100, plan.taxRate)) };
        policyChanged = true;
      }
      if (plan.budget && next.budget[plan.budget.key].funding !== plan.budget.funding) {
        next = {
          ...next,
          budget: {
            ...next.budget,
            [plan.budget.key]: {
              ...next.budget[plan.budget.key],
              funding: Math.max(0, Math.min(100, plan.budget.funding)),
            },
          },
        };
        policyChanged = true;
      }
      const roadTiles: { x: number; y: number }[] = [];
      appliedCount = 0;
      for (const placement of plan.placements) {
        const attempt = applyToolAtTile(next, placement.x, placement.y, placement.tool);
        if (attempt !== next) {
          appliedCount += 1;
          next = attempt;
        }
        if (placement.tool === 'road' || placement.tool === 'rail') {
          roadTiles.push({ x: placement.x, y: placement.y });
        }
      }
      if (roadTiles.length > 1) {
        next = createBridgesOnPath(
          next,
          roadTiles,
          plan.placements.some((p) => p.tool === 'rail') ? 'rail' : 'road',
        );
      }
      return next;
    });

    if (appliedCount === 0 && !policyChanged && plan.placements.length > 0) {
      const error =
        'Nothing could be built there (blocked tiles, water, or existing buildings). Reject and pick empty lots.';
      setLastError(error);
      addNotification('Second Mayor', error, '⚠️');
      return { ok: false, error, attempted: plan.placements.length };
    }

    undo.moneySpent = Math.max(0, moneyBefore - latestStateRef.current.stats.money);
    pendingRef.current = null;
    const appliedNote = `Applied: ${plan.title}${appliedCount ? ` (${appliedCount} tiles)` : ''}`;
    pushLog('applied', appliedNote);
    flushSync(() => {
      setUndoStack((stack) => [...stack.slice(-19), undo]);
      setPendingPlan(null);
      setLastError(null);
      setHighlights(
        plan.placements.map((p) => ({ x: p.x, y: p.y, kind: 'ok' as const, label: 'built' })),
      );
    });
    addNotification('Second Mayor', appliedNote, '🤝');

    const after = latestStateRef.current;
    return {
      ok: true,
      applied: plan.title,
      tilesChanged: appliedCount,
      moneySpent: moneyBefore - after.stats.money,
      money: after.stats.money,
      placements: plan.placements.length,
    };
  }, [addNotification, latestStateRef, mutateGameState, pushLog, snapshotTiles]);

  const undoAgent = useCallback(() => {
    const record = undoStack[undoStack.length - 1];
    if (!record) return { ok: false, error: 'Nothing to undo.' };

    mutateGameState((prev) => {
      const newGrid = prev.grid.map((row) => row.slice());
      for (const snap of record.tiles) {
        if (!newGrid[snap.y]) continue;
        newGrid[snap.y] = newGrid[snap.y].slice();
        newGrid[snap.y][snap.x] = cloneTile(snap.tile);
      }
      let next: GameState = { ...prev, grid: newGrid };
      if (record.moneySpent) {
        next = {
          ...next,
          stats: { ...next.stats, money: next.stats.money + record.moneySpent },
        };
      }
      if (record.taxRate !== undefined) {
        next = { ...next, taxRate: record.taxRate };
      }
      if (record.budget) {
        next = {
          ...next,
          budget: {
            ...next.budget,
            [record.budget.key]: {
              ...next.budget[record.budget.key],
              funding: record.budget.funding,
            },
          },
        };
      }
      return next;
    });

    setUndoStack((stack) => stack.slice(0, -1));
    pushLog('undone', `Undid: ${record.description}`);
    addNotification('Second Mayor', `Undid: ${record.description}`, '↩️');
    return { ok: true, undone: record.description, remaining: undoStack.length - 1 };
  }, [addNotification, mutateGameState, pushLog, undoStack]);

  const runTool = useCallback(
    (name: string, input: Json = {}): Json => {
      setLastToolName(name);
      const state = latestStateRef.current;
      const currentRole = roleRef.current;

      switch (name) {
        case 'get_city_state':
          return { ok: true, ...summarizeCity(state) };
        case 'inspect_region': {
          const x = clampInt(input.x, 0);
          const y = clampInt(input.y, 0);
          const radius = clampInt(input.radius, 4);
          return { ok: true, ...inspectRegion(state, x, y, radius) };
        }
        case 'get_problems': {
          const problems = findProblems(state);
          const marks: AgentHighlight[] = [
            ...problems.unpowered.slice(0, 8).map((p) => ({
              x: p.x,
              y: p.y,
              kind: 'problem' as const,
              label: 'no power',
            })),
            ...problems.highTraffic.slice(0, 8).map((p) => ({
              x: p.x,
              y: p.y,
              kind: 'problem' as const,
              label: 'traffic',
            })),
            ...problems.fires.map((p) => ({
              x: p.x,
              y: p.y,
              kind: 'problem' as const,
              label: 'fire',
            })),
          ];
          setHighlights(marks);
          if (marks[0]) setFocus({ x: marks[0].x, y: marks[0].y });
          return { ok: true, ...problems, highlighted: marks.length };
        }
        case 'get_pending_plan':
          return { ok: true, plan: pendingRef.current };
        case 'get_agent_status':
          return {
            ok: true,
            role: currentRole,
            player: AGENT_PLAYER,
            pendingPlan: pendingRef.current
              ? { title: pendingRef.current.title, tiles: pendingRef.current.placements.length }
              : null,
            undoCount: undoStack.length,
            note: 'Human stays in control. Writes are proposals until confirm_plan or the on-page Approve button.',
          };
        case 'highlight_tiles': {
          const raw = Array.isArray(input.tiles) ? input.tiles : [];
          const next = raw
            .slice(0, 80)
            .map((item) => {
              const rec = item as Json;
              return {
                x: clampInt(rec.x, 0),
                y: clampInt(rec.y, 0),
                kind: (rec.kind as AgentHighlight['kind']) || 'focus',
                label: typeof rec.label === 'string' ? rec.label : undefined,
              };
            })
            .filter((h) => state.grid[h.y]?.[h.x]);
          setHighlights(next);
          if (next[0]) setFocus({ x: next[0].x, y: next[0].y });
          return { ok: true, count: next.length };
        }
        case 'clear_highlights':
          setHighlights([]);
          return { ok: true };
        case 'focus_tile': {
          const x = clampInt(input.x, 0);
          const y = clampInt(input.y, 0);
          if (!state.grid[y]?.[x]) return { ok: false, error: 'Tile out of bounds.' };
          setFocus({ x, y });
          setHighlights((prev) => [
            ...prev.filter((h) => h.kind !== 'focus'),
            { x, y, kind: 'focus', label: typeof input.label === 'string' ? input.label : 'look here' },
          ]);
          return { ok: true, x, y };
        }
        case 'set_agent_role': {
          const next = input.role === 'co-builder' ? 'co-builder' : 'advisor';
          setRoleState(next);
          return {
            ok: true,
            role: next,
            note:
              next === 'advisor'
                ? 'Advisor can inspect, highlight, and propose. The human must Approve.'
                : 'Co-builder may call confirm_plan after proposing. Human can still reject or undo.',
          };
        }
        case 'add_agent_note': {
          const text = typeof input.message === 'string' ? input.message.slice(0, 240) : '';
          if (!text) return { ok: false, error: 'message is required' };
          pushLog('note', text);
          addNotification('Second Mayor', text, '💬');
          return { ok: true, message: text };
        }
        case 'propose_zone_region': {
          const zoneTool = asTool(input.zone) || asTool(input.tool);
          const allowed: Tool[] = ['zone_residential', 'zone_commercial', 'zone_industrial', 'zone_dezone'];
          if (!zoneTool || !allowed.includes(zoneTool)) {
            return { ok: false, error: 'zone must be zone_residential | zone_commercial | zone_industrial | zone_dezone' };
          }
          const tiles = tilesInRect(
            clampInt(input.x1, 0),
            clampInt(input.y1, 0),
            clampInt(input.x2, 0),
            clampInt(input.y2, 0),
            state.gridSize,
          ).slice(0, MAX_PLAN_TILES);
          if (tiles.length === 0) return { ok: false, error: 'Empty region.' };
          const plan = makePlan({
            title: `Zone ${tiles.length} tiles as ${zoneTool.replace('zone_', '')}`,
            summary: `Ghost ${tiles.length} ${zoneTool} tiles. Waiting for your approval.`,
            reason: typeof input.reason === 'string' ? input.reason : undefined,
            placements: tiles.map((t) => ({ ...t, tool: zoneTool })),
          });
          revealPlan(
            plan,
            plan.placements.map((p) => ({ x: p.x, y: p.y, kind: 'ghost', label: zoneTool })),
            plan.placements[0],
          );
          return { ok: true, needsConfirmation: true, plan };
        }
        case 'propose_road_path': {
          const start = { x: clampInt(input.x1, 0), y: clampInt(input.y1, 0) };
          const end = { x: clampInt(input.x2, 0), y: clampInt(input.y2, 0) };
          const path = findBuildablePath(state, start, end, MAX_PLAN_TILES);
          if (!path) return { ok: false, error: 'No buildable path (blocked by water or buildings).' };
          const tool: Tool = input.tool === 'rail' ? 'rail' : 'road';
          const plan = makePlan({
            title: `${tool} from (${start.x},${start.y}) to (${end.x},${end.y})`,
            summary: `Ghost ${path.length} ${tool} tiles. Approve to build.`,
            reason: typeof input.reason === 'string' ? input.reason : undefined,
            placements: path.map((t) => ({ ...t, tool })),
          });
          revealPlan(
            plan,
            plan.placements.map((p) => ({ x: p.x, y: p.y, kind: 'ghost', label: tool })),
            start,
          );
          return { ok: true, needsConfirmation: true, plan: { ...plan, length: path.length } };
        }
        case 'propose_placements': {
          const raw = Array.isArray(input.placements) ? input.placements : [];
          const placements: AgentPlacement[] = raw
            .slice(0, MAX_PLAN_TILES)
            .map((item) => {
              const rec = item as Json;
              return {
                x: clampInt(rec.x, 0),
                y: clampInt(rec.y, 0),
                tool: (asTool(rec.tool) || 'tree') as Tool,
              };
            })
            .filter((p) => state.grid[p.y]?.[p.x]);
          if (!placements.length) return { ok: false, error: 'No valid placements.' };
          const plan = makePlan({
            title: `Place ${placements.length} items`,
            summary: `Ghost ${placements.length} tiles. Approve to build.`,
            reason: typeof input.reason === 'string' ? input.reason : undefined,
            placements,
          });
          revealPlan(
            plan,
            placements.map((p) => ({ x: p.x, y: p.y, kind: 'ghost', label: p.tool })),
            placements[0],
          );
          return { ok: true, needsConfirmation: true, plan };
        }
        case 'propose_service': {
          const tool = asTool(input.tool);
          if (!tool) return { ok: false, error: 'tool is required (e.g. fire_station, school, hospital).' };
          const x = clampInt(input.x, 0);
          const y = clampInt(input.y, 0);
          if (!state.grid[y]?.[x]) return { ok: false, error: 'Tile out of bounds.' };
          const plan = makePlan({
            title: `Place ${tool} at (${x},${y})`,
            summary: `Ghost a ${tool}. Approve to spend and place.`,
            reason: typeof input.reason === 'string' ? input.reason : undefined,
            placements: [{ x, y, tool }],
          });
          revealPlan(plan, [{ x, y, kind: 'ghost', label: tool }], { x, y });
          return { ok: true, needsConfirmation: true, plan };
        }
        case 'propose_bulldoze': {
          const tiles = tilesInRect(
            clampInt(input.x1, 0),
            clampInt(input.y1, 0),
            clampInt(input.x2 ?? input.x1, 0),
            clampInt(input.y2 ?? input.y1, 0),
            state.gridSize,
          ).slice(0, 80);
          const plan = makePlan({
            title: `Bulldoze ${tiles.length} tiles`,
            summary: 'Ghost bulldoze. Approve to demolish.',
            placements: tiles.map((t) => ({ ...t, tool: 'bulldoze' as Tool })),
          });
          revealPlan(
            plan,
            plan.placements.map((p) => ({ x: p.x, y: p.y, kind: 'problem', label: 'bulldoze' })),
            plan.placements[0],
          );
          return { ok: true, needsConfirmation: true, plan };
        }
        case 'propose_tax_rate': {
          const rate = Math.max(0, Math.min(100, clampInt(input.rate, state.taxRate)));
          const plan = makePlan({
            title: `Set tax rate to ${rate}%`,
            summary: `Current tax ${state.taxRate}% → ${rate}%. Approve to apply.`,
            reason: typeof input.reason === 'string' ? input.reason : undefined,
            placements: [],
            taxRate: rate,
          });
          revealPlan(plan, []);
          return { ok: true, needsConfirmation: true, plan };
        }
        case 'propose_budget': {
          const key = String(input.key || '') as keyof Budget;
          if (!state.budget[key]) {
            return { ok: false, error: 'key must be police|fire|health|education|transportation|parks|power|water' };
          }
          const funding = Math.max(0, Math.min(100, clampInt(input.funding, state.budget[key].funding)));
          const plan = makePlan({
            title: `Set ${key} funding to ${funding}%`,
            summary: `${key} ${state.budget[key].funding}% → ${funding}%. Approve to apply.`,
            reason: typeof input.reason === 'string' ? input.reason : undefined,
            placements: [],
            budget: { key, funding },
          });
          revealPlan(plan, []);
          return { ok: true, needsConfirmation: true, plan };
        }
        case 'confirm_plan':
          if (currentRole !== 'co-builder') {
            return {
              ok: false,
              error: 'Advisor cannot commit. Ask the human to click Approve, or set_agent_role to co-builder.',
              needsHuman: true,
            };
          }
          return confirmPlan();
        case 'reject_plan':
          return rejectPlan();
        case 'undo_agent_actions':
          return undoAgent();
        default:
          return { ok: false, error: `Unknown tool ${name}` };
      }
    },
    [addNotification, confirmPlan, latestStateRef, makePlan, pushLog, rejectPlan, revealPlan, undoAgent, undoStack.length],
  );

  useWebMCPTools(runTool, setWebmcpNative);

  const value = useMemo<AgentContextValue>(
    () => ({
      role,
      pendingPlan,
      highlights,
      lastToolName,
      undoCount: undoStack.length,
      focus,
      webmcpNative,
      player: AGENT_PLAYER,
      setRole,
      setWebmcpNative,
      confirmPlan,
      rejectPlan,
      undoAgent,
      runTool,
      lastError,
      log,
    }),
    [
      role,
      pendingPlan,
      highlights,
      lastToolName,
      undoStack.length,
      focus,
      webmcpNative,
      setRole,
      confirmPlan,
      rejectPlan,
      undoAgent,
      runTool,
      lastError,
      log,
    ],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used within AgentProvider');
  return ctx;
}

export function useAgentOptional() {
  return useContext(AgentContext);
}
