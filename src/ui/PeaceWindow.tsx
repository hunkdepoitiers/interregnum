import { computed, signal } from '@preact/signals';
import { command, status, wars } from '../bridge/client';
import type { PeaceTerms } from '../sim/war';
import type { PeaceOffer, WarView } from '../worker/protocol';
import { mapData } from './App';
import { money } from './economy';
import { RealmLink } from './RealmPanel';

type Mode = 'demand' | 'offer' | 'white';

/** War whose treaty is on the table; 0 = closed. */
export const peaceWar = signal(0);
const mode = signal<Mode>('demand');
const cede = signal<number[]>([]);
const months = signal(0);
const tribute = signal(false);
const release = signal<number[]>([]);
const vassalize = signal(false);
const humiliate = signal(false);
const breakAlliances = signal(false);

function resetTerms() {
  cede.value = [];
  months.value = 0;
  tribute.value = false;
  release.value = [];
  vassalize.value = false;
  humiliate.value = false;
  breakAlliances.value = false;
}

/** Opens the treaty for a war, on the side the score favours, and stops the clock. */
export function openPeace(war: WarView) {
  const player = status.value.player;
  const mine = war.attackers[0] === player ? war.score : -war.score;
  mode.value = mine > 0 ? 'demand' : mine < 0 ? 'offer' : 'white';
  resetTerms();
  peaceWar.value = war.id;
  command({ type: 'setPaused', paused: true });
}

export const openWar = computed(() => wars.value.find((w) => w.id === peaceWar.value) ?? null);
const currentOffer = (w: WarView | null): PeaceOffer | null => (!w || mode.value === 'white' ? null : mode.value === 'demand' ? w.demand : w.concede);

/** For the map: provinces on the table, and those picked. */
export const peaceTint = computed(() => {
  const offer = currentOffer(openWar.value);
  return offer ? { offered: offer.land.map((l) => l.id), picked: cede.value } : null;
});

const toggle = (list: { value: number[] }, id: number) => { list.value = list.value.includes(id) ? list.value.filter((x) => x !== id) : [...list.value, id]; };

/** A map click while the treaty is open toggles a province on the table. True if the window took the click. */
export function peaceMapClick(id: number): boolean {
  if (!peaceWar.value) return false;
  if (currentOffer(openWar.value)?.land.some((l) => l.id === id)) toggle(cede, id);
  return true;
}

function landCost(o: PeaceOffer, picked: number[]): number {
  if (!picked.length) return 0;
  const set = new Set(picked);
  const v = o.land.reduce((t, l) => t + (set.has(l.id) ? l.value : 0), 0);
  return Math.max(1, Math.trunc((v * o.landRate) / Math.max(1, o.loserValue)));
}

function Term({ on, set, label, cost, why }: { on: boolean; set: (v: boolean) => void; label: string; cost: number; why?: string | null }) {
  return (
    <label class={why ? 'off' : ''} title={why ?? ''}>
      <input type="checkbox" checked={on && !why} disabled={!!why} onChange={(e) => set((e.target as HTMLInputElement).checked)} /> {label} <span class="muted">({cost})</span>
    </label>
  );
}

