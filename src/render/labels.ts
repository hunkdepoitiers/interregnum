import type { MapData } from '../content/map';
import type { WorldView } from '../worker/protocol';

/** A realm name laid across its land, in map pixels; angle in radians. */
export interface RealmLabel {
  realm: number;
  text: string;
  x: number;
  y: number;
  angle: number;
  /** Font size in map pixels. */
  size: number;
}

/** "Kingdom of Castile" → "Castile", "Beylik of the Ottomans" → "Ottomans"; names without a title stay as they are. */
export function shortName(name: string): string {
  const m = /^\S+(?: \S+)? of (?:the )?(.+)$/.exec(name);
  return m ? m[1]! : name;
}

/** Widest letter advance as a share of the font size, for small caps with the label's letter spacing. */
const CHAR_WIDTH = 0.8;

/**
 * One label per realm, over the largest connected piece of its land: centred on it, turned along its long axis
 * (from the spread of its provinces) and sized to fit its length and width.
 */
export function computeLabels(map: MapData, world: WorldView): RealmLabel[] {
  const byId = new Map(map.provinces.map((p) => [p.id, p]));
  const pieces = new Map<number, number[][]>(); // realm → connected groups of province ids
  const seen = new Set<number>();
  for (const p of map.provinces) {
    const realm = world.owner[p.id] ?? 0;
    if (p.kind !== 'land' || !realm || seen.has(p.id)) continue;
    const group: number[] = [];
    const stack = [p.id];
    seen.add(p.id);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const n of byId.get(id)!.adjacency) {
        if (n.border > 0 && !seen.has(n.id) && world.owner[n.id] === realm) {
          seen.add(n.id);
          stack.push(n.id);
        }
      }
    }
    if (!pieces.has(realm)) pieces.set(realm, []);
    pieces.get(realm)!.push(group);
  }

  const labels: RealmLabel[] = [];
  for (const [realm, groups] of pieces) {
    const r = world.realms[realm];
    if (!r) continue;
    const area = (g: number[]) => g.reduce((s, id) => s + byId.get(id)!.pixels, 0);
    const group = groups.reduce((a, b) => (area(b) > area(a) ? b : a));
    // Weighted mean and covariance of the land, treating each province as its box spread around its centre.
    let w = 0, mx = 0, my = 0;
    for (const id of group) {
      const p = byId.get(id)!;
      w += p.pixels; mx += p.centroid[0] * p.pixels; my += p.centroid[1] * p.pixels;
    }
    mx /= w; my /= w;
    let sxx = 0, syy = 0, sxy = 0;
    for (const id of group) {
      const p = byId.get(id)!;
      const [x0, y0, x1, y1] = p.bbox;
      const dx = p.centroid[0] - mx, dy = p.centroid[1] - my;
      sxx += p.pixels * (dx * dx + ((x1 - x0) ** 2) / 24);
      syy += p.pixels * (dy * dy + ((y1 - y0) ** 2) / 24);
      sxy += p.pixels * dx * dy;
    }
    sxx /= w; syy /= w; sxy /= w;
    const tr = (sxx + syy) / 2;
    const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
    const length = 3.4 * Math.sqrt(tr + det);
    const width = 3.4 * Math.sqrt(Math.max(tr - det, 0));
    let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Keep text readable: never steeper than 35 degrees, never upside down.
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    angle = Math.max(-0.6, Math.min(0.6, angle));
    const text = shortName(r.name).toUpperCase();
    const size = Math.min(width * 0.45, (length * 0.85) / (text.length * CHAR_WIDTH));
    labels.push({ realm, text, x: mx, y: my, angle, size });
  }
  return labels;
}
