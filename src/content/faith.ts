import { z } from 'zod';

const key = z.string().regex(/^[a-z0-9_]+$/);
const int = z.number().int();
const nonNeg = z.number().min(0);
const standing = z.object({ prestige: int.default(0), piety: int.default(0) });

/** Shape of data/content/faith.yaml. Money in ducats, prestige and piety in whole points. */
export const faithSourceSchema = z.object({
  prestige_tiers: z.array(z.object({ min: int, name: z.string().min(1), modifier: key.optional() })).min(1),
  piety_tiers: z.array(z.object({ min: int, modifier: key.optional() })).min(1),
  piety_names: z.record(key, z.array(z.string().min(1))),
  start: z.object({
    prestige: z.object({ empire: int, kingdom: int, duchy: int, county: int }),
    piety: int,
    piety_government: z.record(key, int).default({}),
    pious_trait: int.default(0),
  }),
  holy_site_piety: int,
  faiths: z.record(key, z.object({
    head: key.optional(),
    holy_sites: z.array(z.tuple([z.string().min(1), z.number().min(-90).max(90), z.number().min(-180).max(180)])).default([]),
  })),
  deeds: z.record(key, z.object({
    name: z.string().min(1), description: z.string().default(''),
    cost: nonNeg.default(0), cost_months: nonNeg.default(0), min_cost: nonNeg.default(0), income_months: nonNeg.default(0),
    prestige: int.default(0), piety: int.default(0),
    cooldown: z.number().int().min(0).default(0), days: z.number().int().min(0).default(0), modifier: key.optional(),
  })),
  pilgrimage_risk: z.number().int().min(0).default(0),
  events: z.object({ default: standing, empty_treasury: standing, dynasty_change_keep: z.number().int().min(0).max(100) }),
  excommunication: z.object({
    faith: key, below: int, chance: z.number().int().min(0), prestige: int.default(0), modifier: key, vacancy: key.optional(),
  }),
  buildings: z.record(key, standing).default({}),
});
export type FaithSource = z.infer<typeof faithSourceSchema>;
