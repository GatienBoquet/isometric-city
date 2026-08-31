import {
  BuildingType,
  GameState,
  Tile,
  Tool,
  TOOL_INFO,
  ZoneType,
} from '@/types/game';
import {
  bulldozeTile,
  placeBuilding,
  placeLandTerraform,
  placeSubway,
  placeWaterTerraform,
} from '@/lib/simulation';

export const toolBuildingMap: Partial<Record<Tool, BuildingType>> = {
  road: 'road',
  rail: 'rail',
  rail_station: 'rail_station',
  tree: 'tree',
  police_station: 'police_station',
  fire_station: 'fire_station',
  hospital: 'hospital',
  school: 'school',
  university: 'university',
  park: 'park',
  park_large: 'park_large',
  tennis: 'tennis',
  power_plant: 'power_plant',
  water_tower: 'water_tower',
  subway_station: 'subway_station',
  stadium: 'stadium',
  museum: 'museum',
  airport: 'airport',
  space_program: 'space_program',
  city_hall: 'city_hall',
  amusement_park: 'amusement_park',
  // New parks
  basketball_courts: 'basketball_courts',
  playground_small: 'playground_small',
  playground_large: 'playground_large',
  baseball_field_small: 'baseball_field_small',
  soccer_field_small: 'soccer_field_small',
  football_field: 'football_field',
  baseball_stadium: 'baseball_stadium',
  community_center: 'community_center',
  office_building_small: 'office_building_small',
  swimming_pool: 'swimming_pool',
  skate_park: 'skate_park',
  mini_golf_course: 'mini_golf_course',
  bleachers_field: 'bleachers_field',
  go_kart_track: 'go_kart_track',
  amphitheater: 'amphitheater',
  greenhouse_garden: 'greenhouse_garden',
  animal_pens_farm: 'animal_pens_farm',
  cabin_house: 'cabin_house',
  campground: 'campground',
  marina_docks_small: 'marina_docks_small',
  pier_large: 'pier_large',
  roller_coaster_small: 'roller_coaster_small',
  community_garden: 'community_garden',
  pond_park: 'pond_park',
  park_gate: 'park_gate',
  mountain_lodge: 'mountain_lodge',
  mountain_trailhead: 'mountain_trailhead',
};

export const toolZoneMap: Partial<Record<Tool, ZoneType>> = {
  zone_residential: 'residential',
  zone_commercial: 'commercial',
  zone_industrial: 'industrial',
  zone_dezone: 'none',
};

/** Tools that place something on a single tile. Excludes camera/grid tools. */
export const PLACEABLE_TOOLS: Tool[] = [
  'bulldoze',
  'subway',
  'zone_water',
  'zone_land',
  ...(Object.keys(toolBuildingMap) as Tool[]),
  ...(Object.keys(toolZoneMap) as Tool[]),
];

export function isPlaceableTool(value: unknown): value is Tool {
  return typeof value === 'string' && PLACEABLE_TOOLS.includes(value as Tool);
}

/**
 * Apply one tool to one tile. Pure: returns the same state object when nothing
 * changed. Shared by the human tool (GameContext.placeAtTile) and the agent so
 * the two paths cannot drift apart.
 */
export function applyToolAtTile(state: GameState, x: number, y: number, tool: Tool): GameState {
  if (tool === 'select') return state;

  const info = TOOL_INFO[tool];
  const cost = info?.cost ?? 0;
  const tile = state.grid[y]?.[x];

  if (!tile) return state;
  if (cost > 0 && state.stats.money < cost) return state;

  // Prevent wasted spend if nothing would change
  if (tool === 'bulldoze' && tile.building.type === 'grass' && tile.zone === 'none') {
    return state;
  }

  const building = toolBuildingMap[tool];
  const zone = toolZoneMap[tool];

  if (zone && tile.zone === zone) return state;
  if (building && tile.building.type === building) return state;

  // Subway is placed underground, leaving the surface building alone
  if (tool === 'subway') {
    if (tile.building.type === 'water') return state;
    if (tile.hasSubway) return state;

    const nextState = placeSubway(state, x, y);
    if (nextState === state) return state;

    return {
      ...nextState,
      stats: { ...nextState.stats, money: nextState.stats.money - cost },
    };
  }

  if (tool === 'zone_water') {
    // Already water, or a bridge that terraforming would break
    if (tile.building.type === 'water' || tile.building.type === 'bridge') return state;

    const nextState = placeWaterTerraform(state, x, y);
    if (nextState === state) return state;

    return {
      ...nextState,
      stats: { ...nextState.stats, money: nextState.stats.money - cost },
    };
  }

  if (tool === 'zone_land') {
    // Only works on water
    if (tile.building.type !== 'water') return state;

    const nextState = placeLandTerraform(state, x, y);
    if (nextState === state) return state;

    return {
      ...nextState,
      stats: { ...nextState.stats, money: nextState.stats.money - cost },
    };
  }

  let nextState: GameState;

  if (tool === 'bulldoze') {
    nextState = bulldozeTile(state, x, y);
  } else if (zone) {
    nextState = placeBuilding(state, x, y, null, zone);
  } else if (building) {
    nextState = placeBuilding(state, x, y, building, null);
  } else {
    return state;
  }

  if (nextState === state) return state;

  if (cost > 0) {
    nextState = {
      ...nextState,
      stats: { ...nextState.stats, money: nextState.stats.money - cost },
    };
  }

  return nextState;
}

export function cloneTile(tile: Tile): Tile {
  return {
    ...tile,
    building: { ...tile.building },
  };
}

/**
 * Tiles are flat records of primitives (plus a flat `building`), so comparing
 * own keys is an exact equality test.
 */
function tileEquals(a: Tile, b: Tile): boolean {
  if (a === b) return true;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (key === 'building') continue;
    if (a[key as keyof Tile] !== b[key as keyof Tile]) return false;
  }

  const aBuilding = a.building as unknown as Record<string, unknown>;
  const bBuilding = b.building as unknown as Record<string, unknown>;
  const aBuildingKeys = Object.keys(aBuilding);
  if (aBuildingKeys.length !== Object.keys(bBuilding).length) return false;
  for (const key of aBuildingKeys) {
    if (aBuilding[key] !== bBuilding[key]) return false;
  }

  return true;
}

/**
 * Snapshot every tile that actually differs between two grids.
 *
 * Placement helpers reach well past the tile they are handed — bulldozing one
 * tile of a 3x3 university clears all nine, bulldozing a bridge tile removes
 * the whole span — so the undo record is built by diffing rather than by
 * predicting a footprint from TOOL_INFO.
 */
export function diffChangedTiles(
  before: Tile[][],
  after: Tile[][],
): { x: number; y: number; tile: Tile }[] {
  const changed: { x: number; y: number; tile: Tile }[] = [];

  for (let y = 0; y < before.length; y++) {
    const beforeRow = before[y];
    const afterRow = after[y];
    if (!afterRow) break;
    if (beforeRow === afterRow) continue;

    for (let x = 0; x < beforeRow.length; x++) {
      const beforeTile = beforeRow[x];
      const afterTile = afterRow[x];
      if (!beforeTile || !afterTile) continue;
      if (tileEquals(beforeTile, afterTile)) continue;
      changed.push({ x, y, tile: cloneTile(beforeTile) });
    }
  }

  return changed;
}
