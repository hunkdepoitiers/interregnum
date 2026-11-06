import { z } from 'zod';
import { terrains } from './map';

const key = z.string().regex(/^[a-z0-9_]+$/);
const nonNeg = z.number().min(0);
const pct = z.number().min(0).max(100);

/** Shape of data/content/economy.yaml. Money in ducats, shares in percent. */
export const economySourceSchema = z.object({
  wealth_per_head: z.object({ peasants: nonNeg, burghers: nonNeg, nobles: nonNeg, clergy: nonNeg, nomads: nonNeg }),
  development_factor: z.object({ base: nonNeg, per_point: nonNeg }),
  tithe: pct,
  trade_per_thousand: nonNeg,
  vassal_dues: pct,
  court: z.object({ empire: nonNeg, kingdom: nonNeg, duchy: nonNeg, county: nonNeg }),
  administration_per_province: nonNeg,
  retinue_per_thousand: nonNeg,
  growth: z.number(),
  start_treasury_months: nonNeg,
  largesse: pct,
  trade_centres: z.array(z.tuple([z.union([key, z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])]), nonNeg])).default([]),
  laws: z.object({
    tax: z.array(z.object({ key, name: z.string().min(1), description: z.string().default(''), modifier: key.optional() })).min(1),
  }),
  law_cooldown_days: z.number().int().min(0),
  buildings: z.array(z.object({
    key, name: z.string().min(1), description: z.string().default(''), cost: nonNeg, days: z.number().int().positive(), upkeep: nonNeg, modifier: key,
  })),
  banks: z.array(z.object({
    key, name: z.string().min(1), seat: key.optional(), capital: nonNeg, rate: nonNeg, risk: pct, local: z.boolean().default(false),
  })),
  credit: z.object({
    base: pct,
    income_per_point: z.number().positive(),
    income_cap: pct,
    debt_ratio_penalty: nonNeg,
    default_penalty: nonNeg,
    default_memory_days: z.number().int().positive(),
    rate_spread: z.number().positive(),
    terms: z.array(z.number().int().positive()).min(1),
  }),
});
export type EconomySource = z.infer<typeof economySourceSchema>;

/** Shape of data/scenario/1314-population.yaml. */
export const populationSourceSchema = z.object({
  density: z.record(z.enum(terrains), nonNeg),
  regions: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), nonNeg])),
  strata: z.object({ nobles: pct, clergy: pct, burghers: pct }),
  nomads: z.object({ terrains: z.array(z.enum(terrains)), share: pct }),
  town: nonNeg,
  capital_town: nonNeg,
  development: z.object({ base: z.number(), per_density: nonNeg, town: z.number(), max: z.number().int().positive() }),
});
export type PopulationSource = z.infer<typeof populationSourceSchema>;