/** The treaty table: what is on offer, what it is worth, and whether they will sign. */
export function PeaceWindow() {
  const w = openWar.value;
  const player = status.value.player;
  if (!peaceWar.value) return null;
  if (!w) { peaceWar.value = 0; return null; }
  const amAttacker = w.attackers[0] === player;
  const leads = amAttacker || w.defenders[0] === player;
  const enemy = amAttacker ? w.defenders[0]! : w.attackers[0]!;
  const score = amAttacker ? w.score : -w.score;
  const m = mode.value;
  const offer = currentOffer(w);
  const name = (id: number) => mapData.value?.provinces.find((p) => p.id === id)?.name ?? '—';
  const onTable = cede.value.filter((id) => offer?.land.some((l) => l.id === id));
  const released = release.value.filter((id) => offer?.vassals.includes(id));
  const gold = offer?.gold.find((g) => g.months === months.value);
  const useVassal = vassalize.value && !offer?.vassalizeWhy;
  const cost = offer ? landCost(offer, onTable) + (gold?.cost ?? 0) + (tribute.value ? offer.tributeCost : 0) + released.length * offer.releaseCost
    + (useVassal ? offer.vassalizeCost : 0) + (humiliate.value ? offer.humiliateCost : 0) + (breakAlliances.value ? offer.breakCost : 0) : 0;
  const empty = !onTable.length && !months.value && !tribute.value && !released.length && !useVassal && !humiliate.value && !breakAlliances.value;
  const needed = Math.ceil((Math.max(0, -score) * w.concedeShare) / 100);
  let refusal: string | null;
  if (!leads) refusal = 'Only the leader of your side can make this peace.';
  else if (m === 'white') refusal = -score > w.whiteLimit ? `They are too far ahead to settle for nothing (they lead by ${-score}).` : null;
  else if (empty) refusal = 'Put something on the table.';
  else if (m === 'demand') refusal = cost > score ? `These terms are worth ${cost}; your war score is ${score}.` : null;
  else refusal = cost < needed ? `They want terms worth at least ${needed}; this is worth ${cost}.` : null;
  const switchTo = (x: Mode) => { mode.value = x; resetTerms(); };
  const send = () => {
    const terms: PeaceTerms = { cede: onTable, months: months.value, tribute: tribute.value, release: released, vassalize: useVassal, humiliate: humiliate.value, breakAlliances: breakAlliances.value };
    command({ type: 'proposePeace', realm: player, war: w.id, demand: m === 'demand', terms: m === 'white' ? { cede: [], months: 0 } : terms });
    peaceWar.value = 0;
  };
  const verb = m === 'demand' ? 'Take' : 'Give up';
  return (
    <aside class="peace-window folio panel" aria-label="Peace treaty">
      <button class="close" aria-label="Close" onClick={() => (peaceWar.value = 0)}>×</button>
      <h2><span class="initial">T</span>reaty of Peace</h2>
      <dl class="rows">
        <div class="row"><dt>With</dt><dd><RealmLink id={enemy} /></dd></div>
        <div class="row"><dt>Reason</dt><dd>{w.cbName}</dd></div>
        <div class="row"><dt>War score</dt><dd><span class={`has-tip${score < 0 ? ' warn' : ''}`} title={`Occupation ${w.occupation}, battles ${w.battles}, goal ${w.ticking} (from the attackers' side)`}>{score > 0 ? '+' : ''}{score}</span></dd></div>
      </dl>
      <nav class="realm-tabs" role="tablist">
        {([['demand', 'Demand'], ['offer', 'Offer'], ['white', 'White peace']] as [Mode, string][]).map(([k, l]) => (
          <button key={k} class={m === k ? 'on' : ''} onClick={() => switchTo(k)}>{l}</button>
        ))}
      </nav>
      <div class="folio-body">
        {m === 'white' && <p>Both sides lay down their arms. Occupied land goes back to its owners and a truce begins.</p>}
        {offer && (
          <>
            <h3>Terms</h3>
            <div class="peace-terms">
              {offer.gold.map((g) => (
                <label key={g.months}><input type="radio" name="gold" checked={months.value === g.months} onClick={() => (months.value = months.value === g.months ? 0 : g.months)} /> {money(g.amount)} ducats <span class="muted">({g.months} months' income, {g.cost})</span></label>
              ))}
              <Term on={tribute.value} set={(v) => (tribute.value = v)} label={`Tribute of ${offer.tributeShare}% for ${offer.tributeYears} years`} cost={offer.tributeCost} />
              <Term on={vassalize.value} set={(v) => (vassalize.value = v)} label={m === 'demand' ? 'They become our vassal' : 'We become their vassal'} cost={offer.vassalizeCost} why={offer.vassalizeWhy} />
              <Term on={humiliate.value} set={(v) => (humiliate.value = v)} label={`Public humiliation (${offer.humiliatePrestige} prestige)`} cost={offer.humiliateCost} />
              <Term on={breakAlliances.value} set={(v) => (breakAlliances.value = v)} label={m === 'demand' ? 'They renounce their alliances' : 'We renounce our alliances'} cost={offer.breakCost} why={offer.allies ? null : 'No alliances to break.'} />
            </div>
            {offer.vassals.length > 0 && (
              <>
                <h3>Release vassals</h3>
                <div class="peace-terms">
                  {offer.vassals.map((v) => <label key={v}><input type="checkbox" checked={release.value.includes(v)} onChange={() => toggle(release, v)} /> <RealmLink id={v} /> <span class="muted">({offer.releaseCost})</span></label>)}
                </div>
              </>
            )}
            <h3>Provinces <span class="muted">({onTable.length} of {offer.land.length}, cost {landCost(offer, onTable)})</span></h3>
            {offer.land.length === 0 && <p class="muted small">{w.cb === 'raid' ? 'A raid takes no land.' : 'None are occupied. Only occupied land can change hands.'}</p>}
            {offer.land.length > 0 && (
              <>
                <p class="muted small">Click provinces on the map, or tick them here.</p>
                <div class="deeds">
                  <button class="small-btn" onClick={() => (cede.value = offer.land.map((l) => l.id))}>{verb} all</button>
                  <button class="small-btn" onClick={() => (cede.value = [])}>None</button>
                </div>
                <div class="peace-terms peace-land">
                  {[...offer.land].sort((a, b) => b.value - a.value).map((l) => (
                    <label key={l.id}><input type="checkbox" checked={cede.value.includes(l.id)} onChange={() => toggle(cede, l.id)} /> {name(l.id)} <span class="muted">({l.value})</span></label>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <footer class="peace-foot">
        {m !== 'white' && <div class="peace-cost">Worth <strong>{cost}</strong>{m === 'demand' ? <> of your <strong>{Math.max(0, score)}</strong></> : needed > 0 ? <> · they want <strong>{needed}</strong></> : null}</div>}
        <div class={`peace-verdict${refusal ? ' warn' : ''}`}>{refusal ?? 'They will sign.'}</div>
        <button class="peace-send" disabled={!!refusal} onClick={send}>{m === 'demand' ? 'Demand these terms' : m === 'offer' ? 'Offer these terms' : 'Offer white peace'}</button>
      </footer>
    </aside>
  );
}
