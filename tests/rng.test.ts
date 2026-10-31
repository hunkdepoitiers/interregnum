import { describe, expect, it } from 'vitest';
import { createRng, nextInt, nextU32, rollBp } from '../src/sim/rng';

describe('rng', () => {
  it('is reproducible for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 100 }, () => nextU32(a));
    const ys = Array.from({ length: 100 }, () => nextU32(b));
    expect(xs).toEqual(ys);
  });

  it('differs between seeds', () => {
    expect(nextU32(createRng(1))).not.toBe(nextU32(createRng(2)));
  });

  it('resumes from a JSON round-tripped state', () => {
    const a = createRng(7);
    for (let i = 0; i < 10; i++) nextU32(a);
    const b = JSON.parse(JSON.stringify(a));
    expect(nextU32(b)).toBe(nextU32(a));
  });

  it('nextInt stays in range and covers it', () => {
    const s = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const x = nextInt(s, 6);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(6);
      seen.add(x);
    }
    expect(seen.size).toBe(6);
  });

  it('rollBp edges are exact', () => {
    const s = createRng(9);
    for (let i = 0; i < 200; i++) {
      expect(rollBp(s, 0).success).toBe(false);
      expect(rollBp(s, 10000).success).toBe(true);
    }
  });
});
