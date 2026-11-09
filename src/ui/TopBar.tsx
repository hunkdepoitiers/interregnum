import { useEffect } from 'preact/hooks';
import { command, status, wars, world } from '../bridge/client';
import { openPeace } from './PeaceWindow';
import { selectRealm, selectedRealm } from './App';
import { money, signedMoney } from './economy';
import { CoatOfArms } from './heraldry';
import { realmTab } from './RealmPanel';
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

  const player = status.value.player;
  const mine = player ? world.value?.realms[player] : null;
  const open = (tab: typeof realmTab.value) => {
    if (selectedRealm.value === player && realmTab.value === tab) { selectRealm(0); return; }
    realmTab.value = tab;
    selectRealm(player);
  };
  return (
    <header class="topbar panel">
      {mine && <button class="flag" title={`${mine.name}: open your realm`} aria-label="Your realm" onClick={() => open('realm')}><CoatOfArms realm={mine} size={36} /></button>}
      {wars.value.filter((w) => w.attackers.includes(player) || w.defenders.includes(player)).map((w) => {
        const score = w.attackers.includes(player) ? w.score : -w.score;
        const foe = world.value?.realms[w.attackers.includes(player) ? w.defenders[0]! : w.attackers[0]!];
        return (
          <button key={w.id} class={`war-shield${score < 0 ? ' losing' : ''}`} title={`War with ${foe?.name}. Click to negotiate peace.`} onClick={() => openPeace(w)}>
            ⚔ {score > 0 ? '+' : ''}{score}
          </button>
        );
      })}
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
          onClick={() => open('economy')}
        >
          {money(status.value.treasury)} ducats <span class="net">{signedMoney(status.value.net ?? 0)}</span>
        </button>
      )}
    </header>
  );
}
