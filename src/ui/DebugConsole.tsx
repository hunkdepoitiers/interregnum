import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { command, world } from '../bridge/client';
import { explain, type ModifierTarget } from '../sim/modifiers';
import type { ProvinceState } from '../sim/state';
import { mapData, selected, selectedRealm, selectProvince, selectRealm } from './App';
import { content, formatStat } from './StatList';

/** Debug console (key C or `): add and remove modifiers and read stat breakdowns, to test the modifier system. */
export const consoleOpen = signal(false);

const HELP = [
  'add <modifier> [target]      put a modifier on a province or realm',
  'remove <modifier> [target]   take every copy of it off',
  'list [target]                modifiers on the target',
  'stat <stat> [target]         a stat with its breakdown',
  'go <target>                  select it and centre the map on it',
  'modifiers | stats            what exists',
  'target: a realm or province key, realm:<key>, province:<key>; default = what the panel shows',
];

function resolveTarget(word: string | undefined): ModifierTarget | string {
  const w = world.value;
  const map = mapData.value;
  if (!w || !map) return 'the game has not started';
  if (!word) {
    if (selectedRealm.value) return { kind: 'realm', id: selectedRealm.value };
    if (selected.value) return { kind: 'province', id: selected.value };
    return 'no target: select a province or realm, or name one';
  }
  const [prefix, rest] = word.includes(':') ? word.split(':', 2) as [string, string] : ['', word];
  const realm = w.realms.findIndex((r) => r?.key === rest);
  const province = map.provinces.find((p) => p.key === rest)?.id ?? 0;
  if (prefix !== 'province' && realm > 0) return { kind: 'realm', id: realm };
  if (prefix !== 'realm' && province) return { kind: 'province', id: province };
  return `no ${prefix || 'realm or province'} called ${rest}`;
}

function targetName(t: ModifierTarget): string {
  return t.kind === 'realm' ? world.value?.realms[t.id]?.name ?? `realm ${t.id}` : mapData.value?.provinces.find((p) => p.id === t.id)?.name ?? `province ${t.id}`;
}

function runLine(line: string): string[] {
  const c = content.value;
  const w = world.value;
  if (!c || !w) return ['the game has not started'];
  const [verb, a, b] = line.trim().split(/\s+/);
  switch (verb) {
    case undefined: case '': return [];
    case 'help': return HELP;
    case 'modifiers': return Object.values(c.modifiers).map((m) => `${m.key}: ${m.label}${m.days ? ` (${m.days} days)` : ''}`);
    case 'stats': return Object.values(c.stats).map((s) => `${s.key} (${s.scope}): ${s.label}`);
    case 'add': case 'remove': {
      if (!a || !c.modifiers[a]) return [`unknown modifier ${a ?? ''}; try "modifiers"`];
      const t = resolveTarget(b);
      if (typeof t === 'string') return [t];
      const d = c.modifiers[a]!;
      if (verb === 'add' && t.kind === 'province' && d.effects.some((e) => c.stats[e.stat]?.scope === 'realm')) {
        return [`${a} has realm effects; put it on a realm`];
      }
      command(verb === 'add' ? { type: 'addModifier', def: a, target: t } : { type: 'removeModifier', def: a, target: t });
      return [`${verb === 'add' ? 'added' : 'removed'} ${d.label} ${verb === 'add' ? 'to' : 'from'} ${targetName(t)}`];
    }
    case 'go': {
      const t = resolveTarget(a);
      if (typeof t === 'string') return [t];
      if (t.kind === 'realm') selectRealm(t.id, true);
      else selectProvince(t.id, true);
      return [`showing ${targetName(t)}`];
    }
        case 'list': {
      const t = resolveTarget(a);
      if (typeof t === 'string') return [t];
      const mine = w.modifiers.filter((m) => m.target.kind === t.kind && m.target.id === t.id);
      return mine.length ? mine.map((m) => `${m.def}${m.end !== null ? ` until day ${m.end}` : ''}`) : [`${targetName(t)} has no modifiers`];
    }
    case 'stat': {
      const def = a ? c.stats[a] : undefined;
      if (!def) return [`unknown stat ${a ?? ''}; try "stats"`];
      const t = resolveTarget(b);
      if (typeof t === 'string') return [t];
      if (t.kind !== def.scope) return [`${a} is a ${def.scope} stat`];
      const provinces: ProvinceState[] = [];
      if (t.kind === 'province') provinces[t.id] = { id: t.id, owner: w.owner[t.id] ?? 0, controller: 0 };
      const e = explain({ modifiers: w.modifiers, provinces }, c, a!, t);
      return [`${def.label} of ${targetName(t)}: ${formatStat(def, e.value)}`, `  base ${formatStat(def, e.base)}`,
        ...e.lines.map((l) => `  ${l.label}${l.inherited ? ' (realm)' : ''}: ${l.op === 'pct' ? `${l.value / 100}%` : l.value / 100}`)];
    }
    default: return [`unknown command ${verb}; try "help"`];
  }
}

export function DebugConsole() {
  const [log, setLog] = useState<string[]>(['Interregnum debug console. Type "help".']);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (consoleOpen.value) input.current?.focus(); }, [consoleOpen.value]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [log]);
  if (!consoleOpen.value) return null;
  return (
    <section class="debug-console panel" aria-label="Debug console">
      <div class="console-log">
        {log.map((l, i) => <div key={i}>{l}</div>)}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setLog([...log, `> ${text}`, ...runLine(text)].slice(-200)); setText(''); }}>
        <input
          ref={input}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') consoleOpen.value = false; }}
          placeholder="help"
          spellcheck={false}
          autocomplete="off"
        />
      </form>
    </section>
  );
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '`' || e.key.toLowerCase() === 'c') {
    e.preventDefault();
    consoleOpen.value = !consoleOpen.value;
  }
});
