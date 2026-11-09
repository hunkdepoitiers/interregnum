import { status } from '../bridge/client';
import type { WarView } from '../worker/protocol';
import { openPeace } from './PeaceWindow';
import { RealmLink } from './RealmPanel';

/** One war: its reason, its score, and the way to the peace table. */
export function WarBox({ war, realm }: { war: WarView; realm: number }) {
  const player = status.value.player;
  const onAttack = war.attackers.includes(realm);
  const enemies = onAttack ? war.defenders : war.attackers;
  const mine = onAttack ? war.score : -war.score;
  const inIt = war.attackers.includes(player) || war.defenders.includes(player);
  const title = `Occupation ${war.occupation}, battles ${war.battles}, goal ${war.ticking} (from the attackers' side)`;
  return (
    <div class="war-box">
      <div class="row"><dt>War with</dt><dd><RealmLink id={enemies[0]!} /></dd></div>
      <div class="row"><dt>Reason</dt><dd>{war.cbName}</dd></div>
      <div class="row"><dt>War score</dt><dd><span class={`has-tip${mine < 0 ? ' warn' : ''}`} title={title}>{mine > 0 ? '+' : ''}{mine}</span></dd></div>
      {inIt && <div class="deeds"><button class="small-btn" onClick={() => openPeace(war)}>Negotiate peace</button></div>}
    </div>
  );
}
