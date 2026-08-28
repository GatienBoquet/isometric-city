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

const toolBuildingMap: Partial<Record<Tool, BuildingType>> = {
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

const toolZoneMap: Partial<Record<Tool, ZoneType>> = {
  zone_residential: 'residential',
  zone_commercial: 'commercial',
  zone_industrial: 'industrial',
  zone_dezone: 'none',
};

export function applyToolAtTile(state: GameState, x: number, y: number, tool: Tool): GameState {
  if (tool === 'select') return state;

  const info = TOOL_INFO[tool];
  const cost = info?.cost ?? 0;
  const tile = state.grid[y]?.[x];
  if (!tile) return state;
  if (cost > 0 && state.stats.money < cost) return state;

  if (tool === 'bulldoze' && tile.building.type === 'grass' && tile.zone === 'none') {
    return state;
  }

  const building = toolBuildingMap[tool];
  const zone = toolZoneMap[tool];

  if (zone && tile.zone === zone) return state;
  if (building && tile.building.type === building) return state;

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
    if (tile.building.type === 'water' || tile.building.type === 'bridge') return state;
    const nextState = placeWaterTerraform(state, x, y);
    if (nextState === state) return state;
    return {
      ...nextState,
      stats: { ...nextState.stats, money: nextState.stats.money - cost },
    };
  }

  if (tool === 'zone_land') {
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

/** Origin plus multi-tile footprint (hospital 2x2, university 3x3, ...). */
export function tilesAffectedByPlacement(
  state: GameState,
  placement: { x: number; y: number; tool: Tool },
): { x: number; y: number }[] {
  const size = Math.max(1, TOOL_INFO[placement.tool]?.size ?? 1);
  const cells: { x: number; y: number }[] = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = placement.x + dx;
      const y = placement.y + dy;
      if (state.grid[y]?.[x]) cells.push({ x, y });
    }
  }
  return cells;
}
