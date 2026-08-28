import type { GameState, Tile } from '@/types/game';

const PLACEABLE = new Set(['grass', 'tree', 'road', 'rail']);

function walkable(tile: Tile | undefined, allowExistingRoad: boolean): boolean {
  if (!tile) return false;
  if (tile.building.type === 'road' || tile.building.type === 'bridge') return allowExistingRoad;
  return PLACEABLE.has(tile.building.type);
}

export function findBuildablePath(
  state: GameState,
  start: { x: number; y: number },
  end: { x: number; y: number },
  maxLength = 200,
): { x: number; y: number }[] | null {
  const { grid, gridSize } = state;
  if (!grid[start.y]?.[start.x] || !grid[end.y]?.[end.x]) return null;
  if (!walkable(grid[start.y][start.x], true) || !walkable(grid[end.y][end.x], true)) {
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
  while (head < qx.length && qx.length < maxLength * 8) {
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
      if (!walkable(grid[ny][nx], true)) continue;
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
