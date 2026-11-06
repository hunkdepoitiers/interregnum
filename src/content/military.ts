import { z } from 'zod';
import { terrains } from './map';

const nonNeg = z.number().min(0);
const pct = z.number().int().min(0);
const byTerrain = z.object(Object.fromEntries(terrains.map((t) => [t, pct])) as Record<(typeof terrains)[number], typeof pct>);

/** Shape of data/content/military.yaml. Money in ducats. */
export const militarySourceSchema = z.object({
  units: z.object({
    levy: z.object({ name: z.string().min(1), description: z.string().default(''), strength: nonNeg, wage: nonNeg, late_wage: nonNeg, service_days: z.number().int().positive() }),
    men_at_arms: z.object({ name: z.string().min(1), description: z.string().default(''), strength: nonNeg, wage: nonNeg, cost: nonNeg }),
  }),
  levy_share: nonNeg,
  men_at_arms_per_thousand_levies: nonNeg,
  muster_days: z.number().int().min(0),
  march_km: z.number().positive(),
  strait_days: nonNeg,
  terrain_speed: byTerrain,
  terrain_defence: byTerrain,
  attrition: nonNeg,
  attrition_max: nonNeg,
  hostile_supply: pct,
  home_supply: pct,
  casualties: nonNeg,
  morale_loss: nonNeg,
  morale_regain: nonNeg,
  warcraft_strength: nonNeg,
  occupy_days: z.number().int().positive(),
  occupy_min: z.number().int().positive(),
});
export type MilitarySource = z.infer<typeof militarySourceSchema>;
