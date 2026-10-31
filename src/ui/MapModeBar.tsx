import type { MapMode } from '../render/map-modes';
import { mapMode } from './App';

const MODES: { mode: MapMode; label: string; key: string }[] = [
  { mode: 'political', label: 'Political', key: 'q' },
  { mode: 'terrain', label: 'Terrain', key: 'w' },
];

export function MapModeBar() {
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
    </nav>
  );
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const m = MODES.find((x) => x.key === e.key.toLowerCase());
  if (m) mapMode.value = m.mode;
});
