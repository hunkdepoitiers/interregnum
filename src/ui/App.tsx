import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { MapData } from '../content/map';
import { loadIdMap, MapView } from '../render/map-view';
import { ProvincePanel } from './ProvincePanel';
import { SaveMenu } from './SaveMenu';
import { TopBar } from './TopBar';

export const mapData = signal<MapData | null>(null);
export const hovered = signal<{ id: number; x: number; y: number }>({ id: 0, x: 0, y: 0 });
export const selected = signal(0);
export const toast = signal<string | null>(null);
const loadError = signal<string | null>(null);
let view: MapView | null = null;

export function selectProvince(id: number, center = false) {
  selected.value = id;
  view?.setSelected(id);
  const p = mapData.value?.provinces.find((q) => q.id === id);
  if (center && p) view?.centerOn(p.centroid[0], p.centroid[1]);
}

export function showToast(text: string) {
  toast.value = text;
  setTimeout(() => {
    if (toast.value === text) toast.value = null;
  }, 4000);
}

export function App() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = import.meta.env.BASE_URL;
      const map = (await (await fetch(`${base}generated/map.json`)).json()) as MapData;
      const { bitmap, ids } = await loadIdMap(`${base}generated/province-ids.png`, map.width, map.height);
      if (cancelled || !host.current) return;
      view = new MapView(map, ids, bitmap);
      view.onHover = (id, x, y) => {
        view!.setHover(id);
        hovered.value = { id, x, y };
      };
      view.onClick = (id) => selectProvince(id);
      await view.mount(host.current);
      mapData.value = map;
    })().catch((e) => (loadError.value = `Could not load the map: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const hoverProvince = mapData.value?.provinces.find((p) => p.id === hovered.value.id);
  return (
    <div class="app">
      <div class="map" ref={host} />
      <TopBar />
      <ProvincePanel />
      <SaveMenu />
      {hoverProvince && (
        <div class="hover-tip" style={{ left: `${hovered.value.x + 14}px`, top: `${hovered.value.y + 14}px` }}>
          {hoverProvince.name}
        </div>
      )}
      {!mapData.value && <div class="loading">{loadError.value ?? 'Unrolling the map…'}</div>}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
    </div>
  );
}
