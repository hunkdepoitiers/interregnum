import { describe, expect, it } from 'vitest';
import { encodeRuns, idInRuns } from '../src/render/id-runs';

describe('id runs', () => {
  it('round-trips every pixel of a tile', () => {
    // 5 x 3 tile, id = R + 256 G
    const ids = [1, 1, 2, 2, 2, 300, 300, 300, 1, 1, 7, 8, 9, 9, 9];
    const rgba = new Uint8Array(ids.length * 4);
    ids.forEach((id, i) => { rgba[i * 4] = id & 255; rgba[i * 4 + 1] = id >> 8; });
    const runs = encodeRuns(rgba, 5, 3);
    expect(runs.x.length).toBe(2 + 2 + 3);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) expect(idInRuns(runs, x, y)).toBe(ids[y * 5 + x]);
  });
});
