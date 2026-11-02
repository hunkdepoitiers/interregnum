import { z } from 'zod';
import { GOVERNMENTS, RANKS } from '../sim/scenario';

export const ranks = RANKS;
export const governments = GOVERNMENTS;

const key = z.string().regex(/^[a-z0-9_]+$/);
/** [lat, lon] in degrees. */
const point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
/** A spot on the map: [lat, lon], or the key of a town in data/map/seeds*.yaml. Resolves to the land province there. */
const place = z.union([point, key]);
export type Place = z.infer<typeof place>;

const realmSourceSchema = z.object({
  key,
  name: z.string().min(1),
  rank: z.enum(ranks),
  government: z.enum(governments),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  capital: place,
  overlord: key.optional(),
  scripted: z.boolean().default(false),
  /** Outlines; land provinces whose centre lies inside one belong to the realm. Later realms paint over earlier ones. */
  area: z.array(z.array(point).min(3)).default([]),
  /** Single provinces taken by place; these (and the capital) override every outline. */
  add: z.array(place).default([]),
});

/** Shape of data/scenario/*.yaml. */
export const scenarioSourceSchema = z.object({
  /** Outlines where no land should stay unowned: gaps inside them go to the nearest realm over land. */
  fill: z.array(z.array(point).min(3)).default([]),
  /** Hand edits from the in-game map editor: [lat, lon, realm key or null for unowned]; override everything. */
  overrides: z.array(z.tuple([z.number(), z.number(), key.nullable()])).default([]),
  /** Modifiers in force at the start: [realm, modifier] (data/content/modifiers.yaml). Every capital also gets `capital`. */
  modifiers: z.array(z.tuple([key, key])).default([]),
  /** Controller differs from owner at game start: [place, occupying realm]. */
  occupations: z.array(z.tuple([place, key])).default([]),
  realms: z.array(realmSourceSchema).min(1),
});
export type ScenarioSource = z.infer<typeof scenarioSourceSchema>;

/** Shape of data/scenario/1314-edits.yaml, written by the map editor: new realms and per-province overrides. */
export const editsSourceSchema = z.object({
  realms: z.array(realmSourceSchema).default([]),
  overrides: z.array(z.tuple([z.number(), z.number(), key.nullable()])).default([]),
});
export type EditsSource = z.infer<typeof editsSourceSchema>;

export type { Scenario, ScenarioRealm } from '../sim/scenario';
