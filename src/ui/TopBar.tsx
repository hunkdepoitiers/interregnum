import { useEffect } from 'preact/hooks';
import { command, status, world } from '../bridge/client';
import { money, signedMoney, treasuryOpen } from './economy';
import { dayToDate, formatDate } from '../sim/calendar';
import type { Speed } from '../sim/state';

const SPEEDS: Speed[] = [1, 2, 3, 4, 5];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

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
      <span class="date">{formatDate(dayToDate(status.value.day))}</span>
      <button
        class="playpause"
        title="Pause / resume (Space)"
        aria-label={status.value.paused ? 'Resume' : 'Pause'}
        onClick={() => command({ type: 'togglePause' })}
      >
        {status.value.paused ? '▶' : '❚❚'}
      </button>
      <span class="speeds" role="group" aria-label="Game speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            class={s <= status.value.speed ? 'on' : ''}
            title={`Speed ${s} (key ${s})`}
            aria-pressed={s === status.value.speed}
            onClick={() => command({ type: 'setSpeed', speed: s })}
          >
            {ROMAN[s]}
          </button>
        ))}
      </span>
      {status.value.paused && <span class="paused-label">Paused</span>}
      {status.value.player > 0 && status.value.treasury !== null && (
        <button
          class={`purse${status.value.treasury < 0 ? ' in-debt' : ''}`}
          title={`Treasury of ${world.value?.realms[status.value.player]?.name ?? 'your realm'}; last month's balance after it`}
          onClick={() => (treasuryOpen.value = treasuryOpen.value ? 0 : status.value.player)}
        >
          {money(status.value.treasury)} ducats <span class="net">{signedMoney(status.value.net ?? 0)}</span>
        </button>
      )}
    </header>
  );
}
