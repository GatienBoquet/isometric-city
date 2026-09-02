import type { Budget, Tile, Tool } from '@/types/game';

export type AgentRole = 'advisor' | 'co-builder';

export type HighlightKind = 'problem' | 'focus' | 'ghost' | 'ok';

export interface AgentHighlight {
  x: number;
  y: number;
  kind: HighlightKind;
  label?: string;
}

export interface AgentPlacement {
  x: number;
  y: number;
  tool: Tool;
}

export interface PendingPlan {
  id: string;
  title: string;
  summary: string;
  reason?: string;
  placements: AgentPlacement[];
  taxRate?: number;
  budget?: { key: keyof Budget; funding: number };
  createdAt: number;
}

export interface TileSnapshot {
  x: number;
  y: number;
  /** The tile as it was before the plan was applied. */
  before: Tile;
  /**
   * The tile the plan left behind. Undo restores `before` only while the tile
   * still looks like this, so it cannot overwrite something the human built
   * on top afterwards.
   */
  after: Tile;
}

export interface UndoRecord {
  id: string;
  description: string;
  tiles: TileSnapshot[];
  /** Amount the plan spent; refunded on undo without restoring the whole balance. */
  moneySpent?: number;
  taxRate?: number;
  budget?: { key: keyof Budget; funding: number };
  createdAt: number;
}

export type AgentLogKind = 'proposed' | 'applied' | 'rejected' | 'undone' | 'note' | 'role';

export interface AgentLogEntry {
  id: string;
  kind: AgentLogKind;
  text: string;
  at: number;
}

export const AGENT_PLAYER = {
  id: 'agent',
  name: 'Second Mayor',
  color: '#38bdf8',
} as const;

export const MAX_PLAN_TILES = 200;
