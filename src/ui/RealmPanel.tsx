import { armies, command, status, wars, world } from '../bridge/client';
import { ledgerNet } from '../sim/economy';
import { money, signedMoney, treasuryOpen, useReport } from './economy';
import type { Realm } from '../sim/state';
import { mapData, selectedRealm, selectProvince, selectRealm } from './App';
import { dayToDate, formatDate } from '../sim/calendar';
import { SKILL_NAMES } from '../sim/characters';
import type { CourtReport, MilitaryReport, StandingReport } from '../worker/protocol';
import { menLabel, selectArmy } from './ArmyPanel';
import { CharLink, Medallion } from './CharacterPanel';
import { Row, Section } from './folio';
import { content } from './StatList';
import { CoatOfArms } from './heraldry';
import { ModifierList, StatList } from './StatList';

export const RANK_LABEL: Record<Realm['rank'], string> = {
  empire: 'Empire', kingdom: 'Kingdom', duchy: 'Duchy', county: 'County',
};
export const GOVERNMENT_LABEL: Record<Realm['government'], string> = {
  feudal_monarchy: 'Feudal monarchy',
  merchant_republic: 'Merchant republic',
  theocracy: 'Theocracy',
  holy_order: 'Holy order',
  steppe_horde: 'Steppe horde',
  iqta_sultanate: 'Iqta sultanate',
  beylik: 'Beylik',
};

export function RealmLink({ id }: { id: number }) {
  const r = world.value?.realms[id];
  if (!r) return <span class="muted">none</span>;
  return (
    <button class="link realm-link" onClick={() => selectRealm(id, true)}>
      <span class="swatch" style={{ background: r.color }} aria-hidden="true" />
      {r.name}
    </button>
  );
}

