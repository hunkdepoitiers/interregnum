import type { MapMode } from '../render/map-modes';
import { hasRealms, mapMode } from './App';
import { editing } from './editor';

const MODES: { mode: MapMode; label: string; key: string }[] = [
  { mode: 'political', label: 'Political', key: 'p' },
  { mode: 'terrain', label: 'Terrain', key: 't' },
  { mode: 'culture', label: 'Culture', key: 'k' },
  { mode: 'religion', label: 'Religion', key: 'r' },
];

export function MapModeBar() {
  if (!hasRealms.value) return null; // provinces-only map: there is nothing political to show
  return (
    <nav class="mapmodes panel" aria-label="Map mode">
      {MODES.map((m) => (
        <button
          key={m.mode}
          class={mapMode.value === m.mode ? 'on' : ''}
          aria-pressed={mapMode.value === m.mode}
          title={`${m.label} map (key ${m.key.toUpperCase()})`}
          onClick={() => (mapMode.value = m.mode)}
        >
          {m.label}
        </button>
      ))}
      <button
        class={editing.value ? 'on' : ''}
        aria-pressed={editing.value}
        title="Map editor: paint provinces onto realms (key E)"
        onClick={() => (editing.value = !editing.value)}
      >
        Editor
      </button>
    </nav>
  );
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key.toLowerCase() === 'e') { editing.value = !editing.value; return; }
  const m = MODES.find((x) => x.key === e.key.toLowerCase());
  if (m) mapMode.value = m.mode;
});
