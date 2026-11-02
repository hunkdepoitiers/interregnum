import { describe, expect, it } from 'vitest';
import { simplify } from '../src/render/map-view';

describe('simplify', () => {
  it('drops points that lie within the tolerance and keeps corners and ends', () => {
    const line = [0, 0, 1, 0.1, 2, 0, 3, 5, 4, 0];
    expect(simplify(line, 0.5)).toEqual([0, 0, 2, 0, 3, 5, 4, 0]);
    expect(simplify(line, 10)).toEqual([0, 0, 4, 0]);
  });

  it('leaves two-point lines alone', () => {
    expect(simplify([1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4]);
  });
});