export function RealmPanel() {
  const w = world.value;
  const map = mapData.value;
  const realm = w?.realms[selectedRealm.value];
  const report = useReport(realm ? { kind: 'realm', id: realm.id } : null);
  if (!w || !map || !realm) return null;

  const owned = map.provinces.filter((p) => w.owner[p.id] === realm.id).sort((a, b) => a.name.localeCompare(b.name));
  const occupiedByOthers = owned.filter((p) => w.controller[p.id] !== realm.id).length;
  const heldAbroad = map.provinces.filter((p) => w.controller[p.id] === realm.id && w.owner[p.id] !== realm.id).length;
  const vassals = w.realms.filter((r): r is Realm => !!r && r.overlord === realm.id);

  const capital = map.provinces.find((p) => p.id === realm.capital);
  return (
    <aside class="side-panel folio panel" aria-label="Realm">
      <header class="folio-head realm-head">
        <CoatOfArms realm={realm} size={74} />
        <div class="cartouche">
          <h2>{realm.name}</h2>
          <p class="sub">
            {RANK_LABEL[realm.rank]} · {GOVERNMENT_LABEL[realm.government]}
            {realm.scripted ? ' · scripted neighbour' : ''}
          </p>
        </div>
        <button class="close" aria-label="Close" onClick={() => selectRealm(0)}>×</button>
      </header>
      <div class="folio-body">
        <Section title="The Realm">
          <Row label="Capital">
            <button class="link" onClick={() => selectProvince(realm.capital, true)}>{capital?.name ?? '—'}</button>
          </Row>
          {realm.overlord > 0 && <Row label="Overlord"><RealmLink id={realm.overlord} /></Row>}
          <Row label="Provinces">
            {owned.length}
            {occupiedByOthers > 0 && <span class="warn"> ({occupiedByOthers} occupied by enemies)</span>}
          </Row>
          {heldAbroad > 0 && <Row label="Occupying">{heldAbroad} foreign provinces</Row>}
          {report && <Row label="People">{report.people.toLocaleString('en')}</Row>}
        </Section>
        {report?.court && <Crown court={report.court} />}
        {report?.military && <Arms realm={realm.id} m={report.military} mine={status.value.player === realm.id} />}
        {report?.standing && <Standing realm={realm.id} s={report.standing} mine={status.value.player === realm.id} />}
        <Section title="Treasury">
          {report && <Row label="Treasury"><span class={report.treasury < 0 ? 'warn' : ''}>{money(report.treasury)} ducats</span></Row>}
          {report && <Row label="This month">{signedMoney(ledgerNet(report.projected))}</Row>}
          {report && <Row label="Debts">{money(report.credit.debt)} ducats</Row>}
          {report && <Row label="Credit">{report.credit.value} <span class="muted">of 100</span></Row>}
        </Section>
        <div class="realm-actions">
          {status.value.player === realm.id
            ? <span class="muted">You rule this realm.</span>
            : <button onClick={() => command({ type: 'setPlayer', realm: realm.id })}>Play as this realm</button>}
          <button onClick={() => (treasuryOpen.value = realm.id)}>Treasury</button>
        </div>
        <section class="folio-sec">
          <h3><span class="initial">S</span>tanding</h3>
          <StatList scope="realm" id={realm.id} />
        </section>
        <ModifierList scope="realm" id={realm.id} />
        {vassals.length > 0 && (
          <section class="folio-sec">
            <h3><span class="initial">V</span>assals and tributaries</h3>
            <ul class="plain">
              {vassals.map((v) => <li key={v.id}><RealmLink id={v.id} /></li>)}
            </ul>
          </section>
        )}
        <section class="folio-sec">
          <h3><span class="initial">P</span>rovinces</h3>
          <ul class="columns">
            {owned.map((p) => (
              <li key={p.id}>
                <button class="link" onClick={() => selectProvince(p.id, true)}>{p.name}</button>
                {w.controller[p.id] !== realm.id && <span class="tag">occupied</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

const SEAT_LABEL: Record<string, string> = { chancellor: 'Chancellor', treasurer: 'Treasurer', marshal: 'Marshal', chaplain: 'Court chaplain' };

/** The ruler, the line of succession and the council. */
function Crown({ court }: { court: CourtReport }) {
  const c = content.value;
  const law = c?.characters.laws.find((l) => l.key === court.law);
  const traitName = (k: string) => c?.characters.traits.find((t) => t.key === k)?.name ?? k;
  const elected = court.law === 'republic' || court.law === 'theocracy';
  return (
    <>
      <section class="folio-sec">
        <h3><span class="initial">T</span>he Crown</h3>
        {court.ruler && (
          <div class="ruler-line">
            <Medallion who={court.ruler} size={48} crowned />
            <div>
              <CharLink who={court.ruler} />
              <div class="sub">{court.ruler.house ? `House ${court.ruler.house}` : 'Of no great house'} · since {formatDate(dayToDate(court.since))}</div>
              <div class="skills-line">
                {SKILL_NAMES.map((n, i) => <span key={n} title={n}>{n[0]} <strong>{court.rulerSkills[i]}</strong></span>)}
              </div>
              {court.rulerTraits.length > 0 && <div class="sub">{court.rulerTraits.map(traitName).join(', ')}</div>}
            </div>
          </div>
        )}
        <dl class="rows">
          {court.regent && <Row label="Regent"><CharLink who={court.regent} /></Row>}
          <Row label="Heir">{court.heir ? <CharLink who={court.heir} /> : <span class="muted">{elected ? 'elected on the ruler’s death' : 'none of the blood'}</span>}</Row>
          {court.claimant && <Row label="Claimant"><CharLink who={court.claimant} /></Row>}
          <Row label="Succession"><span title={law?.description}>{law?.name ?? court.law}</span></Row>
        </dl>
      </section>
      <section class="folio-sec">
        <h3><span class="initial">C</span>ouncil</h3>
        <dl class="rows">
          {court.council.map((seat) => (
            <Row key={seat.role} label={SEAT_LABEL[seat.role] ?? seat.role}>
              <CharLink who={seat.who} /> {seat.who && <span class="muted small" title={SKILL_NAMES[seat.skill]}>{SKILL_NAMES[seat.skill]![0]} {seat.value}</span>}
            </Row>
          ))}
        </dl>
      </section>
    </>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** A tier modifier's effects as text, for tooltips. */
function effectsText(key: string | null): string {
  const c = content.value;
  const def = key ? c?.modifiers[key] : undefined;
  if (!def || !c) return 'No effects.';
  return def.effects.map((e) => {
    const label = c.stats[e.stat]?.label ?? e.stat;
    const v = e.value / 100;
    return e.op === 'pct' ? `${label} ${signed(v)}%` : `${label} ${signed(v)}${c.stats[e.stat]?.format === 'percent' ? '%' : ''}`;
  }).join(', ');
}

/** Tooltip for a currency: every tier with its threshold and effects, the current one marked, and recent deeds. */
function tierTitle(kind: 'prestige' | 'piety', s: StandingReport, names: string[]): string {
  const f = content.value?.faith;
  if (!f) return '';
  const tiers = kind === 'prestige' ? f.prestigeTiers : f.pietyTiers;
  const current = kind === 'prestige' ? s.prestigeTier : s.pietyTier;
  const lines = tiers.map((t, i) => `${i === current ? '▶ ' : '   '}${names[i] ?? ''}${i > 0 ? ` (from ${t.min})` : ''}: ${effectsText(t.modifier)}`);
  const deeds = s.log.filter((l) => l[kind] !== 0).slice(-6).reverse().map((l) => `${formatDate(dayToDate(l.day))}: ${l.label} ${signed(l[kind])}`);
  return [...lines, ...(deeds.length ? ['', 'Recent:', ...deeds] : [])].join('\n');
}

/** Prestige, piety, faith, holy sites, the record of deeds, and the deeds the player may do. */
function Standing({ realm, s, mine }: { realm: number; s: StandingReport; mine: boolean }) {
  const c = content.value;
  const religion = c?.religions[s.religion - 1];
  const prestigeNames = c?.faith.prestigeTiers.map((t) => t.name) ?? [];
  const fam = religion?.family ?? 'christian';
  const pietyNames = c?.faith.pietyNames[fam] ?? c?.faith.pietyNames.christian ?? [];
  const held = s.holySites.filter((h) => h.held);
  return (
    <section class="folio-sec">
      <h3><span class="initial">F</span>aith and Renown</h3>
      <dl class="rows">
        <Row label="Prestige"><span class="has-tip" title={tierTitle('prestige', s, prestigeNames)}><strong>{s.prestige}</strong> <span class="muted">{s.prestigeName}</span></span></Row>
        <Row label="Piety"><span class="has-tip" title={tierTitle('piety', s, pietyNames)}><strong>{s.piety}</strong> <span class="muted">{s.pietyName}</span></span></Row>
        {religion && <Row label="Faith"><span class="swatch" style={{ background: religion.color }} aria-hidden="true" />{religion.name}</Row>}
        {s.head > 0 && s.head !== realm && <Row label="Head of faith"><RealmLink id={s.head} /></Row>}
        {s.head === realm && <Row label="Head of faith"><span>This realm</span></Row>}
        {s.holySites.length > 0 && (
          <Row label="Holy sites">
            <span title={s.holySites.map((h) => `${h.held ? '✔' : '✘'} ${h.name}`).join('\n')}>{held.length} of {s.holySites.length} held{held.length > 0 ? ` (+${held.length * (c?.faith.holySitePiety ?? 0)} piety a month)` : ''}</span>
          </Row>
        )}
        {s.excommunicated && <Row label="The Church"><span class="warn">Excommunicated</span></Row>}
        {!s.excommunicated && s.excommunicationChance > 0 && <Row label="The Church"><span class="warn" title="Piety below zero angers the Pope.">{s.excommunicationChance / 100}% a month to be excommunicated</span></Row>}
        {s.pilgrimage !== null && <Row label="Pilgrimage"><span>Home by {formatDate(dayToDate(s.pilgrimage))}</span></Row>}
      </dl>
      {s.log.length > 0 && (
        <ul class="plain deeds-log">
          {s.log.slice(-4).reverse().map((l) => (
            <li key={`${l.day}-${l.label}`}>
              <span class="muted">{formatDate(dayToDate(l.day))}</span> {l.label}
              {l.prestige !== 0 && <span class={l.prestige < 0 ? 'warn' : ''}> {signed(l.prestige)} prestige</span>}
              {l.piety !== 0 && <span class={l.piety < 0 ? 'warn' : ''}> {signed(l.piety)} piety</span>}
            </li>
          ))}
        </ul>
      )}
      {mine && (
        <div class="deeds">
          {s.deeds.filter((d) => d.key !== 'absolution' || s.excommunicated).map((d) => {
            const gains = [d.prestige && `${signed(d.prestige)} prestige`, d.piety && `${signed(d.piety)} piety`].filter(Boolean).join(', ');
            const price = d.income ? `brings in ${money(d.income)} ducats` : `costs ${money(d.cost)} ducats`;
            const when = d.days ? ` on the ruler's return after ${d.days} days` : '';
            return (
              <button key={d.key} class="small-btn" disabled={!!d.why} title={`${d.description}\n${price[0]!.toUpperCase()}${price.slice(1)}; ${gains}${when}.${d.why ? `\n${d.why}` : ''}`}
                onClick={() => command({ type: 'deed', realm, deed: d.key })}>
                {d.name}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Levies, men-at-arms, armies in the field and wars; debug war and peace until diplomacy (M9) brings real ones. */
function Arms({ realm, m, mine }: { realm: number; m: MilitaryReport; mine: boolean }) {
  const player = status.value.player;
  const own = armies.value.filter((a) => a.realm === realm);
  const myWars = wars.value.filter((w) => w.attackers.includes(realm) || w.defenders.includes(realm));
  const atWarWithPlayer = myWars.some((w) => (w.attackers.includes(realm) && w.defenders.includes(player)) || (w.defenders.includes(realm) && w.attackers.includes(player)));
  return (
    <section class="folio-sec">
      <h3><span class="initial">A</span>rms</h3>
      <dl class="rows">
        <Row label="Levies"><span title="People of the realm × levy size × the levy share">{m.raised.toLocaleString('en')} raised of {m.total.toLocaleString('en')}</span></Row>
        <Row label="Men-at-arms">{m.menAtArms.toLocaleString('en')} <span class="muted">of {m.maxMenAtArms.toLocaleString('en')} at most</span></Row>
        {own.map((a) => (
          <Row key={a.id} label="Army">
            <button class="link" onClick={() => selectArmy(a.id)}>{menLabel(a.levies + a.menAtArms)} men</button>
            <span class="muted"> {a.retreating ? 'retreating' : a.fighting ? 'in battle' : a.next ? 'marching' : 'encamped'}</span>
          </Row>
        ))}
        {myWars.map((w) => (
          <Row key={w.id} label="At war">
            <span>{(w.attackers.includes(realm) ? w.defenders : w.attackers).filter((r, i) => i === 0 || r === player).map((r) => <RealmLink key={r} id={r} />)}</span>
            {mine && <button class="small-btn" title="Debug: white peace, occupied land returns" onClick={() => command({ type: 'makePeace', war: w.id })}>Make peace</button>}
          </Row>
        ))}
      </dl>
      {mine && (
        <div class="deeds">
          <button class="small-btn" disabled={m.raised >= m.total} onClick={() => command({ type: 'raiseLevies', realm })}>Raise levies</button>
          <button class="small-btn" disabled={!!m.cannotHire} title={m.cannotHire ?? `Hire 1,000 men-at-arms for ${money(m.hireCost)} ducats.`} onClick={() => command({ type: 'hireMenAtArms', realm, men: 1000 })}>Hire 1,000 men-at-arms</button>
        </div>
      )}
      {!mine && player > 0 && !atWarWithPlayer && (
        <div class="deeds">
          <button class="small-btn" title="Debug until diplomacy: no reason needed" onClick={() => command({ type: 'declareWar', attacker: player, defender: realm })}>Declare war (debug)</button>
        </div>
      )}
    </section>
  );
}

