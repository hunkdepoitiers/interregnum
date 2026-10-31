import { effect, signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { command, startGame, world } from '../bridge/client';
import type { MapData } from '../content/map';
import type { Scenario } from '../content/scenario';
import { buildLookup, hexToRgb, type MapMode } from '../render/map-modes';
import { loadIdMap, MapView } from '../render/map-view';
import { MapModeBar } from './MapModeBar';
import { ProvincePanel } from './ProvincePanel';
import { RealmPanel } from './RealmPanel';
import { SaveMenu } from './SaveMenu';
import { TopBar } from './TopBar';

export const mapData = signal<MapData | null>(null);
export const mapMode = signal<MapMode>('political');
export const hovered = signal<{ id: number; x: number; y: number }>({ id: 0, x: 0, y: 0 });
/** At most one of these is non-zero: the panel shows either a province or a realm. */
export const selected = signal(0);
export const selectedRealm = signal(0);
export const toast = signal<string | null>(null);
const loadError = signal<string | null>(null);
let view: MapView | null = null;

const START_SEED = 1302;

export function selectProvince(id: number, center = false) {
  selected.value = id;
  selectedRealm.value = 0;
  view?.setSelected(id);
  view?.setRealmHighlight(null);
  const p = mapData.value?.provinces.find((q) => q.id === id);
  if (center && p) view?.centerOn(p.centroid[0], p.centroid[1]);
}

export function selectRealm(id: number, center = false) {
  selected.value = 0;
  selectedRealm.value = id;
  view?.setSelected(0);
  const realm = world.value?.realms[id];
  view?.setRealmHighlight(realm ? hexToRgb(realm.color) : null);
  const capital = realm && mapData.value?.provinces.find((q) => q.id === realm.capital);
  if (center && capital) view?.centerOn(capital.centroid[0], capital.centroid[1]);
}

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
  const mode = mapMode.value;
  if (map && view) view.setLookup(buildLookup(map, mode, w));
});

/**
 * Debug helpers for testers, from the browser console:
 *   interregnum.occupy('edinburgh', 'scotland')   // occupier, or the owner to lift an occupation
 *   interregnum.transfer('kayseri', 'karaman')
 */
function installDebugHooks(map: MapData) {
  const prov = (key: string) => map.provinces.find((p) => p.key === key)?.id ?? 0;
  const realm = (key: string) => world.value?.realms.findIndex((r) => r?.key === key) ?? -1;
  Object.assign(window, {
    interregnum: {
      occupy: (p: string, r: string) => command({ type: 'setController', province: prov(p), realm: realm(r) }),
      transfer: (p: string, r: string) => command({ type: 'setOwner', province: prov(p), realm: realm(r) }),
    },
  });
}

export function App() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = import.meta.env.BASE_URL;
      const [map, scenario] = await Promise.all([
        fetch(`${base}generated/map.json`).then((r) => r.json() as Promise<MapData>),
        fetch(`${base}generated/scenario.json`).then((r) => r.json() as Promise<Scenario>),
      ]);
      const { bitmap, ids } = await loadIdMap(`${base}generated/province-ids.png`, map.width, map.height);
      if (cancelled || !host.current) return;
      view = new MapView(map, ids, bitmap);
      view.onHover = (id, x, y) => {
        view!.setHover(id);
        hovered.value = { id, x, y };
      };
      view.onClick = (id) => selectProvince(id);
      await view.mount(host.current);
      startGame(START_SEED, scenario);
      installDebugHooks(map);
      mapData.value = map;
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
      <MapModeBar />
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
