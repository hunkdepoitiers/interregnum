import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { status, world } from '../bridge/client';
import { SCALE, type Content, type StatDef, type StatScope } from '../sim/content';
import { explain, type Explained, type ModifierTarget } from '../sim/modifiers';
import type { ProvinceState } from '../sim/state';

/** Stats and modifier definitions (public/generated/content.json); null until loaded. */
export const content = signal<Content | null>(null);

/** A fixed-point stat value in its display format. */
export function formatStat(def: StatDef, v: number): string {
  const n = v / SCALE;
  if (def.format === 'percent') return `${round1(n)}%`;
  if (def.format === 'integer') return String(Math.round(n));
  if (def.format === 'gold') return `${n.toFixed(2)} ducats`;
  return round1(n);
}

function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** One breakdown line: "+10", "−2.5", "+10%" (pct effects multiply). */
function formatLine(def: StatDef, op: 'add' | 'pct', v: number): string {
  const n = v / SCALE;
  const sign = n < 0 ? '−' : '+';
  const abs = Math.abs(n);
  if (op === 'pct') return `${sign}${round1(abs)}%`;
  return `${sign}${round1(abs)}${def.format === 'percent' ? ' pts' : ''}`;
}

/** Explains a stat against the world the UI has (modifiers and owners from the worker). */
function explainHere(c: Content, stat: string, target: ModifierTarget): Explained | null {
  const w = world.value;
  if (!w) return null;
  const provinces: ProvinceState[] = [];
  if (target.kind === 'province') provinces[target.id] = { id: target.id, owner: w.owner[target.id] ?? 0, controller: 0 };
  return explain({ modifiers: w.modifiers, provinces }, c, stat, target);
}

/** The breakdown shown when hovering a stat: base, every modifier line, and any cap that applied. */
function Breakdown({ def, e, at }: { def: StatDef; e: Explained; at: { left: number; top: number } }) {
  return (
    <div class="stat-tip" role="tooltip" style={{ left: `${at.left}px`, top: `${at.top}px` }}>
      <div class="stat-tip-head">
        <strong>{def.label}</strong>
        <strong>{formatStat(def, e.value)}</strong>
      </div>
      {def.description && <p class="stat-tip-desc">{def.description}</p>}
      <table>
        <tbody>
          <tr><td>Base</td><td>{formatStat(def, e.base)}</td></tr>
          {e.lines.map((l) => (
            <tr key={`${l.modifierId}-${l.op}`}>
              <td>{l.label}{l.inherited && <span class="muted"> (realm)</span>}</td>
              <td class={l.value < 0 ? 'neg' : 'pos'}>{formatLine(def, l.op, l.value)}</td>
            </tr>
          ))}
          {e.raw !== e.value && (
            <tr><td class="muted">{e.raw > e.value ? 'Capped at maximum' : 'Held at minimum'}</td><td>{formatStat(def, e.value)}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Every stat of a province or realm, each with its breakdown on hover or focus. */
export function StatList({ scope, id }: { scope: StatScope; id: number }) {
  // Placed beside the panel in window coordinates: the panel scrolls, which would clip a tooltip inside it.
  const [open, setOpen] = useState<{ key: string; left: number; top: number } | null>(null);
  const show = (key: string, el: HTMLElement) => {
    const row = el.getBoundingClientRect();
    const panel = el.closest('.panel')?.getBoundingClientRect() ?? row;
    const wide = window.innerWidth > 700;
    setOpen({ key, left: wide ? panel.right + 10 : panel.left, top: wide ? Math.min(row.top - 6, window.innerHeight - 260) : row.bottom + 4 });
  };
  const c = content.value;
  if (!c || !world.value) return null;
  const target: ModifierTarget = { kind: scope, id };
  const defs = Object.values(c.stats).filter((s) => s.scope === scope);
  return (
    <dl class="stats">
      {defs.map((def) => {
        const e = explainHere(c, def.key, target);
        if (!e) return null;
        return (
          <div
            key={def.key}
            class="stat-row"
            tabIndex={0}
            onMouseEnter={(ev) => show(def.key, ev.currentTarget)}
            onMouseLeave={() => setOpen(null)}
            onFocus={(ev) => show(def.key, ev.currentTarget)}
            onBlur={() => setOpen(null)}
          >
            <dt>{def.label}</dt>
            <dd class={e.lines.length ? 'modified' : ''}>{formatStat(def, e.value)}</dd>
            {open?.key === def.key && <Breakdown def={def} e={e} at={open} />}
          </div>
        );
      })}
    </dl>
  );
}

/** Modifiers sitting on a province or realm, with the time left. */
export function ModifierList({ scope, id }: { scope: StatScope; id: number }) {
  const c = content.value;
  const w = world.value;
  if (!c || !w) return null;
  const mine = w.modifiers.filter((m) => m.target.kind === scope && m.target.id === id);
  if (!mine.length) return null;
  const today = status.value.day;
  return (
    <>
      <h3>Modifiers</h3>
      <ul class="plain modifiers">
        {mine.map((m) => {
          const d = c.modifiers[m.def];
          return (
            <li key={m.id} title={d?.description}>
              {d?.label ?? m.def}
              {m.end !== null && <span class="muted"> · {m.end - today} days left</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
