/**
 * An id-map tile as runs of equal province ids per row: rows[y]..rows[y + 1] index into x (run start) and id.
 * Provinces are large blobs, so this takes a few MB where a full Uint16Array of a 4096 px tile takes 33 MB.
 */
export interface IdRuns {
  rows: Uint32Array;
  x: Uint16Array;
  id: Uint16Array;
}

/** Builds runs from RGBA pixels where id = R + 256 G. */
export function encodeRuns(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): IdRuns {
  const rows = new Uint32Array(h + 1);
  let xs = new Uint16Array(1 << 16);
  let ids = new Uint16Array(1 << 16);
  let n = 0;
  for (let y = 0; y < h; y++) {
    rows[y] = n;
    let prev = -1;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const id = rgba[o]! | (rgba[o + 1]! << 8);
      if (id === prev) continue;
      if (n === xs.length) {
        const grow = (a: Uint16Array) => { const b = new Uint16Array(a.length * 2); b.set(a); return b; };
        xs = grow(xs);
        ids = grow(ids);
      }
      xs[n] = x;
      ids[n] = id;
      n++;
      prev = id;
    }
  }
  rows[h] = n;
  return { rows, x: xs.slice(0, n), id: ids.slice(0, n) };
}

/** The id at (x, y) of a tile, by binary search in its row. */
export function idInRuns(r: IdRuns, x: number, y: number): number {
  let lo = r.rows[y]!;
  let hi = r.rows[y + 1]! - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.x[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return r.id[lo]!;
}
