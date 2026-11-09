import { command, status } from '../bridge/client';
import type { DiplomacyReport } from '../worker/protocol';
import { money } from './economy';
import { Row } from './folio';
import { RealmLink } from './RealmPanel';

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Opinion, treaties and the player's dealings with this realm; on the player's own realm, factions and demands. */
export function DiplomacySection({ realm, d }: { realm: number; d: DiplomacyReport }) {
  const player = status.value.player;
  const tip = d.opinion?.lines.map((l) => `${l.label}: ${signed(l.value)}`).join('\n') ?? '';
  return (
    <section class="folio-sec">
      <h3><span class="initial">D</span>iplomacy</h3>
      <dl class="rows">
        {d.opinion && <Row label="Thinks of you"><span class={`has-tip${d.opinion.value < 0 ? ' warn' : ''}`} title={tip}>{signed(d.opinion.value)}</span></Row>}
        {d.truceDays > 0 && <Row label="Truce">{d.truceDays} days left</Row>}
        {d.allies.map((r) => <Row key={`a${r}`} label="Ally"><RealmLink id={r} /></Row>)}
        {d.kin.map((r) => <Row key={`k${r}`} label="Kin by marriage"><RealmLink id={r} /></Row>)}
        {d.paysTo.map((t) => <Row key={`p${t.realm}`} label="Pays tribute to"><RealmLink id={t.realm} /> <span class="muted">{t.share}%</span></Row>)}
        {d.receivesFrom.map((t) => <Row key={`r${t.realm}`} label="Tribute from"><RealmLink id={t.realm} /> <span class="muted">{t.share}%</span></Row>)}
        {d.faction && <Row label="Faction"><span class="warn has-tip" title={`Rises at ${d.faction.needed}% once ${d.faction.needDays} days old.`}>{d.faction.members.length} vassals, {d.faction.power}% of your levies, {d.faction.days} days</span></Row>}
      </dl>
      {d.faction && <ul class="plain deeds-log">{d.faction.members.map((m) => <li key={m}><RealmLink id={m} /></li>)}</ul>}
      {d.demands.map((x) => (
        <div class="peace" key={x.id}>
          <p><RealmLink id={x.from} /> demands {x.share}% of your income for {x.years} years, or {x.men.toLocaleString('en')} riders will come. {x.days} days to answer.</p>
          <div class="deeds">
            <button class="small-btn" onClick={() => command({ type: 'answerDemand', demand: x.id, pay: true })}>Pay tribute</button>
            <button class="small-btn" onClick={() => command({ type: 'answerDemand', demand: x.id, pay: false })}>Refuse</button>
          </div>
        </div>
      ))}
      {d.actions.length > 0 && (
        <div class="deeds">
          {d.actions.map((a) => (
            <button key={a.key} class="small-btn" disabled={!!a.why} title={a.why ?? a.detail} onClick={() => command({ type: 'diplomacy', realm: player, target: realm, action: a.key })}>
              {a.label}{a.cost ? ` · ${money(a.cost)}` : ''}
            </button>
          ))}
        </div>
      )}
      {d.contract && (
        <div class="deeds">
          {d.contract.options.map((o) => (
            <button key={o.key} class={`small-btn${o.key === d.contract!.current ? ' on' : ''}`} title={o.description} onClick={() => command({ type: 'setContract', realm: player, vassal: realm, contract: o.key })}>{o.name}</button>
          ))}
        </div>
      )}
    </section>
  );
}
