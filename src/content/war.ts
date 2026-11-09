import { z } from 'zod';

const key = z.string().regex(/^[a-z0-9_]+$/);
const int = z.number().int();
const nonNeg = z.number().min(0);
const count = z.number().int().min(0);
const rule = z.object({
  name: z.string().min(1), description: z.string().default(''), prestige: int.default(0), piety: int.default(0),
  win_prestige: int.default(0), win_piety: int.default(0), min_piety: int.default(-1000000), governments: z.array(key).default([]),
});
const event = z.object({ weight: count, text: z.string() });

/** Shape of data/content/war.yaml. */
export const warSourceSchema = z.object({
  forts: z.object({
    capital: z.object({ empire: count, kingdom: count, duchy: count, county: count }),
    development: z.array(z.tuple([count, count])), trade_centre: count, max_level: count, garrison_per_level: count,
    supply_base: count, supply_per_level: count, captured_garrison: count, refill: count, castle_building: key,
  }),
  siege: z.object({
    progress: count, men_min: count, men_max: count, warcraft: count, engineer_bonus: count, max_engineers: count, engineer_cost: nonNeg,
    starving_progress: count, starving_loss: count, prestige: count, event_chance: count,
    events: z.object({ disease: event, sally: event, breach: event, stores_lost: event, traitor: event }),
    disease_loss: count, sally_loss: count, sally_garrison_loss: count, breach_progress: count, stores_lost_days: count, traitor_stores: count,
  }),
  assault: z.object({
    base: count, per_progress: count, breach: count, per_ratio: count, ratio_cap: count, per_level: count, min: count, max: count,
    losses_won: count, losses_lost: count, garrison_lost: count, morale_lost: count, cooldown: count,
  }),
  bribe: z.object({ cost: nonNeg, chances: z.array(count).min(1), unpaid_bonus: count, per_eminence: count, per_level: count, cooldown: count }),
  desertion: z.object({ share: count, morale: count }),
  levy_recovery: count,
  battle_prestige_men: count,
  companies: z.array(z.object({ key, name: z.string().min(1), description: z.string().default(''), men: count, cost: nonNeg, wage: nonNeg, strength: nonNeg })),
  casus_belli: z.object({ conquest: rule, claim: rule, holy_war: rule, independence: rule, raid: rule }),
  raid_loot: nonNeg,
  score: z.object({ battle_cap: count, battle_men: count, battle_max: count, ticking_cap: count, ticking: count }),
  peace: z.object({
    land: count, indemnity_per_month: count, indemnity_months: z.array(count).min(1), vassalize: count, release_vassal: count, humiliate: count, humiliate_prestige: count, break_alliances: count, win_prestige: int, lose_prestige: int,
    ai_score: count, ai_days: count, ai_white: count, concede: count,
  }),
});
export type WarSource = z.infer<typeof warSourceSchema>;
