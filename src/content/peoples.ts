import { z } from 'zod';

const key = z.string().regex(/^[a-z0-9_]+$/);
const point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const place = z.union([point, key]);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);

/** Shape of data/scenario/1314-peoples.yaml: cultures and religions, and where they live. */
export const peoplesSourceSchema = z.object({
  religions: z.array(z.object({ key, name: z.string().min(1), family: key, color })).min(1),
  groups: z.record(key, z.string().min(1)),
  fill: z.array(z.array(point).min(3)).default([]),
  cultures: z.array(z.object({
    key,
    name: z.string().min(1),
    group: key,
    religion: key,
    color,
    area: z.array(z.array(point).min(3)).default([]),
    add: z.array(place).default([]),
  })).min(1),
  religion_areas: z.array(z.object({
    religion: key,
    area: z.array(z.array(point).min(3)).default([]),
    add: z.array(place).default([]),
  })).default([]),
});
export type PeoplesSource = z.infer<typeof peoplesSourceSchema>;
