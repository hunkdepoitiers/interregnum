import type { MapProvince } from '../src/content/map';
import type { Scenario, ScenarioRealm, ScenarioSource } from '../src/content/scenario';

export interface CompiledScenario {
  scenario: Scenario;
  errors: string[];
  warnings: string[];
}

/** Below this RGB distance two bordering realms are hard to tell apart on the political map. */
const MIN_NEIGHBOUR_COLOR_DISTANCE = 40;

/** Resolves keys to ids and checks that the scenario is consistent with the map. */
export function compileScenario(src: ScenarioSource, provinces: MapProvince[]): CompiledScenario {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byKey = new Map(provinces.map((p) => [p.key, p]));
  const maxId = provinces.reduce((m, p) => Math.max(m, p.id), 0);
  const owner = new Array<number>(maxId + 1).fill(0);
  const realmId = new Map<string, number>();

  src.realms.forEach((r, i) => {
    if (realmId.has(r.key)) errors.push(`Realm ${r.key}: duplicate key`);
    realmId.set(r.key, i + 1);
  });

  const landProvince = (k: string, where: string) => {
    const p = byKey.get(k);
    if (!p) { errors.push(`${where}: unknown province ${k}`); return null; }
    if (p.kind !== 'land') { errors.push(`${where}: ${k} is ${p.kind}, only land can be owned`); return null; }
    return p;
  };

  const realms: ScenarioRealm[] = src.realms.map((r, i) => {
    const id = i + 1;
    for (const k of r.provinces) {
      const p = landProvince(k, `Realm ${r.key}`);
      if (!p) continue;
      const prev = owner[p.id]!;
      if (prev) errors.push(`Province ${k} is owned by both ${src.realms[prev - 1]!.key} and ${r.key}`);
      else owner[p.id] = id;
    }
    if (!r.provinces.includes(r.capital)) errors.push(`Realm ${r.key}: capital ${r.capital} is not one of its provinces`);
    let overlord = 0;
    if (r.overlord) {
      overlord = realmId.get(r.overlord) ?? 0;
      if (!overlord) errors.push(`Realm ${r.key}: unknown overlord ${r.overlord}`);
      if (r.overlord === r.key) errors.push(`Realm ${r.key}: cannot be its own overlord`);
    }
    return {
      id, key: r.key, name: r.name, rank: r.rank, government: r.government, color: r.color.toLowerCase(),
      capital: byKey.get(r.capital)?.id ?? 0, overlord, scripted: r.scripted,
    };
  });

  // Overlord chains must end; a cycle would make "top liege" undefined.
  for (const r of realms) {
    const seen = new Set<number>();
    for (let cur = r; cur.overlord; cur = realms[cur.overlord - 1]!) {
      if (seen.has(cur.id)) { errors.push(`Realm ${r.key}: overlord chain loops`); break; }
      seen.add(cur.id);
    }
  }

  const unclaimed = new Set<number>();
  for (const k of src.unclaimed) {
    const p = landProvince(k, 'unclaimed');
    if (!p) continue;
    if (owner[p.id]) errors.push(`Province ${k} is listed as unclaimed but owned by ${src.realms[owner[p.id]! - 1]!.key}`);
    unclaimed.add(p.id);
  }
  for (const p of provinces) {
    if (p.kind === 'land' && !owner[p.id] && !unclaimed.has(p.id)) errors.push(`Land province ${p.key} has no owner (list it under unclaimed if intended)`);
  }

  const controller = [...owner];
  for (const [k, realmKey] of Object.entries(src.occupations)) {
    const p = landProvince(k, 'occupations');
    const id = realmId.get(realmKey);
    if (!id) errors.push(`occupations: unknown realm ${realmKey}`);
    if (!p || !id) continue;
    if (!owner[p.id]) errors.push(`occupations: ${k} has no owner to be occupied from`);
    controller[p.id] = id;
  }

  // Warn when bordering realms have nearly the same colour.
  const rgb = realms.map((r) => { const c = parseInt(r.color.slice(1), 16); return [c >> 16, (c >> 8) & 255, c & 255]; });
  const reported = new Set<string>();
  for (const p of provinces) {
    const a = owner[p.id]!;
    if (!a) continue;
    for (const n of p.adjacency) {
      const b = owner[n.id] ?? 0;
      if (!b || b === a || n.border === 0) continue;
      const pair = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (reported.has(pair)) continue;
      reported.add(pair);
      const [x, y] = [rgb[a - 1]!, rgb[b - 1]!];
      const dist = Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
      if (dist < MIN_NEIGHBOUR_COLOR_DISTANCE) {
        warnings.push(`Neighbouring realms ${realms[a - 1]!.key} and ${realms[b - 1]!.key} have similar colours (distance ${Math.round(dist)})`);
      }
    }
  }

  return { scenario: { realms, owner, controller }, errors, warnings };
}
