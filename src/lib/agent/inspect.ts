import type { GameState, Tile } from '@/types/game';

const INFRA = new Set(['empty', 'grass', 'water', 'road', 'bridge', 'rail', 'tree']);

function tileChar(tile: Tile): string {
  if (tile.building.onFire) return '!';
  if (tile.building.abandoned) return '?';
  if (tile.building.type === 'water') return '~';
  if (tile.building.type === 'road' || tile.building.type === 'bridge') return '#';
  if (tile.building.type === 'rail') return '=';
  if (tile.building.type === 'tree') return 'T';
  if (tile.building.type !== 'grass' && tile.building.type !== 'empty') return '*';
  if (tile.zone === 'residential') return 'R';
  if (tile.zone === 'commercial') return 'C';
  if (tile.zone === 'industrial') return 'I';
  return '.';
}

export function summarizeCity(state: GameState) {
  const { stats, budget, year, month, day, hour, cityName, gridSize, taxRate, speed } = state;
  const monthlyNet = stats.income - stats.expenses;
  return {
    cityName,
    date: { year, month, day, hour },
    gridSize,
    speed,
    taxRate,
    money: stats.money,
    population: stats.population,
    jobs: stats.jobs,
    income: stats.income,
    expenses: stats.expenses,
    monthlyNet,
    budgetPositive: monthlyNet >= 0,
    happiness: stats.happiness,
    health: stats.health,
    education: stats.education,
    safety: stats.safety,
    environment: stats.environment,
    demand: stats.demand,
    budget: Object.fromEntries(
      Object.entries(budget).map(([key, value]) => [
        key,
        { funding: value.funding, cost: value.cost },
      ]),
    ),
    legend:
      '. grass  R/C/I zone  # road  = rail  ~ water  * building  T tree  ! fire  ? abandoned',
  };
}

export function inspectRegion(state: GameState, x: number, y: number, radius: number) {
  const size = state.gridSize;
  const r = Math.max(0, Math.min(12, Math.floor(radius)));
  const minX = Math.max(0, x - r);
  const maxX = Math.min(size - 1, x + r);
  const minY = Math.max(0, y - r);
  const maxY = Math.min(size - 1, y + r);

  const rows: string[] = [];
  const tiles: Array<{
    x: number;
    y: number;
    zone: string;
    building: string;
    powered: boolean;
    watered: boolean;
    traffic: number;
    landValue: number;
  }> = [];

  for (let gy = minY; gy <= maxY; gy++) {
    let row = '';
    for (let gx = minX; gx <= maxX; gx++) {
      const tile = state.grid[gy][gx];
      row += tileChar(tile);
      tiles.push({
        x: gx,
        y: gy,
        zone: tile.zone,
        building: tile.building.type,
        powered: tile.building.powered,
        watered: tile.building.watered,
        traffic: tile.traffic,
        landValue: tile.landValue,
      });
    }
    rows.push(row);
  }

  const TILE_DETAIL_LIMIT = 121;
  const detailed = tiles.slice(0, TILE_DETAIL_LIMIT);

  return {
    origin: { x, y },
    radius: r,
    bounds: { minX, minY, maxX, maxY },
    ascii: rows.join('\n'),
    tiles: detailed,
    tileCount: tiles.length,
    // `ascii` always covers the whole region; `tiles` is capped so a wide
    // radius cannot blow up the payload. Say so rather than silently truncate.
    tilesTruncated: detailed.length < tiles.length,
    ...(detailed.length < tiles.length
      ? {
          note: `Per-tile JSON is limited to the first ${TILE_DETAIL_LIMIT} of ${tiles.length} tiles (read left-to-right, top-to-bottom). Use a smaller radius, or read the full region from ascii.`,
        }
      : {}),
  };
}

export function findProblems(state: GameState, limit = 20) {
  const unpowered: Array<{ x: number; y: number; building: string }> = [];
  const unwatered: Array<{ x: number; y: number; building: string }> = [];
  const traffic: Array<{ x: number; y: number; traffic: number }> = [];
  const fires: Array<{ x: number; y: number }> = [];
  const abandoned: Array<{ x: number; y: number; building: string }> = [];
  let zonedEmpty = 0;
  let roadTiles = 0;

  for (let y = 0; y < state.gridSize; y++) {
    for (let x = 0; x < state.gridSize; x++) {
      const tile = state.grid[y][x];
      const type = tile.building.type;
      if (type === 'road' || type === 'bridge') roadTiles += 1;
      if (tile.zone !== 'none' && (type === 'grass' || type === 'empty')) zonedEmpty += 1;
      if (tile.building.onFire && fires.length < limit) fires.push({ x, y });
      if (tile.building.abandoned && abandoned.length < limit) {
        abandoned.push({ x, y, building: type });
      }
      if (!INFRA.has(type)) {
        if (!tile.building.powered && unpowered.length < limit) {
          unpowered.push({ x, y, building: type });
        }
        if (!tile.building.watered && unwatered.length < limit) {
          unwatered.push({ x, y, building: type });
        }
      }
      if (tile.traffic >= 60 && traffic.length < limit) {
        traffic.push({ x, y, traffic: tile.traffic });
      }
    }
  }

  const advisors = state.advisorMessages.map((msg) => ({
    name: msg.name,
    priority: msg.priority,
    messages: msg.messages.slice(0, 3),
  }));

  const demand = state.stats.demand;
  const demandNotes: string[] = [];
  if (demand.residential > 40) demandNotes.push('Residential demand is high — city needs more housing.');
  if (demand.commercial > 40) demandNotes.push('Commercial demand is high — zone shops/offices.');
  if (demand.industrial > 40) demandNotes.push('Industrial demand is high — zone industry.');
  if (demand.residential < -20) demandNotes.push('Residential oversupply — slow down housing.');
  if (state.stats.income < state.stats.expenses) {
    demandNotes.push('Budget is in deficit. Avoid expensive builds or raise tax slightly.');
  }

  return {
    unpowered,
    unwatered,
    highTraffic: traffic,
    fires,
    abandoned,
    zonedEmpty,
    roadTiles,
    advisors,
    notes: demandNotes,
    counts: {
      unpowered: unpowered.length,
      unwatered: unwatered.length,
      highTraffic: traffic.length,
      fires: fires.length,
      abandoned: abandoned.length,
    },
  };
}
