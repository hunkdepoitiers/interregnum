import { z } from 'zod';
import { terrains } from './map';

const key = z.string().regex(/^[a-z0-9_]+$/);
const point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** Shape of data/content/trade_goods.yaml. */
export const goodsSourceSchema = z.object({
  goods: z.array(z.object({ key, name: z.string().min(1), color: z.string().regex(/^#[0-9a-f]{6}$/i) })).min(1),
  rules: z.array(z.object({
    good: key,
    terrain: z.array(z.enum(terrains)).optional(),
    region: z.array(box).optional(),
    lat_above: z.number().optional(),
    lat_below: z.number().optional(),
    coastal: z.boolean().optional(),
    share: z.number().gt(0).max(1).optional(),
  }).strict()).min(1),
  places: z.array(z.tuple([key, z.union([point, key])])).default([]),
});
export type GoodsSource = z.infer<typeof goodsSourceSchema>;
