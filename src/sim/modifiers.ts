import type { Content, Effect, StatScope } from './content';
import type { GameState } from './state';

/**
 * Modifiers are the only way stats change. Every stat value is
 *   clamp((base + Σadd) × (10000 + Σpct) / 10000, min, max)
 * in fixed-point hundredths, and explain() returns the lines behind it, so every number in the UI can show where it
 * comes from. A province stat also sees the modifiers on the realm that owns the province.
 */
export interface ModifierTarget {
  kind: StatScope;
  id: number;
}

export interface Modifier {
  id: number;
  /** Key into Content.modifiers. */
  def: string;
  target: ModifierTarget;
  start: number;
  /** Day it expires on; null = until removed. */
  end: number | null;
  /** Every effect counts this many times (a ruler's skill above the pivot, say); missing = once. */
  scale?: number;
}

export interface ExplainLine {
  label: string;
  op: Effect['op'];
  value: number;
  /** Comes from the realm that owns the province, not the province itself. */
  inherited: boolean;
  modifierId: number;
}

export interface Explained {
  stat: string;
  value: number;
  base: number;
  /** Before clamping to [min, max]. */
  raw: number;
  min: number;
  max: number;
  lines: ExplainLine[];
}

const sameTarget = (a: ModifierTarget, b: ModifierTarget) => a.kind === b.kind && a.id === b.id;

/** Adds a modifier from its definition; returns null for an unknown key. */
export function addModifier(state: GameState, content: Content, def: string, target: ModifierTarget, scale?: number): Modifier | null {
  const d = content.modifiers[def];
  if (!d) return null;
  if (d.stacking === 'replace') removeModifiers(state, def, target);
  const m: Modifier = { id: state.nextModifierId++, def, target, start: state.day, end: d.days === null ? null : state.day + d.days };
  if (scale !== undefined && scale !== 1) m.scale = scale;
  state.modifiers.push(m);
  return m;
}

/** Removes every copy of a modifier from a target; returns how many there were. */
export function removeModifiers(state: GameState, def: string, target: ModifierTarget): number {
  const before = state.modifiers.length;
  state.modifiers = state.modifiers.filter((m) => !(m.def === def && sameTarget(m.target, target)));
  return before - state.modifiers.length;
}

/** Drops modifiers whose time is up; returns true if any went. */
export function expireModifiers(state: GameState): boolean {
  const before = state.modifiers.length;
  state.modifiers = state.modifiers.filter((m) => m.end === null || m.end > state.day);
  return state.modifiers.length !== before;
}

export function hasModifier(state: Pick<GameState, 'modifiers'>, def: string, target: ModifierTarget): boolean {
  return state.modifiers.some((m) => m.def === def && sameTarget(m.target, target));
}

/** Modifiers grouped by target ("province:12", "realm:3"), for many stat lookups in one pass (the monthly economy). */
export type ModifierIndex = Map<string, Modifier[]>;

const targetKey = (t: ModifierTarget) => `${t.kind}:${t.id}`;

export function indexModifiers(modifiers: Modifier[]): ModifierIndex {
  const index: ModifierIndex = new Map();
  for (const m of modifiers) {
    const k = targetKey(m.target);
    const list = index.get(k);
    if (list) list.push(m);
    else index.set(k, [m]);
  }
  return index;
}

/** What explain() reads: modifiers, owners, and per-province base values that replace a stat's own base. */
export type StatSource = Pick<GameState, 'modifiers' | 'provinces'> & { provinceBase?: Record<string, number[]> };

/** The value of a stat on a target, with every line that makes it up. */
export function explain(state: StatSource, content: Content, stat: string, target: ModifierTarget, index?: ModifierIndex): Explained {
  const s = content.stats[stat];
  if (!s) throw new Error(`Unknown stat ${stat}`);
  if (s.scope !== target.kind) throw new Error(`Stat ${stat} belongs to a ${s.scope}, not a ${target.kind}`);
  const owner = target.kind === 'province' ? state.provinces[target.id]?.owner ?? 0 : 0;
  const base = target.kind === 'province' ? state.provinceBase?.[stat]?.[target.id] ?? s.base : s.base;
  const candidates = index
    ? [...(index.get(targetKey(target)) ?? []), ...(owner ? index.get(`realm:${owner}`) ?? [] : [])]
    : state.modifiers;
  const lines: ExplainLine[] = [];
  for (const m of candidates) {
    const own = sameTarget(m.target, target);
    const inherited = !own && owner !== 0 && m.target.kind === 'realm' && m.target.id === owner;
    if (!own && !inherited) continue;
    const d = content.modifiers[m.def];
    if (!d) continue;
    for (const e of d.effects) if (e.stat === stat) lines.push({ label: d.label, op: e.op, value: e.value * (m.scale ?? 1), inherited, modifierId: m.id });
  }
  let add = 0;
  let pct = 0;
  for (const l of lines) {
    if (l.op === 'add') add += l.value;
    else pct += l.value;
  }
  const raw = Math.trunc(((base + add) * (10000 + pct)) / 10000);
  return { stat, value: Math.min(s.max, Math.max(s.min, raw)), base, raw, min: s.min, max: s.max, lines };
}

export function statValue(state: StatSource, content: Content, stat: string, target: ModifierTarget, index?: ModifierIndex): number {
  return explain(state, content, stat, target, index).value;
}
