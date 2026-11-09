import { z } from 'zod';

const key = z.string().regex(/^[a-z0-9_]+$/);
const int = z.number().int();
const nonNeg = z.number().min(0);
const count = z.number().int().min(0);
const latLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

/** Shape of data/content/diplomacy.yaml. */
export const diplomacySourceSchema = z.object({
  opinion: z.object({ same_faith: int, same_family: int, other_family: int, same_culture_group: int, alliance: int, marriage: int, truce: int, at_war: int, pays_tribute: int }),
  alliance: z.object({ min_opinion: int, break_prestige: int, call_opinion: int }),
  marriage: z.object({ min_opinion: int, age: count, war_prestige: int, call_opinion: int }),
  truce_years: count,
  gift: z.object({ cost: nonNeg, cost_months: nonNeg, opinion: int, days: count, per_eminence: count, cooldown: count }),
  tribute_demand: z.object({ share: count, years: count, power: count, opinion: int }),
  peace_tribute: z.object({ share: count, years: count, cost: count }),
  start_alliances: z.array(z.tuple([key, key])).default([]),
  vassals: z.object({
    base: int, legitimacy: int, prestige_tier: int, unpaid: int, contract_change: int,
    contracts: z.array(z.object({ key, name: z.string().min(1), description: z.string().default(''), dues: count, opinion: int, joins_wars: z.boolean() })).min(1),
  }),
  factions: z.object({ join_below: int, revolt_power: count, revolt_days: count }),
  reply_days: count,
  timeline: z.array(z.object({
    date: z.tuple([count, count, count]), type: z.enum(['tribute', 'invasion']), from: key, to: key,
    share: count.default(0), years: count.default(0), men: count, spawn: latLon,
  })),
});
export type DiplomacySource = z.infer<typeof diplomacySourceSchema>;
