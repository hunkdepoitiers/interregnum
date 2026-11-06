import { command, status, world } from '../bridge/client';
import { ledgerNet } from '../sim/economy';
import { money, signedMoney, treasuryOpen, useReport } from './economy';
import type { Realm } from '../sim/state';
import { mapData, selectedRealm, selectProvince, selectRealm } from './App';
import { Pending, Row, Section } from './folio';
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
          <Pending label="Ruler" when="characters (M5)" />
        </Section>
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
