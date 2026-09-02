'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useGame } from '@/context/GameContext';
import { useMultiplayerOptional } from '@/context/MultiplayerContext';
import { Budget, GameState, TOOL_INFO, Tool } from '@/types/game';
import { createBridgesOnPath } from '@/lib/simulation';
import {
  applyToolAtTile,
  cloneTile,
  diffChangedTiles,
  isPlaceableTool,
  tileEquals,
} from '@/lib/placement';
import { findProblems, inspectRegion, summarizeCity } from '@/lib/agent/inspect';
import { findBuildablePath, tilesInRect, tilesInRectCapped } from '@/lib/agent/path';
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
  clearFocus: () => void;
  webmcpNative: boolean;
  /** True while a co-op room is active: the agent may look but not build. */
  readOnly: boolean;
  player: typeof AGENT_PLAYER;
  setRole: (role: AgentRole) => { ok: boolean; role: AgentRole };
  setWebmcpNative: (native: boolean) => void;
  confirmPlan: (plan?: PendingPlan | null, planId?: string) => Json;
  rejectPlan: () => Json;
  undoAgent: (undoId?: string) => Json;
  runTool: (name: string, input: Json) => Json;
  lastError: string | null;
  log: AgentLogEntry[];
}

const AgentContext = createContext<AgentContextValue | null>(null);

/** How long the green "built" markers stay on the map after a plan lands. */
const BUILT_HIGHLIGHT_MS = 6000;

const READ_ONLY_REASON =
  'Second Mayor is advisory only during co-op: agent builds are not sent to the other player, so they would desync the city. Leave the room to build together with the agent.';

function clampInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

/** Human-readable list of tools a plan may reference, for error payloads. */
function toolSuggestions(): string[] {
  return ['road', 'rail', 'tree', 'park', 'police_station', 'fire_station', 'hospital', 'school'];
}

