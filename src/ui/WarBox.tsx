import { useState } from 'preact/hooks';
import { command, status } from '../bridge/client';
import type { WarView } from '../worker/protocol';
import { money } from './economy';
import { RealmLink } from './RealmPanel';

/** One war: its reason and score and, for a war the player leads, the peace table. */
export function WarBox({ war, realm }: { war: WarView; realm: number }) {
  const [takeLand, setTakeLand] = useState(false);
  const [months, setMonths] = useState(0);
  const player = status.value.player;
  const amAttacker = war.attackers[0] === player;
  const leads = amAttacker || war.defenders[0] === player;
  const enemies = war.attackers.includes(realm) ? war.defenders : war.attackers;
  const mine = amAttacker ? war.score : -war.score;
  const demand = mine >= 0;
  const offer = demand ? war.demand : war.concede;
  const gold = offer?.gold.find((g) => g.months === months);
  const cost = (takeLand && offer ? offer.landCost : 0) + (gold?.cost ?? 0);
  const blank = !takeLand && !months;
  const allowed = demand ? cost <= mine : cost * 100 >= -mine * war.concedeShare;
  const title = `Occupation ${war.occupation}, battles ${war.battles}, goal ${war.ticking} (from the attackers' side)`;
  return (
    <div class="war-box">
      <div class="row"><dt>War with</dt><dd><RealmLink id={enemies[0]!} /></dd></div>
      <div class="row"><dt>Reason</dt><dd>{war.cbName}</dd></div>
      <div class="row"><dt>War score</dt><dd><span class={`has-tip${mine < 0 ? ' warn' : ''}`} title={title}>{mine > 0 ? '+' : ''}{mine}</span></dd></div>
      {leads && offer && realm === player && (
        <div class="peace">
          {offer.land.length > 0 && (
            <label><input type="checkbox" checked={takeLand} onChange={(e) => setTakeLand((e.target as HTMLInputElement).checked)} /> {demand ? 'Take' : 'Give up'} {offer.land.length} occupied provinces <span class="muted">({offer.landCost})</span></label>
          )}
          <div class="deeds">
            <button class={`small-btn${months === 0 ? ' on' : ''}`} onClick={() => setMonths(0)}>No gold</button>
            {offer.gold.map((g) => (
              <button key={g.months} class={`small-btn${months === g.months ? ' on' : ''}`} onClick={() => setMonths(g.months)} title={`${g.months} months of income`}>
                {money(g.amount)} <span class="muted">({g.cost})</span>
              </button>
            ))}
          </div>
          <div class="deeds">
            <button class="small-btn" disabled={blank || !allowed} title={allowed ? '' : demand ? `Worth ${cost}; your score is ${mine}.` : `Offer at least ${Math.ceil((-mine * war.concedeShare) / 100)}.`}
              onClick={() => command({ type: 'proposePeace', realm: player, war: war.id, demand, terms: { cede: takeLand ? offer.land : [], months } })}>
              {demand ? 'Demand' : 'Offer'} ({cost})
            </button>
            <button class="small-btn" onClick={() => command({ type: 'proposePeace', realm: player, war: war.id, demand: false, terms: { cede: [], months: 0 } })}>Offer white peace</button>
          </div>
        </div>
      )}
    </div>
  );
}
