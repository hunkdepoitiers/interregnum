/** sfc32 PRNG. State is four uint32 words so it serialises into the save as plain numbers. */
export type RngState = [number, number, number, number];

export function createRng(seed: number): RngState {
  const s: RngState = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  // Warm-up so nearby seeds diverge.
  for (let i = 0; i < 15; i++) nextU32(s);
  return s;
}

/** Advances the state in place and returns a uint32. */
export function nextU32(s: RngState): number {
  const t = (((s[0] + s[1]) | 0) + s[3]) | 0;
  s[3] = (s[3] + 1) | 0;
  s[0] = s[1] ^ (s[1] >>> 9);
  s[1] = (s[2] + (s[2] << 3)) | 0;
  s[2] = (s[2] << 21) | (s[2] >>> 11);
  s[2] = (s[2] + t) | 0;
  return t >>> 0;
}

/** Uniform integer in [0, n). n must be a positive integer below 2^32. */
export function nextInt(s: RngState, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`nextInt: bad bound ${n}`);
  // Rejection sampling avoids modulo bias.
  const limit = 0x100000000 - (0x100000000 % n);
  let x = nextU32(s);
  while (x >= limit) x = nextU32(s);
  return x % n;
}

/** Odds are expressed in basis points (0..10000) so they stay integers and can be shown exactly. */
export interface Roll {
  chanceBp: number;
  rolledBp: number;
  success: boolean;
}

export function rollBp(s: RngState, chanceBp: number): Roll {
  const rolledBp = nextInt(s, 10000);
  return { chanceBp, rolledBp, success: rolledBp < chanceBp };
}
