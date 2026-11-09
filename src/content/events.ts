import { z } from 'zod';
import { actionSchema, conditionSchema, type Action, type ConditionSource } from './content';

const key = z.string().regex(/^[a-z0-9_]+$/);
const count = z.number().int().min(0);
const outcome = z.object({ text: z.string().min(1), actions: z.array(actionSchema).default([]) });
const option = z.object({
  key, label: z.string().min(1), ai: count.default(1), when: conditionSchema.optional(), actions: z.array(actionSchema).default([]),
  odds: z.object({ chance: count, skill: z.number().int().min(0).max(2).optional(), per_point: z.number().int().default(0), success: outcome, failure: outcome }).optional(),
});

/** Shape of data/content/events.yaml. */
export const eventsSourceSchema = z.object({
  places: z.record(key, z.tuple([z.number(), z.number()])).default({}),
  /** [south, west, north, east]. */
  regions: z.record(key, z.tuple([z.number(), z.number(), z.number(), z.number()])).default({}),
  events: z.array(z.object({
    key, title: z.string().min(1), text: z.string().min(1),
    date: z.tuple([count, count, count]).optional(), realm: key.optional(), all: z.boolean().default(false),
    pulse: count.optional(), on: z.enum(['ruler_death', 'siege_won', 'battle_won', 'war_declared']).optional(), chance: count.default(10000),
    cooldown: count.default(0), when: conditionSchema.optional(), options: z.array(option).min(1),
  })),
});
export type EventsSource = z.infer<typeof eventsSourceSchema>;
export type { Action, ConditionSource };
