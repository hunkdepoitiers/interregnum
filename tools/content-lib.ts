import type { ConditionSource, ModifiersSource, StatsSource } from '../src/content/content';
import { emptyEconomy, SCALE, type Content, type ModifierDef, type StatDef } from '../src/sim/content';
import type { Action, Condition } from '../src/sim/script';

const fixed = (v: number) => Math.round(v * SCALE);

/** Checks stats and modifiers against each other and converts their numbers to fixed-point hundredths. */
export function compileContent(stats: StatsSource, modifiers: ModifiersSource): { content: Content; errors: string[] } {
  const errors: string[] = [];
  const content: Content = {
    stats: {}, modifiers: {}, cultures: [], religions: [],
    titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] }, goods: [], economy: emptyEconomy(),
  };
  for (const scope of ['province', 'realm'] as const) {
    for (const s of stats[scope]) {
      if (content.stats[s.key]) errors.push(`Stat ${s.key}: duplicate key`);
      if (s.min > s.max) errors.push(`Stat ${s.key}: min is above max`);
      if (s.base < s.min || s.base > s.max) errors.push(`Stat ${s.key}: base is outside min..max`);
      const def: StatDef = { ...s, scope, base: fixed(s.base), min: fixed(s.min), max: fixed(s.max) };
      content.stats[s.key] = def;
    }
  }
  for (const m of modifiers) {
    if (content.modifiers[m.key]) errors.push(`Modifier ${m.key}: duplicate key`);
    const def: ModifierDef = {
      key: m.key, label: m.label, description: m.description, stacking: m.stacking, days: m.days ?? null,
      effects: m.effects.map((e) => {
        if (!content.stats[e.stat]) errors.push(`Modifier ${m.key}: unknown stat ${e.stat}`);
        return 'add' in e ? { stat: e.stat, op: 'add' as const, value: fixed(e.add) } : { stat: e.stat, op: 'pct' as const, value: fixed(e.pct) };
      }),
    };
    content.modifiers[m.key] = def;
  }
  return { content, errors };
}

/** A condition from YAML in the sim's form: stat thresholds in hundredths, keys checked against the content. */
export function compileCondition(c: ConditionSource, content: Content, errors: string[], where: string): Condition {
  const sub = (x: ConditionSource) => compileCondition(x, content, errors, where);
  const stat = (t: { stat: string; value: number }) => {
    if (!content.stats[t.stat]) errors.push(`${where}: unknown stat ${t.stat}`);
    return { stat: t.stat, value: fixed(t.value) };
  };
  if ('all' in c) return { all: c.all.map(sub) };
  if ('any' in c) return { any: c.any.map(sub) };
  if ('not' in c) return { not: sub(c.not) };
  if ('has_modifier' in c) {
    if (!content.modifiers[c.has_modifier]) errors.push(`${where}: unknown modifier ${c.has_modifier}`);
    return c;
  }
  if ('stat_at_least' in c) return { stat_at_least: stat(c.stat_at_least) };
  if ('stat_below' in c) return { stat_below: stat(c.stat_below) };
  return { owner: sub(c.owner) };
}

/** Checks the modifier keys an action list uses. */
export function checkActions(actions: Action[], content: Content, errors: string[], where: string): void {
  for (const a of actions) {
    const k = 'add_modifier' in a ? a.add_modifier : 'remove_modifier' in a ? a.remove_modifier : null;
    if (k !== null && !content.modifiers[k]) errors.push(`${where}: unknown modifier ${k}`);
    if ('owner' in a) checkActions(a.owner, content, errors, where);
  }
}
