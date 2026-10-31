import { z } from 'zod';
import type { Government as SimGovernment, Rank as SimRank } from '../sim/scenario';

// `satisfies` keeps these lists in step with the sim's Rank/Government types.
export const ranks = ['empire', 'kingdom', 'duchy', 'county'] as const satisfies readonly SimRank[];
export const governments = [
  'feudal_monarchy', 'merchant_republic', 'theocracy', 'holy_order', 'steppe_horde', 'iqta_sultanate', 'beylik',
] as const satisfies readonly SimGovernment[];

const key = z.string().regex(/^[a-z0-9_]+$/);

const realmSourceSchema = z.object({
  key,
  name: z.string().min(1),
  rank: z.enum(ranks),
  government: z.enum(governments),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  capital: key,
  overlord: key.optional(),
  scripted: z.boolean().default(false),
  provinces: z.array(key).min(1),
});

/** Shape of data/scenario/*.yaml. */
export const scenarioSourceSchema = z.object({
  /** false = provinces-only map while the map is under construction; realms are kept but not loaded. */
  enabled: z.boolean().default(true),
  unclaimed: z.array(key).default([]),
  occupations: z.record(key, key).default({}),
  realms: z.array(realmSourceSchema).min(1),
});
export type ScenarioSource = z.infer<typeof scenarioSourceSchema>;

export type { Scenario, ScenarioRealm } from '../sim/scenario';
