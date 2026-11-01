import { computed, signal } from '@preact/signals';
import { command, world } from '../bridge/client';
import { lonLatToPixel, pixelToLonLat } from '../content/map';
import type { EditsSource } from '../content/scenario';
import type { Government, Rank } from '../sim/scenario';
import { currentView, mapData, showToast } from './App';

/**
 * In-game map editor: paint provinces onto realms, add realms, and export everything as
 * data/scenario/1314-edits.yaml. Edits are stored by a map point inside each province (as lat/lon in the file),
 * so they survive regenerating the province map. Unsaved work is kept in this browser until exported or discarded.
 */
export const editing = signal(false);
/** Realm id the brush paints with; 0 = unowned. */
export const brush = signal(0);

interface Edit { x: number; y: number; realm: string | null }
interface NewRealm { key: string; name: string; rank: Rank; government: Government; color: string; capital: [number, number] | null }

/** Provinces changed in this browser since the last export, by province id. */
export const sessionEdits = signal(new Map<number, Edit>());
export const newRealms = signal<NewRealm[]>([]);
/** Edits already in data/scenario/1314-edits.yaml (public/generated/scenario-edits.json); exports build on them. */
let baseEdits: EditsSource = { realms: [], overrides: [] };

const STORE = 'interregnum-map-edits';
const byId = computed(() => new Map((mapData.value?.provinces ?? []).map((p) => [p.id, p])));

export function setBaseEdits(edits: EditsSource) {
  baseEdits = edits;
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ edits: [...sessionEdits.value.values()], newRealms: newRealms.value }));
  } catch { /* storage unavailable: edits live until the page closes */ }
}

/** Replays edits saved in this browser onto a freshly started game. */
export function restoreEdits() {
  let saved: { edits: Edit[]; newRealms: NewRealm[] } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  } catch { /* ignore unreadable storage */ }
  const w = world.value;
  const view = currentView();
  if (!saved || !w || !view) return;
  const ids = new Map(w.realms.filter((r) => r).map((r) => [r!.key, r!.id]));
  saved.newRealms.forEach((r, i) => {
    command({ type: 'addRealm', realm: { ...r, capital: 0, overlord: 0, scripted: false } });
    ids.set(r.key, w.realms.length + i);
  });
  const edits = new Map<number, Edit>();
  for (const e of saved.edits) {
    const id = view.idAtPixel(e.x, e.y);
    const realm = e.realm === null ? 0 : ids.get(e.realm);
    if (!id || realm === undefined) continue;
    command({ type: 'setOwner', province: id, realm });
    edits.set(id, e);
  }
  newRealms.value = saved.newRealms;
  sessionEdits.value = edits;
  if (edits.size) showToast(`Restored ${edits.size} unsaved map edit${edits.size === 1 ? '' : 's'}`);
}

export function paint(id: number, x: number, y: number, how: 'paint' | 'erase' | 'pick') {
  const w = world.value;
  const p = byId.value.get(id);
  if (!w || !p || p.kind !== 'land') return;
  if (how === 'pick') {
    brush.value = w.owner[id] ?? 0;
    return;
  }
  const realm = how === 'erase' ? 0 : brush.value;
  if (w.owner[id] === realm) return;
  const key = realm ? w.realms[realm]?.key : null;
  if (key === undefined) return; // a realm just created, not yet known to the game
  command({ type: 'setOwner', province: id, realm });
  sessionEdits.value = new Map(sessionEdits.value).set(id, { x, y, realm: key });
  const created = newRealms.value.find((r) => r.key === key);
  if (created && !created.capital) {
    created.capital = [x, y]; // a new realm's first province becomes its capital
    newRealms.value = [...newRealms.value];
  }
  persist();
}

export function createRealm(name: string, color: string, rank: Rank, government: Government) {
  const w = world.value;
  if (!w || !name.trim()) return;
  const taken = new Set(w.realms.map((r) => r?.key));
  const base = name.trim().toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'realm';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  const realm: NewRealm = { key, name: name.trim(), rank, government, color, capital: null };
  command({ type: 'addRealm', realm: { ...realm, capital: 0, overlord: 0, scripted: false } });
  newRealms.value = [...newRealms.value, realm];
  brush.value = w.realms.length;
  persist();
}

/** Downloads 1314-edits.yaml: the edits already in the project plus this session's, newest winning per province. */
export function exportEdits() {
  const map = mapData.value;
  const view = currentView();
  if (!map || !view) return;
  const proj = map.projection;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const latLon = (x: number, y: number): [number, number] => {
    const [lon, lat] = pixelToLonLat(proj, x + 0.5, y + 0.5);
    return [round(lat), round(lon)];
  };
  const edited = new Set(sessionEdits.value.keys());
  const overrides = baseEdits.overrides.filter(([lat, lon]) => {
    const [x, y] = lonLatToPixel(proj, lon, lat);
    return !edited.has(view.idAtPixel(Math.floor(x), Math.floor(y)));
  });
  for (const e of sessionEdits.value.values()) overrides.push([...latLon(e.x, e.y), e.realm]);
  const realms = [
    ...baseEdits.realms,
    ...newRealms.value.filter((r) => r.capital).map(({ capital, ...r }) => ({ ...r, capital: latLon(...capital!) })),
  ];
  const lines = [
    '# Hand edits from the in-game map editor (Editor → Export), applied after data/scenario/1314.yaml.',
    '# realms: new realms. overrides: [lat, lon, realm key or null for unowned], one point inside each province.',
    realms.length ? 'realms:' : 'realms: []',
    ...realms.map((r) => `  - ${JSON.stringify(r)}`),
    overrides.length ? 'overrides:' : 'overrides: []',
    ...overrides.map((o) => `  - ${JSON.stringify(o)}`),
    '',
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/yaml' }));
  a.download = '1314-edits.yaml';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Saved 1314-edits.yaml: put it in data/scenario/ and rebuild');
}

/** Drops this browser's unsaved edits and restarts from the built map. */
export function discardEdits() {
  try {
    localStorage.removeItem(STORE);
  } catch { /* nothing stored */ }
  location.reload();
}
