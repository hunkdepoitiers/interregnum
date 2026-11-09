import type { EventsSource } from '../src/content/events';
import type { MapProvince } from '../src/content/map';
import { pixelToLonLat } from '../src/content/map';
import { dateToDay } from '../src/sim/calendar';
import type { Content, EventsDef } from '../src/sim/content';
import type { ScenarioRealm } from '../src/sim/scenario';
import { checkActions, compileCondition } from './content-lib';
import { placeFinder, type MapContext } from './data-lib';

/** Converts data/content/events.yaml: dates to days, places and regions to provinces; checks every key it names. */
export function compileEvents(src: EventsSource, content: Content, realms: ScenarioRealm[], provinces: MapProvince[], ctx: MapContext): { events: EventsDef; errors: string[] } {
  const errors: string[] = [];
  const realmKeys = new Set(realms.map((r) => r.key));
  const land = provinces.filter((p) => p.kind === 'land');
  const find = placeFinder(land, new Map(provinces.map((p) => [p.id, p])), ctx, errors);
  const places: Record<string, number> = {};
  for (const [k, ll] of Object.entries(src.places)) places[k] = find(ll, `events.yaml place ${k}`)?.id ?? 0;
  const regions: Record<string, number[]> = {};
  for (const [k, [s, w, n, e]] of Object.entries(src.regions)) {
    regions[k] = land.filter((p) => {
      const [lon, lat] = pixelToLonLat(ctx.projection, p.centroid[0], p.centroid[1]);
      return lat >= s && lat <= n && lon >= w && lon <= e;
    }).map((p) => p.id);
  }
  const events: EventsDef = { places, regions, list: [] };
  const seen = new Set<string>();
  const cond = (c: Parameters<typeof compileCondition>[0], where: string) => compileCondition(c, content, errors, where);
  for (const ev of src.events) {
    const where = `events.yaml ${ev.key}`;
    if (seen.has(ev.key)) errors.push(`${where}: duplicate key`);
    seen.add(ev.key);
    if ([ev.date, ev.pulse, ev.on].filter((x) => x !== undefined).length !== 1) errors.push(`${where}: needs exactly one of date, pulse, on`);
    if (ev.date && !ev.realm && !ev.all) errors.push(`${where}: a dated event needs realm or all`);
    if (ev.realm && !realmKeys.has(ev.realm)) errors.push(`${where}: unknown realm ${ev.realm}`);
    const check = (a: Parameters<typeof checkActions>[0], w: string) => checkActions(a, content, errors, w, events, realmKeys);
    events.list.push({
      key: ev.key, title: ev.title, text: ev.text, day: ev.date ? dateToDay({ year: ev.date[0], month: ev.date[1], day: ev.date[2] }) : null,
      realm: ev.realm ?? null, all: ev.all, pulse: ev.pulse ?? null, on: ev.on ?? null, chance: ev.chance, cooldown: ev.cooldown,
      when: ev.when ? cond(ev.when, where) : null,
      options: ev.options.map((o) => {
        check(o.actions, `${where} ${o.key}`);
        if (o.odds) { check(o.odds.success.actions, `${where} ${o.key} success`); check(o.odds.failure.actions, `${where} ${o.key} failure`); }
        return {
          key: o.key, label: o.label, ai: o.ai, when: o.when ? cond(o.when, where) : null, actions: o.actions,
          odds: o.odds ? { chance: o.odds.chance, skill: o.odds.skill ?? null, perPoint: o.odds.per_point, success: o.odds.success, failure: o.odds.failure } : null,
        };
      }),
    });
  }
  return { events, errors };
}