function readTool(value: unknown): { tool: Tool } | { error: string } {
  if (typeof value !== 'string' || !value) {
    return { error: `tool is required. Examples: ${toolSuggestions().join(', ')}.` };
  }
  if (!isPlaceableTool(value)) {
    return {
      error: `Unknown tool "${value}". Call get_tool_catalog for the full list. Examples: ${toolSuggestions().join(', ')}.`,
    };
  }
  return { tool: value };
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const game = useGame();
  const { latestStateRef, mutateGameState, addNotification } = game;
  const multiplayer = useMultiplayerOptional();
  const readOnly = Boolean(multiplayer?.roomCode);

  const [role, setRoleState] = useState<AgentRole>('advisor');
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [highlights, setHighlights] = useState<AgentHighlight[]>([]);
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoRecord[]>([]);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [webmcpNative, setWebmcpNative] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [log, setLog] = useState<AgentLogEntry[]>([]);

  // Mirrors of state that tool calls read synchronously. Written only where the
  // matching setState happens (never during render) so the React Compiler
  // cannot memoize the write away.
  const roleRef = useRef<AgentRole>('advisor');
  const pendingRef = useRef<PendingPlan | null>(null);
  /**
   * Results of plans already committed, keyed by plan id. A WebMCP bridge can
   * deliver the same call more than once (a retry, or a page registered with
   * two contexts over one registry); without this, the second confirm_plan
   * finds no pending plan and reports failure for a build that succeeded.
   */
  const appliedPlansRef = useRef(new Map<string, Json>());
  /** Undo records already consumed, so a repeated call cannot cascade undos. */
  const undoneIdsRef = useRef(new Set<string>());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Replace the map markers, optionally letting them fade on their own. The
   * "built" markers from an applied plan would otherwise sit on the map for
   * the rest of the session.
   */
  const showHighlights = useCallback((marks: AgentHighlight[], ttlMs?: number) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlights(marks);
    if (ttlMs && marks.length) {
      highlightTimerRef.current = setTimeout(() => {
        highlightTimerRef.current = null;
        setHighlights((prev) => (prev === marks ? [] : prev));
      }, ttlMs);
    }
  }, []);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

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
        showHighlights(marks);
        setLastError(null);
        // Co-builder confirms immediately; yanking the human camera onto
        // every ghost makes the map jump while they are still playing.
        if (focusTile && roleRef.current !== 'co-builder') setFocus(focusTile);
      });
    },
    [pushLog, showHighlights],
  );

  const setRole = useCallback((next: AgentRole) => {
    roleRef.current = next;
    setRoleState(next);
    pushLog('role', `Mode: ${next}`);
    return { ok: true, role: next };
  }, [pushLog]);

  const clearFocus = useCallback(() => {
    setFocus(null);
  }, []);

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

  const confirmPlan = useCallback((explicit?: PendingPlan | null, planId?: string) => {
    if (planId) {
      const already = appliedPlansRef.current.get(planId);
      if (already) return { ...already, alreadyApplied: true };
    }

    const plan = explicit ?? pendingRef.current;
    if (!plan) {
      const lastApplied = [...appliedPlansRef.current.values()].pop();
      const error = lastApplied
        ? 'No pending plan. The most recent plan was already applied — check `lastApplied` before proposing it again.'
        : 'No pending plan. Propose something first.';
      setLastError(error);
      return { ok: false, error, ...(lastApplied ? { lastApplied } : {}) };
    }

    if (appliedPlansRef.current.has(plan.id)) {
      return { ...appliedPlansRef.current.get(plan.id)!, alreadyApplied: true };
    }

    if (readOnly) {
      setLastError(READ_ONLY_REASON);
      return { ok: false, error: READ_ONLY_REASON, readOnly: true };
    }

    const before = latestStateRef.current;
    const moneyBefore = before.stats.money;
    const gridBefore = before.grid;

    let appliedCount = 0;
    let policyChanged = false;
    let unaffordable = 0;
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
      // Track tiles are collected whether or not the placement landed: a road
      // cannot be laid on water, and createBridgesOnPath needs those failed
      // water tiles to see that the run crosses a river. Same list the human
      // drag hands to finishTrackDrag.
      const trackTiles: { x: number; y: number }[] = [];
      appliedCount = 0;
      unaffordable = 0;
      for (const placement of plan.placements) {
        if (placement.tool === 'road' || placement.tool === 'rail') {
          trackTiles.push({ x: placement.x, y: placement.y });
        }
        const cost = TOOL_INFO[placement.tool]?.cost ?? 0;
        const attempt = applyToolAtTile(next, placement.x, placement.y, placement.tool);
        if (attempt === next) {
          // Distinguish "ran out of money" from "the tile refused the tool", so
          // the agent is told which one it hit.
          if (cost > 0 && next.stats.money < cost) unaffordable += 1;
          continue;
        }
        appliedCount += 1;
        next = attempt;
      }
      if (trackTiles.length > 1) {
        next = createBridgesOnPath(
          next,
          trackTiles,
          plan.placements.some((p) => p.tool === 'rail') ? 'rail' : 'road',
        );
      }
      return next;
    });

    if (appliedCount === 0 && !policyChanged && plan.placements.length > 0) {
      const error = unaffordable
        ? `Not enough money for this plan (${unaffordable} of ${plan.placements.length} tiles unaffordable). Propose something cheaper.`
        : 'Nothing could be built there (blocked tiles, water, or existing buildings). Reject and pick empty lots.';
      setLastError(error);
      addNotification('Second Mayor', error, '⚠️');
      return { ok: false, error, attempted: plan.placements.length, unaffordable };
    }

    const after = latestStateRef.current;
    const undo: UndoRecord = {
      id: `undo-${Date.now()}`,
      description: plan.title,
      // Diff instead of predicting a footprint: bulldozing one tile of a 3x3
      // building clears all nine, and one bridge tile takes the whole span.
      tiles: diffChangedTiles(gridBefore, after.grid),
      moneySpent: Math.max(0, moneyBefore - after.stats.money),
      taxRate: plan.taxRate !== undefined ? before.taxRate : undefined,
      budget: plan.budget
        ? { key: plan.budget.key, funding: before.budget[plan.budget.key].funding }
        : undefined,
      createdAt: Date.now(),
    };

    pendingRef.current = null;
    const appliedNote = `Applied: ${plan.title}${appliedCount ? ` (${appliedCount} tiles)` : ''}`;
    pushLog('applied', appliedNote);
    flushSync(() => {
      setUndoStack((stack) => [...stack.slice(-19), undo]);
      setPendingPlan(null);
      setLastError(null);
      showHighlights(
        plan.placements.map((p) => ({ x: p.x, y: p.y, kind: 'ok' as const, label: 'built' })),
        BUILT_HIGHLIGHT_MS,
      );
    });
    addNotification('Second Mayor', appliedNote, '🤝');

    const result: Json = {
      ok: true,
      applied: plan.title,
      planId: plan.id,
      undoId: undo.id,
      tilesChanged: appliedCount,
      tilesRestorableOnUndo: undo.tiles.length,
      moneySpent: moneyBefore - after.stats.money,
      money: after.stats.money,
      placements: plan.placements.length,
      ...(unaffordable
        ? {
            unaffordable,
            note: `${unaffordable} tile${unaffordable === 1 ? '' : 's'} skipped for lack of funds.`,
          }
        : {}),
    };

    // Keep only the recent history: enough for a retry to recognise itself.
    appliedPlansRef.current.set(plan.id, result);
    if (appliedPlansRef.current.size > 20) {
      appliedPlansRef.current.delete(appliedPlansRef.current.keys().next().value as string);
    }
    return result;
  }, [addNotification, latestStateRef, mutateGameState, pushLog, readOnly, showHighlights]);

  const undoAgent = useCallback((undoId?: string) => {
    if (undoId && undoneIdsRef.current.has(undoId)) {
      return { ok: true, alreadyUndone: true, undoId };
    }

    const record = undoStack[undoStack.length - 1];
    if (!record) return { ok: false, error: 'Nothing to undo.' };

    if (undoId && record.id !== undoId) {
      return {
        ok: false,
        error: `Undo is a stack: ${undoId} is not the most recent plan. The next one to come off is ${record.id} ("${record.description}"). Undo that first, or call without undoId to take the top.`,
        nextUndoId: record.id,
        nextUndoDescription: record.description,
      };
    }

    if (readOnly) {
      return { ok: false, error: READ_ONLY_REASON, readOnly: true };
    }

    // Only revert tiles that still look the way the plan left them. Anything
    // the human has changed since is theirs, and undoing the agent must not
    // take it away.
    let restored = 0;
    let keptForHuman = 0;
    mutateGameState((prev) => {
      const newGrid = prev.grid.map((row) => row.slice());
      restored = 0;
      keptForHuman = 0;
      for (const snap of record.tiles) {
        const current = newGrid[snap.y]?.[snap.x];
        if (!current) continue;
        if (!tileEquals(current, snap.after)) {
          keptForHuman += 1;
          continue;
        }
        newGrid[snap.y][snap.x] = cloneTile(snap.before);
        restored += 1;
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

    undoneIdsRef.current.add(record.id);
    flushSync(() => {
      setUndoStack((stack) => stack.slice(0, -1));
    });

    const keptNote = keptForHuman
      ? ` (left ${keptForHuman} tile${keptForHuman === 1 ? '' : 's'} you changed since)`
      : '';
    pushLog('undone', `Undid: ${record.description}${keptNote}`);
    addNotification('Second Mayor', `Undid: ${record.description}${keptNote}`, '↩️');
    return {
      ok: true,
      undone: record.description,
      undoId: record.id,
      nextUndoId: undoStack[undoStack.length - 2]?.id ?? null,
      tilesRestored: restored,
      tilesKeptForHuman: keptForHuman,
      ...(keptForHuman
        ? { note: 'Tiles the human changed after the plan were left alone.' }
        : {}),
      remaining: undoStack.length - 1,
    };
  }, [addNotification, mutateGameState, pushLog, readOnly, undoStack]);

  const runTool = useCallback(
    (name: string, input: Json = {}): Json => {
      setLastToolName(name);
      const state = latestStateRef.current;
      const currentRole = roleRef.current;

      switch (name) {
        case 'get_city_state':
          return { ok: true, ...summarizeCity(state) };
        case 'get_tool_catalog':
          return {
            ok: true,
            maxPlanTiles: MAX_PLAN_TILES,
            tools: Object.entries(TOOL_INFO)
              .filter(([tool]) => isPlaceableTool(tool))
              .map(([tool, info]) => ({
                tool,
                cost: info.cost,
                size: info.size ?? 1,
              })),
          };
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
          showHighlights(marks);
          if (marks[0] && roleRef.current !== 'co-builder') {
            setFocus({ x: marks[0].x, y: marks[0].y });
          }
          return { ok: true, ...problems, highlighted: marks.length };
        }
        case 'get_pending_plan':
          return { ok: true, plan: pendingRef.current };
        case 'get_agent_status':
          return {
            ok: true,
            role: currentRole,
            player: AGENT_PLAYER,
            readOnly: readOnly,
            maxPlanTiles: MAX_PLAN_TILES,
            nextUndoId: undoStack[undoStack.length - 1]?.id ?? null,
            pendingPlan: pendingRef.current
              ? { title: pendingRef.current.title, tiles: pendingRef.current.placements.length }
              : null,
            undoCount: undoStack.length,
            note: readOnly
              ? READ_ONLY_REASON
              : 'Human stays in control. Writes are proposals until the human clicks Approve, or until confirm_plan while the human has set co-builder mode.',
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
          showHighlights(next);
          if (next[0] && roleRef.current !== 'co-builder') {
            setFocus({ x: next[0].x, y: next[0].y });
          }
          return { ok: true, count: next.length };
        }
        case 'clear_highlights':
          showHighlights([]);
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
        case 'request_role':
        case 'set_agent_role': {
          // The role is the human's control, not the agent's: an agent that
          // could grant itself co-builder could commit without any approval.
          const wanted = input.role === 'co-builder' ? 'co-builder' : 'advisor';
          if (wanted === currentRole) {
            return { ok: true, role: currentRole, note: `Already in ${currentRole} mode.` };
          }
          pushLog('note', `Asked for ${wanted} mode`);
          addNotification(
            'Second Mayor',
            `Asks for ${wanted} mode — use the toggle in the Second Mayor panel.`,
            '🙋',
          );
          return {
            ok: false,
            needsHuman: true,
            role: currentRole,
            error: `Only the human can change the mode. Your request for ${wanted} mode is now showing in their HUD; keep proposing in the meantime.`,
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
          const requested = input.zone ?? input.tool;
          const allowed: Tool[] = ['zone_residential', 'zone_commercial', 'zone_industrial', 'zone_dezone'];
          if (typeof requested !== 'string' || !allowed.includes(requested as Tool)) {
            return { ok: false, error: `zone must be one of: ${allowed.join(' | ')}` };
          }
          const zoneTool = requested as Tool;
          const { tiles, truncated } = tilesInRectCapped(
            clampInt(input.x1, 0),
            clampInt(input.y1, 0),
            clampInt(input.x2, 0),
            clampInt(input.y2, 0),
            state.gridSize,
            MAX_PLAN_TILES,
          );
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
          return {
            ok: true,
            needsConfirmation: true,
            plan,
            ...(truncated
              ? {
                  truncated: true,
                  note: `Region trimmed to ${tiles.length} whole rows (plans are capped at ${MAX_PLAN_TILES} tiles). Propose the rest as a second plan.`,
                }
              : {}),
          };
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
          const overflow = Math.max(0, raw.length - MAX_PLAN_TILES);
          const placements: AgentPlacement[] = [];
          const rejected: Json[] = [];
          for (const item of raw.slice(0, MAX_PLAN_TILES)) {
            const rec = item as Json;
            const parsed = readTool(rec.tool);
            if ('error' in parsed) {
              rejected.push({ x: rec.x, y: rec.y, tool: rec.tool, error: parsed.error });
              continue;
            }
            const x = clampInt(rec.x, 0);
            const y = clampInt(rec.y, 0);
            if (!state.grid[y]?.[x]) {
              rejected.push({ x, y, tool: parsed.tool, error: 'Tile out of bounds.' });
              continue;
            }
            placements.push({ x, y, tool: parsed.tool });
          }
          if (!placements.length) {
            return {
              ok: false,
              error: 'No valid placements.',
              rejected,
            };
          }
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
          return {
            ok: true,
            needsConfirmation: true,
            plan,
            maxPlanTiles: MAX_PLAN_TILES,
            ...(rejected.length ? { rejected } : {}),
            ...(overflow
              ? {
                  truncated: true,
                  droppedForCap: overflow,
                  note: `Only the first ${MAX_PLAN_TILES} placements are in this plan; ${overflow} were dropped. Send the rest as a second plan after this one is confirmed.`,
                }
              : {}),
          };
        }
        case 'propose_service': {
          const parsed = readTool(input.tool);
          if ('error' in parsed) return { ok: false, error: parsed.error };
          const tool = parsed.tool;
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
          const x1 = clampInt(input.x1, 0);
          const y1 = clampInt(input.y1, 0);
          const tiles = tilesInRect(
            x1,
            y1,
            clampInt(input.x2 ?? input.x1, x1),
            clampInt(input.y2 ?? input.y1, y1),
            state.gridSize,
          ).slice(0, 80);
          if (tiles.length === 0) return { ok: false, error: 'Empty region.' };
          const plan = makePlan({
            title: `Bulldoze ${tiles.length} tiles`,
            summary: 'Ghost bulldoze. Approve to demolish.',
            reason: typeof input.reason === 'string' ? input.reason : undefined,
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
            return {
              ok: false,
              error: `key must be one of: ${Object.keys(state.budget).join(' | ')}`,
            };
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
          if (readOnly) {
            return { ok: false, error: READ_ONLY_REASON, readOnly: true };
          }
          if (currentRole !== 'co-builder') {
            return {
              ok: false,
              error:
                'Advisor mode: only the human can commit. Ask them to click Approve on the plan, or to switch the Second Mayor panel to co-builder.',
              needsHuman: true,
            };
          }
          return confirmPlan(null, typeof input.planId === 'string' ? input.planId : undefined);
        case 'reject_plan':
          return rejectPlan();
        case 'undo_agent_actions':
          return undoAgent(typeof input.undoId === 'string' ? input.undoId : undefined);
        default:
          return { ok: false, error: `Unknown tool ${name}` };
      }
    },
    [
      addNotification,
      confirmPlan,
      latestStateRef,
      makePlan,
      pushLog,
      readOnly,
      rejectPlan,
      revealPlan,
      showHighlights,
      undoAgent,
      undoStack,
    ],
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
      clearFocus,
      webmcpNative,
      readOnly,
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
      clearFocus,
      webmcpNative,
      readOnly,
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
