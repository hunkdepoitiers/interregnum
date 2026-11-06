import { computed, effect, signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { armies, command, setNoticeHandler, startGame, status, world } from '../bridge/client';
import type { MapData, RiverData } from '../content/map';
import type { EditsSource, Scenario } from '../content/scenario';
import type { Content } from '../sim/content';
import { buildLookup, hexToRgb, type MapMode, type Peoples } from '../render/map-modes';
import { computeLabels } from '../render/labels';
import { LABEL_FONT, loadIdTiles, MapView } from '../render/map-view';
import { editing, paint, restoreEdits, setBaseEdits } from './editor';
import { EditorPanel } from './EditorPanel';
import { ArmyPanel, menLabel, selectArmy, selectedArmy } from './ArmyPanel';
import { CharacterPanel, selectedCharacter } from './CharacterPanel';
import { DebugConsole } from './DebugConsole';
import { MapModeBar } from './MapModeBar';
import { ProvincePanel } from './ProvincePanel';
import { RealmPanel } from './RealmPanel';
import { content } from './StatList';
import { SaveMenu } from './SaveMenu';
import { TopBar } from './TopBar';
import { TreasuryPanel } from './TreasuryPanel';

export const mapData = signal<MapData | null>(null);
export const mapMode = signal<MapMode>('political');
/** Culture and religion of every province at the start (scenario.json), for the map modes and panels. */
export const peoples = signal<Peoples | null>(null);
/** False while the scenario's realms are switched off (provinces-only map). */
export const hasRealms = computed(() => (world.value?.realms.length ?? 0) > 1);
export const hovered = signal<{ id: number; x: number; y: number }>({ id: 0, x: 0, y: 0 });
/** At most one of these is non-zero: the panel shows either a province or a realm. */
export const selected = signal(0);
export const selectedRealm = signal(0);
export const toast = signal<string | null>(null);
const loadError = signal<string | null>(null);
let view: MapView | null = null;

const START_SEED = 1314;

/** The map view, once mounted (the editor needs its pixel lookups). */
export function currentView(): MapView | null {
  return view;
}

// The editor's brush replaces clicking to select.
effect(() => {
  const on = editing.value;
  if (view) view.paintMode = on;
  if (on) selectProvince(0);
});

export function selectProvince(id: number, center = false) {
  if (id) { selectedCharacter.value = 0; selectedArmy.value = 0; }
  selected.value = id;
  selectedRealm.value = 0;
  view?.setSelected(id);
  view?.setRealmHighlight(null);
  const p = mapData.value?.provinces.find((q) => q.id === id);
  if (center && p) view?.centerOn(p.centroid[0], p.centroid[1]);
}

export function selectRealm(id: number, center = false) {
  if (id) { selectedCharacter.value = 0; selectedArmy.value = 0; }
  selected.value = 0;
  selectedRealm.value = id;
  view?.setSelected(0);
  const realm = world.value?.realms[id];
  view?.setRealmHighlight(realm ? hexToRgb(realm.color) : null);
  const capital = realm && mapData.value?.provinces.find((q) => q.id === realm.capital);
  if (center && capital) view?.centerOn(capital.centroid[0], capital.centroid[1]);
}

setNoticeHandler((notices) => showToast(notices.map((n) => n.text.replace('{province}', mapData.value?.provinces.find((q) => q.id === n.province)?.name ?? 'a province')).join(' ')));

export function showToast(text: string) {
  toast.value = text;
  setTimeout(() => {
    if (toast.value === text) toast.value = null;
  }, 4000);
}

// Recolour the map whenever ownership or the map mode changes.
effect(() => {
  const map = mapData.value;
  const w = world.value;
  const mode = hasRealms.value ? mapMode.value : 'terrain';
  if (map && view) {
    view.setLookup(buildLookup(map, mode, w, peoples.value));
    view.setLabels(mode === 'political' && w ? computeLabels(map, w) : []);
  }
});

/**
 * Debug helpers for testers, from the browser console:
 *   interregnum.occupy('edinburgh', 'scotland')   // occupier, or the owner to lift an occupation
 *   interregnum.transfer('kayseri', 'karaman')
 *   interregnum.select('vierzon')                  // open a province's panel
 */
function installDebugHooks(map: MapData) {
  const prov = (key: string) => map.provinces.find((p) => p.key === key)?.id ?? 0;
  const realm = (key: string) => world.value?.realms.findIndex((r) => r?.key === key) ?? -1;
  Object.assign(window, {
    interregnum: {
      occupy: (p: string, r: string) => command({ type: 'setController', province: prov(p), realm: realm(r) }),
      transfer: (p: string, r: string) => command({ type: 'setOwner', province: prov(p), realm: realm(r) }),
      select: (p: string) => selectProvince(prov(p), true),
      view: () => view,
      army: (id: number) => selectArmy(id),
    },
  });
}

export function App() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = import.meta.env.BASE_URL;
      const [map, scenario, edits, gameContent] = await Promise.all([
        fetch(`${base}generated/map.json`).then((r) => r.json() as Promise<MapData>),
        fetch(`${base}generated/scenario.json`).then((r) => r.json() as Promise<Scenario>),
        fetch(`${base}generated/scenario-edits.json`).then((r) => r.json() as Promise<EditsSource>).catch(() => null),
        fetch(`${base}generated/content.json`).then((r) => r.json() as Promise<Content>),
      ]);
      content.value = gameContent;
      peoples.value = { culture: scenario.culture ?? [], religion: scenario.religion ?? [], county: scenario.county ?? [], good: scenario.good ?? [], content: gameContent };
      if (edits) setBaseEdits(edits);
      // Labels are drawn to canvas, so the font must be ready first; without it they fall back to a system serif.
      const [tiles] = await Promise.all([loadIdTiles(base, map), document.fonts.load(`32px ${LABEL_FONT}`).catch(() => [])]);
      if (cancelled || !host.current) return;
      view = new MapView(map, tiles);
      const riversReady = fetch(`${base}generated/rivers.json`).then((r) => r.json() as Promise<RiverData>);
      view.onHover = (id, x, y) => {
        view!.setHover(id);
        hovered.value = { id, x, y };
      };
      view.onClick = (id) => selectProvince(id);
      view.onArmyClick = (id) => selectArmy(id);
      // Right click: the player's selected army marches there.
      view.onContextClick = (id) => {
        const a = armies.value.find((x) => x.id === selectedArmy.value);
        if (a && id && a.realm === status.value.player) command({ type: 'moveArmy', realm: a.realm, army: a.id, to: id });
      };
      view.onPaint = paint;
      await view.mount(host.current);
      view.setRivers(await riversReady);
      startGame(START_SEED, scenario, gameContent);
      // Replay this browser's unsaved map edits once the game exists.
      let restored = false;
      const stop = effect(() => {
        if (!world.value || restored) return;
        restored = true;
        queueMicrotask(() => { stop(); void restoreEdits(); });
      });
      installDebugHooks(map);
      mapData.value = map;
      const at = new Map(map.provinces.map((p) => [p.id, p.centroid]));
      effect(() => {
        const w = world.value;
        const sel = selectedArmy.value;
        view?.setArmies(armies.value.map((a) => {
          const from = at.get(a.location) ?? [0, 0];
          const to = a.next ? at.get(a.next) ?? from : from;
          const f = a.progress / 100;
          return {
            id: a.id, x: from[0] + (to[0] - from[0]) * f, y: from[1] + (to[1] - from[1]) * f,
            color: parseInt((w?.realms[a.realm]?.color ?? '#888888').slice(1), 16), label: menLabel(a.levies + a.menAtArms),
            selected: a.id === sel, fighting: a.fighting,
            path: a.id === sel ? a.path.map((p) => (at.get(p) ?? [0, 0]) as [number, number]) : [],
          };
        }));
      });
    })().catch((e) => (loadError.value = `Could not load the map: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const hoverProvince = mapData.value?.provinces.find((p) => p.id === hovered.value.id);
  const hoverRealm = hoverProvince && world.value?.realms[world.value.owner[hoverProvince.id] ?? 0];
  return (
    <div class="app">
      <div class="map" ref={host} />
      <TopBar />
      <ProvincePanel />
      <RealmPanel />
      <CharacterPanel />
      <ArmyPanel />
      <TreasuryPanel />
      <MapModeBar />
      <EditorPanel />
      <DebugConsole />
      <SaveMenu />
      <a
        class="credits"
        href="https://github.com/hunkdepoitiers/interregnum/blob/main/data/map/ATTRIBUTION.md"
        target="_blank"
        rel="noopener"
      >
        Map data: Natural Earth, geoBoundaries, © OpenStreetMap contributors (ODbL)
      </a>
      {hoverProvince && (
        <div class="hover-tip" style={{ left: `${hovered.value.x + 14}px`, top: `${hovered.value.y + 14}px` }}>
          {hoverProvince.name}
          {hoverRealm && <span class="tip-realm"> · {hoverRealm.name}</span>}
        </div>
      )}
      {!mapData.value && <div class="loading">{loadError.value ?? 'Unrolling the map…'}</div>}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
    </div>
  );
}
