import { z } from 'zod';

const key = z.string().regex(/^[a-z0-9_]+$/);
const effect = z.object({ stat: key, add: z.number() });
const skill = z.enum(['eminence', 'statecraft', 'warcraft']);
const pct = z.number().min(0).max(100);

/** Shape of data/content/characters.yaml. */
export const charactersSourceSchema = z.object({
  skills: z.object({
    pivot: z.number().int(),
    ruler: z.object({ eminence: z.array(effect), statecraft: z.array(effect), warcraft: z.array(effect) }),
    council: z.record(key, z.object({ skill, effects: z.array(effect) })),
    salary: z.number().min(0),
  }),
  education: z.object({ start: z.number().int(), end: z.number().int(), per_tier: z.number().positive(), bonus: z.array(z.number().int()).length(4) }),
  inheritance_variance: z.number().int().min(0),
  majority: z.number().int().positive(),
  mortality: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).min(1),
  fertility: z.object({ chance: z.number().int(), late_chance: z.number().int(), from: z.number().int(), late: z.number().int(), until: z.number().int() }),
  marriage: z.object({ chance: z.number().int(), age: z.number().int() }),
  health: z.object({ base: pct }),
  laws: z.array(z.object({ key, name: z.string().min(1), description: z.string().default('') })).min(1),
  government_laws: z.record(key, key),
  traits: z.array(z.object({
    key, name: z.string().min(1), description: z.string().default(''),
    skills: z.tuple([z.number().int(), z.number().int(), z.number().int()]).default([0, 0, 0]),
    health: z.number().int().default(0), congenital: pct.default(0), chance: pct.default(0),
    ruler: z.array(effect).default([]),
  })),
});
export type CharactersSource = z.infer<typeof charactersSourceSchema>;

/** Shape of data/content/names.yaml. */
export const namesSourceSchema = z.object({
  traditions: z.record(key, z.object({ male: z.array(z.string().min(1)).min(1), female: z.array(z.string().min(1)).min(1) })),
  groups: z.record(key, key),
  religion_overrides: z.array(z.object({ group: key, family: key, tradition: key })).default([]),
});
export type NamesSource = z.infer<typeof namesSourceSchema>;

const kin = z.tuple([z.string().min(1), z.enum(['m', 'f']), z.number().int()]);

/** Shape of data/scenario/1314-rulers.yaml. */
export const rulersSourceSchema = z.object({
  dynasties: z.record(key, z.string().min(1)),
  rulers: z.record(key, z.union([
    z.object({ same_as: key, law: key.optional() }).strict(),
    z.object({
      name: z.string().min(1), born: z.number().int(), dynasty: key, female: z.boolean().default(false), law: key.optional(),
      traits: z.array(key).default([]), skills: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
      spouse: z.tuple([z.string().min(1), z.number().int()]).optional(),
      children: z.array(kin).default([]), siblings: z.array(kin).default([]), regent: kin.optional(),
    }).strict(),
  ])),
});
export type RulersSource = z.infer<typeof rulersSourceSchema>;
