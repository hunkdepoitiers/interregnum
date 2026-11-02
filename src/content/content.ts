import { z } from 'zod';
import type { Action as SimAction, Condition as SimCondition } from '../sim/script';

const key = z.string().regex(/^[a-z0-9_]+$/);

const statSource = z.object({
  key,
  label: z.string().min(1),
  description: z.string().default(''),
  base: z.number(),
  min: z.number(),
  max: z.number(),
  format: z.enum(['number', 'integer', 'percent', 'gold']),
});
/** Shape of data/content/stats.yaml. */
export const statsSourceSchema = z.object({
  province: z.array(statSource).default([]),
  realm: z.array(statSource).default([]),
});

const effectSource = z.union([
  z.object({ stat: key, add: z.number() }).strict(),
  z.object({ stat: key, pct: z.number() }).strict(),
]);
/** Shape of data/content/modifiers.yaml. */
export const modifiersSourceSchema = z.array(z.object({
  key,
  label: z.string().min(1),
  description: z.string().default(''),
  stacking: z.enum(['stack', 'replace']).default('replace'),
  days: z.number().int().positive().optional(),
  effects: z.array(effectSource).min(1),
}));

export type StatsSource = z.infer<typeof statsSourceSchema>;
export type ModifiersSource = z.infer<typeof modifiersSourceSchema>;

/**
 * The conditions/effects language in YAML (see src/sim/script.ts), with numbers in stat units; compileCondition in
 * tools/content-lib.ts turns them into the sim's fixed-point form.
 */
const statTest = z.object({ stat: key, value: z.number() }).strict();
export type ConditionSource =
  | { all: ConditionSource[] } | { any: ConditionSource[] } | { not: ConditionSource }
  | { has_modifier: string } | { stat_at_least: { stat: string; value: number } }
  | { stat_below: { stat: string; value: number } } | { owner: ConditionSource };
export const conditionSchema: z.ZodType<ConditionSource> = z.lazy(() => z.union([
  z.object({ all: z.array(conditionSchema) }).strict(),
  z.object({ any: z.array(conditionSchema) }).strict(),
  z.object({ not: conditionSchema }).strict(),
  z.object({ has_modifier: key }).strict(),
  z.object({ stat_at_least: statTest }).strict(),
  z.object({ stat_below: statTest }).strict(),
  z.object({ owner: conditionSchema }).strict(),
]));
export const actionSchema: z.ZodType<SimAction> = z.lazy(() => z.union([
  z.object({ add_modifier: key }).strict(),
  z.object({ remove_modifier: key }).strict(),
  z.object({ owner: z.array(actionSchema) }).strict(),
]));

export type { SimAction as Action, SimCondition as Condition };
