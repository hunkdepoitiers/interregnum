import { useEffect } from 'preact/hooks';
import { command, day, paused, speed } from '../bridge/client';
import { dayToDate, formatDate } from '../sim/calendar';
import type { Speed } from '../sim/state';

const SPEEDS: Speed[] = [1, 2, 3, 4, 5];

export function TopBar() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        command({ type: 'togglePause' });
      } else if (e.key >= '1' && e.key <= '5') {
        command({ type: 'setSpeed', speed: Number(e.key) as Speed });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header class="topbar panel">
      <span class="date">{formatDate(dayToDate(day.value))}</span>
      <button
        class="playpause"
        title="Pause / resume (Space)"
        aria-label={paused.value ? 'Resume' : 'Pause'}
        onClick={() => command({ type: 'togglePause' })}
      >
        {paused.value ? '▶' : '❚❚'}
      </button>
      <span class="speeds" role="group" aria-label="Game speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            class={s <= speed.value ? 'on' : ''}
            title={`Speed ${s} (key ${s})`}
            aria-pressed={s === speed.value}
            onClick={() => command({ type: 'setSpeed', speed: s })}
          >
            {s}
          </button>
        ))}
      </span>
      {paused.value && <span class="paused-label">Paused</span>}
    </header>
  );
}
