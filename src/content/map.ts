import { z } from 'zod';

export const projectionSchema = z.object({
  width: z.number().int().positive(),
  west: z.number(),
  east: z.number(),
  north: z.number(),
  south: z.number(),
  standardParallel: z.number(),
});
export type Projection = z.infer<typeof projectionSchema>;

export function projectionSize(p: Projection): { width: number; height: number; scale: number } {
  const k = Math.cos((p.standardParallel * Math.PI) / 180);
  const scale = p.width / ((p.east - p.west) * k);
  return { width: p.width, height: Math.round((p.north - p.south) * scale), scale };
}

export function lonLatToPixel(p: Projection, lon: number, lat: number): [number, number] {
  const { scale } = projectionSize(p);
  const k = Math.cos((p.standardParallel * Math.PI) / 180);
  return [(lon - p.west) * k * scale, (p.north - lat) * scale];
}

/** wasteland = impassable desert or taiga; mountain = impassable range (data/map/mountains.yaml). */
export const provinceKinds = ['land', 'sea', 'wasteland', 'mountain', 'lake'] as const;
export type ProvinceKind = (typeof provinceKinds)[number];

export const definitionSchema = z.object({
  id: z.number().int().min(1).max(65535),
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  kind: z.enum(provinceKinds),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const definitionsSchema = z.array(definitionSchema).superRefine((defs, ctx) => {
  const seen = { id: new Set<number>(), key: new Set<string>(), color: new Set<string>() };
  defs.forEach((d, i) => {
    for (const field of ['id', 'key', 'color'] as const) {
      const v = field === 'color' ? d.color.toLowerCase() : d[field];
      const set = seen[field] as Set<typeof v>;
      if (set.has(v)) ctx.addIssue({ code: 'custom', path: [i, field], message: `duplicate ${field} ${v}` });
      set.add(v);
    }
  });
});
export type ProvinceDefinition = z.infer<typeof definitionSchema>;

export const straitsSchema = z.array(z.tuple([z.string(), z.string()]));

const seedKey = z.string().regex(/^[a-z0-9_]+$/);
/** [key, name, lat, lon] or [key, name, lat, lon, max radius in km]. */
const seedRow = z.union([
  z.tuple([seedKey, z.string(), z.number(), z.number()]),
  z.tuple([seedKey, z.string(), z.number(), z.number(), z.number().positive()]),
]);
export const seedsSchema = z.object({
  land: z.array(seedRow),
  sea: z.array(seedRow),
  wasteland: z.array(seedRow),
});

/** Shape of public/generated/map.json, produced by tools/build-map.ts. */
export interface MapProvince {
  id: number;
  key: string;
  name: string;
  kind: ProvinceKind;
  color: string;
  pixels: number;
  bbox: [number, number, number, number];
  centroid: [number, number];
  coastal: boolean;
  adjacency: { id: number; border: number; strait?: true }[];
}
/** public/generated/rivers.json: polylines as flat [x0, y0, x1, y1, ...] in map pixels; rank 0 = largest. */
export type RiverData = { name: string | null; rank: number; lines: number[][] }[];

export interface MapData {
  width: number;
  height: number;
  projection: Projection;
  provinces: MapProvince[];
}
