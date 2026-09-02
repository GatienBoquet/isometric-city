import type { GameState, Tile } from '@/types/game';

const PLACEABLE = new Set(['grass', 'tree', 'road', 'rail']);

/** Tiles a road/rail can be laid on, including track that is already there. */
function walkable(tile: Tile | undefined): boolean {
  if (!tile) return false;
  if (tile.building.type === 'road' || tile.building.type === 'bridge') return true;
  return PLACEABLE.has(tile.building.type);
}

/** Mirrors MAX_BRIDGE_SPAN in simulation.ts — a wider gap gets no bridge. */
const MAX_WATER_CROSSING = 10;

/**
 * From (x,y), walk in one direction over water and report the far bank if the
 * run is short enough to be bridged.
 */
function scanCrossing(
  grid: Tile[][],
  gridSize: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { water: { x: number; y: number }[]; far: { x: number; y: number } } | null {
  const water: { x: number; y: number }[] = [];
  let cx = x + dx;
  let cy = y + dy;

  while (cx >= 0 && cy >= 0 && cx < gridSize && cy < gridSize) {
    const tile = grid[cy][cx];
    if (tile.building.type === 'water') {
      water.push({ x: cx, y: cy });
      if (water.length > MAX_WATER_CROSSING) return null;
      cx += dx;
      cy += dy;
      continue;
    }
    if (!water.length || !walkable(tile)) return null;
    return { water, far: { x: cx, y: cy } };
  }
  return null;
}

export function findBuildablePath(
  state: GameState,
  start: { x: number; y: number },
  end: { x: number; y: number },
  maxLength = 200,
): { x: number; y: number }[] | null {
  const { grid, gridSize } = state;
  if (!grid[start.y]?.[start.x] || !grid[end.y]?.[end.x]) return null;
  if (!walkable(grid[start.y][start.x]) || !walkable(grid[end.y][end.x])) {
    return null;
  }

  const key = (x: number, y: number) => y * gridSize + x;
  const visited = new Uint8Array(gridSize * gridSize);
  const parent = new Int32Array(gridSize * gridSize).fill(-1);
  const qx: number[] = [start.x];
  const qy: number[] = [start.y];
  visited[key(start.x, start.y)] = 1;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let head = 0;
  let found = false;
  // BFS visits each tile at most once, so the grid itself is the bound. Capping
  // the queue instead would abandon paths that are perfectly buildable on a
  // large map.
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head += 1;
    if (x === end.x && y === end.y) {
      found = true;
      break;
    }
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
      const idx = key(nx, ny);
      if (visited[idx]) continue;

      if (grid[ny][nx].building.type === 'water') {
        // Straight runs of water are bridgeable, so step over them and keep the
        // water tiles in the path: createBridgesOnPath needs to see them to
        // recognise the crossing. Anything longer than a bridge span is not a
        // route.
        const crossing = scanCrossing(grid, gridSize, x, y, dx, dy);
        if (!crossing) continue;

        let from = key(x, y);
        for (const water of crossing.water) {
          const wIdx = key(water.x, water.y);
          visited[wIdx] = 1;
          parent[wIdx] = from;
          from = wIdx;
        }
        const farIdx = key(crossing.far.x, crossing.far.y);
        visited[farIdx] = 1;
        parent[farIdx] = from;
        qx.push(crossing.far.x);
        qy.push(crossing.far.y);
        continue;
      }

      if (!walkable(grid[ny][nx])) continue;
      visited[idx] = 1;
      parent[idx] = key(x, y);
      qx.push(nx);
      qy.push(ny);
    }
  }

  if (!found) return null;

  const path: { x: number; y: number }[] = [];
  let idx = key(end.x, end.y);
  const startIdx = key(start.x, start.y);
  while (idx !== -1) {
    const x = idx % gridSize;
    const y = Math.floor(idx / gridSize);
    path.push({ x, y });
    if (idx === startIdx) break;
    idx = parent[idx];
    if (path.length > maxLength) return null;
  }
  path.reverse();
  return path;
}

/**
 * Clamp a rectangle to a whole number of rows that fits within `maxTiles`, so a
 * capped plan never ends mid-row and leaves a ragged edge.
 */
export function tilesInRectCapped(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  gridSize: number,
  maxTiles: number,
): { tiles: { x: number; y: number }[]; truncated: boolean } {
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(gridSize - 1, Math.max(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxY = Math.min(gridSize - 1, Math.max(y1, y2));
  if (minX > maxX || minY > maxY) return { tiles: [], truncated: false };

  const width = maxX - minX + 1;
  const fullRows = maxY - minY + 1;
  const rows = Math.max(1, Math.min(fullRows, Math.floor(maxTiles / width)));
  const tiles = tilesInRect(minX, minY, maxX, minY + rows - 1, gridSize);

  // A single row wider than the cap still has to be trimmed.
  if (tiles.length > maxTiles) {
    return { tiles: tiles.slice(0, maxTiles), truncated: true };
  }
  return { tiles, truncated: rows < fullRows };
}

export function tilesInRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  gridSize: number,
): { x: number; y: number }[] {
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(gridSize - 1, Math.max(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxY = Math.min(gridSize - 1, Math.max(y1, y2));
  const tiles: { x: number; y: number }[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}
