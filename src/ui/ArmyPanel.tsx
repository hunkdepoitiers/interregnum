import { effect, signal } from '@preact/signals';
import { armies, command, status } from '../bridge/client';
import { dayToDate, formatDate } from '../sim/calendar';
import { mapData, selectProvince, selectRealm } from './App';
import { CharLink, selectedCharacter } from './CharacterPanel';
import { money } from './economy';
import { Row, Section } from './folio';
import { CoatOfArms } from './heraldry';
import { RealmLink } from './RealmPanel';
import { world } from '../bridge/client';

/** Army whose panel is open; 0 = none. Opening one closes the other panels. */
export const selectedArmy = signal(0);

// Opening a character's page closes the army's.
effect(() => { if (selectedCharacter.value) selectedArmy.value = 0; });

export function selectArmy(id: number) {
  selectProvince(0);
  selectRealm(0);
  selectedCharacter.value = 0;
  selectedArmy.value = id;
}

export const menLabel = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function ProvinceLink({ id }: { id: number }) {
  const p = mapData.value?.provinces.find((q) => q.id === id);
  return <button class="link" onClick={() => selectProvince(id, true)}>{p?.name ?? '—'}</button>;
}

export function ArmyPanel() {
  const a = armies.value.find((x) => x.id === selectedArmy.value);
  const realm = a ? world.value?.realms[a.realm] : null;
  if (!a || !realm) return null;
  const mine = status.value.player === a.realm;
  const day = status.value.day;
  const state = a.retreating ? 'Retreating' : a.fighting ? 'In battle' : day < a.ready ? `Mustering until ${formatDate(dayToDate(a.ready))}` : a.next ? 'On the march' : 'Encamped';
  return (
    <aside class="side-panel folio panel" aria-label="Army">
      <header class="folio-head realm-head">
        <CoatOfArms realm={realm} size={64} />
        <div class="cartouche">
          <h2>Army of {realm.name.replace(/^(Kingdom|Duchy|County|Empire|Crown) of /, '')}</h2>
          <p class="sub">{(a.levies + a.menAtArms).toLocaleString('en')} men · {state}</p>
        </div>
        <button class="close" aria-label="Close" onClick={() => (selectedArmy.value = 0)}>×</button>
      </header>
      <div class="folio-body">
        <Section title="The Host">
          <Row label="Realm"><RealmLink id={a.realm} /></Row>
          <Row label="Commander"><CharLink who={a.commander} /></Row>
          <Row label="Levies">{a.levies.toLocaleString('en')}</Row>
          <Row label="Men-at-arms">{a.menAtArms.toLocaleString('en')}</Row>
          <Row label="Morale"><span class={a.morale < 30 ? 'warn' : ''}>{a.morale}%</span></Row>
          <Row label="Wages">{money(a.wage)} ducats a month</Row>
        </Section>
        <Section title="Where">
          <Row label="At"><ProvinceLink id={a.location} /></Row>
          {a.destination > 0 && <Row label="Bound for"><ProvinceLink id={a.destination} /> <span class="muted">({a.eta} days)</span></Row>}
          {a.siegeNeed > 0 && <Row label="Occupying">{a.siege} of {a.siegeNeed} days</Row>}
        </Section>
        {mine && (
          <>
            <p class="muted small hint">Right-click a province on the map to march there.</p>
            <div class="realm-actions">
              <button onClick={() => command({ type: 'splitArmy', realm: a.realm, army: a.id })} disabled={a.retreating}>Split</button>
              <button onClick={() => command({ type: 'mergeArmies', realm: a.realm, army: a.id })}>Merge here</button>
              {a.next > 0 && <button onClick={() => command({ type: 'moveArmy', realm: a.realm, army: a.id, to: a.location })}>Halt</button>}
              <button onClick={() => { command({ type: 'disband', realm: a.realm, army: a.id }); selectedArmy.value = 0; }}>Disband</button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
