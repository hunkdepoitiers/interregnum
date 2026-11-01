/** Geographic boxes shared by the map tools. */
export interface Region { west: number; east: number; south: number; north: number }

/**
 * The region whose provinces, deserts and mountains were tuned by hand (seeds.yaml, mountains.yaml,
 * corridors.yaml). World-wide automatic data (populated places, deserts, ranges) is applied only outside it.
 */
export const HAND_MADE_REGION: Region = { west: -11, east: 54, south: 20.5, north: 71.2 };

export function inRegion(r: Region, lat: number, lon: number): boolean {
  return lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north;
}
