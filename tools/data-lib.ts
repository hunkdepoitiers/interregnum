import { lonLatToPixel, type MapProvince, type Projection } from '../src/content/map';
import type { Place, Scenario, ScenarioRealm, ScenarioSource } from '../src/content/scenario';

export interface CompiledScenario {
  scenario: Scenario;
  errors: string[];
  warnings: string[];
  /** Land provinces no realm owns (tribal lands and areas not mapped yet). */
  unowned: number;
}

export interface MapContext {
  projection: Projection;
  /** Town key → [lat, lon], from data/map/seeds*.yaml. */
  towns: Map<string, [number, number]>;
  /** Province id at a map pixel, when the id map is at hand; otherwise places resolve by province boxes. */
  idAt?: (x: number, y: number) => number;
  /** Realms from this index on come from the map editor; like its overrides, they win over earlier realms. */
  editedFrom?: number;
}

/** Below this RGB distance two bordering realms are hard to tell apart on the political map. */
const MIN_NEIGHBOUR_COLOR_DISTANCE = 40;
/** A place this many pixels (~1.4 km each) or more from any land province centre is reported as off the map's land. */
const MAX_PLACE_DISTANCE = 60;

type Pt = [number, number];

function insidePolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Paints realm outlines onto land provinces, resolves places and keys to ids, and checks the result. */
export function compileScenario(src: ScenarioSource, provinces: MapProvince[], ctx: MapContext): CompiledScenario {
  const errors: string[] = [];
  const warnings: string[] = [];
  const land = provinces.filter((p) => p.kind === 'land');
  const maxId = provinces.reduce((m, p) => Math.max(m, p.id), 0);
  const owner = new Array<number>(maxId + 1).fill(0);
  const realmId = new Map<string, number>();
  const byId = new Map(provinces.map((p) => [p.id, p]));
  const toPixel = ([lat, lon]: Pt): Pt => lonLatToPixel(ctx.projection, lon, lat);

  src.realms.forEach((r, i) => {
    if (realmId.has(r.key)) errors.push(`Realm ${r.key}: duplicate key`);
    realmId.set(r.key, i + 1);
  });

  // The land province at a place: the one under it, else (water, mountains, no id map) among those whose box holds
  // the point the one with the nearest centre.
  const provinceAt = (place: Place, where: string): MapProvince | null => {
    let latLon: Pt | undefined;
    if (typeof place === 'string') {
      latLon = ctx.towns.get(place);
      if (!latLon) { errors.push(`${where}: unknown town ${place}`); return null; }
    } else latLon = place;
    const [x, y] = toPixel(latLon);
    const hit = ctx.idAt ? byId.get(ctx.idAt(Math.floor(x), Math.floor(y))) : undefined;
    if (hit?.kind === 'land') return hit;
    let best: MapProvince | null = null;
    let bestD = Infinity;
    let bestInBox = false;
    for (const p of land) {
      const [x0, y0, x1, y1] = p.bbox;
      const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const d = Math.hypot(p.centroid[0] - x, p.centroid[1] - y);
      if ((inBox && !bestInBox) || (inBox === bestInBox && d < bestD)) { best = p; bestD = d; bestInBox = inBox; }
    }
    if (!best || (!bestInBox && bestD > MAX_PLACE_DISTANCE)) {
      errors.push(`${where}: ${JSON.stringify(place)} is not on land`);
      return null;
    }
    return best;
  };

  // Outlines, in file order: a later realm paints over an earlier one.
  src.realms.forEach((r, i) => {
    for (const outline of r.area) {
      const poly = outline.map(toPixel);
      const xs = poly.map((q) => q[0]);
      const ys = poly.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      for (const p of land) {
        const c = p.centroid as Pt;
        if (c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1 && insidePolygon(c, poly)) owner[p.id] = i + 1;
      }
    }
  });

  // Capitals and single provinces override outlines; two realms may not both name the same province.
  const named = new Map<number, number>();
  const realms: ScenarioRealm[] = src.realms.map((r, i) => {
    const id = i + 1;
    const take = (place: Place, what: string) => {
      const p = provinceAt(place, `Realm ${r.key} ${what}`);
      if (!p) return null;
      const prev = named.get(p.id);
      if (prev && prev !== id && i < (ctx.editedFrom ?? Infinity)) errors.push(`Province ${p.key} is named by both ${src.realms[prev - 1]!.key} and ${r.key}`);
      named.set(p.id, id);
      owner[p.id] = id;
      return p;
    };
    for (const place of r.add) take(place, `add ${JSON.stringify(place)}`);
    const capital = take(r.capital, 'capital');
    let overlord = 0;
    if (r.overlord) {
      overlord = realmId.get(r.overlord) ?? 0;
      if (!overlord) errors.push(`Realm ${r.key}: unknown overlord ${r.overlord}`);
      if (r.overlord === r.key) errors.push(`Realm ${r.key}: cannot be its own overlord`);
    }
    return {
      id, key: r.key, name: r.name, rank: r.rank, government: r.government, color: r.color.toLowerCase(),
      capital: capital?.id ?? 0, overlord, scripted: r.scripted,
    };
  });

  // Gaps inside a fill outline go to the nearest realm over land, breadth-first from every owned province.
  const fills = src.fill.map((o) => o.map(toPixel));
  const fillable = new Set(land.filter((p) => !owner[p.id] && fills.some((f) => insidePolygon(p.centroid as Pt, f))).map((p) => p.id));
  for (let frontier = land.filter((p) => owner[p.id]); frontier.length && fillable.size;) {
    const next: MapProvince[] = [];
    for (const p of frontier) {
      for (const n of p.adjacency) {
        if (!n.border || !fillable.has(n.id)) continue;
        fillable.delete(n.id);
        owner[n.id] = owner[p.id]!;
        next.push(byId.get(n.id)!);
      }
    }
    frontier = next;
  }

  const countOwned = () => {
    const c = new Array<number>(realms.length + 1).fill(0);
    for (const p of land) c[owner[p.id]!]!++;
    return c;
  };
  const before = countOwned();
  for (const r of realms) if (!before[r.id]) errors.push(`Realm ${r.key} owns no provinces`);

  // Hand edits from the map editor come last and override everything; null leaves a province unowned.
  for (const [lat, lon, realmKey] of src.overrides) {
    const p = provinceAt([lat, lon], `override ${JSON.stringify([lat, lon, realmKey])}`);
    const id = realmKey === null ? 0 : realmId.get(realmKey);
    if (id === undefined) errors.push(`override: unknown realm ${realmKey}`);
    else if (p) owner[p.id] = id;
  }
  // A realm the edits painted over completely is left out, and ids close up behind it.
  const after = countOwned();
  const newId = new Array<number>(realms.length + 1).fill(0);
  const kept = realms.filter((r) => {
    if (before[r.id] && !after[r.id]) warnings.push(`Realm ${r.key} lost all its land to edits and is left out`);
    return !before[r.id] || after[r.id];
  });
  kept.forEach((r, i) => (newId[r.id] = i + 1));
  if (kept.length < realms.length) {
    for (let i = 0; i < owner.length; i++) owner[i] = newId[owner[i]!]!;
    realms.splice(0, realms.length, ...kept.map((r) => ({ ...r, id: newId[r.id]!, overlord: newId[r.overlord]! })));
    realmId.clear();
    for (const r of realms) realmId.set(r.key, r.id);
  }
  const counts = countOwned();

  // Overlord chains must end; a cycle would make "top liege" undefined.
  for (const r of realms) {
    const seen = new Set<number>();
    for (let cur = r; cur.overlord; cur = realms[cur.overlord - 1]!) {
      if (seen.has(cur.id)) { errors.push(`Realm ${r.key}: overlord chain loops`); break; }
      seen.add(cur.id);
    }
  }

  const controller = [...owner];
  for (const [place, realmKey] of src.occupations) {
    const p = provinceAt(place, 'occupations');
    const id = realmId.get(realmKey);
    if (!id) errors.push(`occupations: unknown realm ${realmKey}`);
    if (!p || !id) continue;
    if (!owner[p.id]) errors.push(`occupations: ${p.key} has no owner to be occupied from`);
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

  return { scenario: { realms, owner, controller }, errors, warnings, unowned: counts[0]! };
}
