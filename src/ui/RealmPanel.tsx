import { world } from '../bridge/client';
import type { Realm } from '../sim/state';
import { mapData, selectedRealm, selectProvince, selectRealm } from './App';

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
  if (!w || !map || !realm) return null;

  const owned = map.provinces.filter((p) => w.owner[p.id] === realm.id).sort((a, b) => a.name.localeCompare(b.name));
  const occupiedByOthers = owned.filter((p) => w.controller[p.id] !== realm.id).length;
  const heldAbroad = map.provinces.filter((p) => w.controller[p.id] === realm.id && w.owner[p.id] !== realm.id).length;
  const vassals = w.realms.filter((r): r is Realm => !!r && r.overlord === realm.id);

  return (
    <aside class="side-panel panel" aria-label="Realm">
      <button class="close" aria-label="Close" onClick={() => selectRealm(0)}>×</button>
      <h2>
        <span class="swatch big" style={{ background: realm.color }} aria-hidden="true" />
        {realm.name}
      </h2>
      <p class="sub">
        {RANK_LABEL[realm.rank]} · {GOVERNMENT_LABEL[realm.government]}
        {realm.scripted ? ' · scripted neighbour' : ''}
      </p>
      <dl>
        <dt>Capital</dt>
        <dd>
          <button class="link" onClick={() => selectProvince(realm.capital, true)}>
            {map.provinces.find((p) => p.id === realm.capital)?.name ?? '—'}
          </button>
        </dd>
        {realm.overlord > 0 && (
          <>
            <dt>Overlord</dt>
            <dd><RealmLink id={realm.overlord} /></dd>
          </>
        )}
        <dt>Provinces</dt>
        <dd>
          {owned.length}
          {occupiedByOthers > 0 && <span class="warn"> ({occupiedByOthers} occupied by enemies)</span>}
        </dd>
        {heldAbroad > 0 && (
          <>
            <dt>Occupying</dt>
            <dd>{heldAbroad} foreign provinces</dd>
          </>
        )}
      </dl>
      {vassals.length > 0 && (
        <>
          <h3>Vassals and tributaries</h3>
          <ul class="plain">
            {vassals.map((v) => <li key={v.id}><RealmLink id={v.id} /></li>)}
          </ul>
        </>
      )}
      <h3>Provinces</h3>
      <ul class="neighbours">
        {owned.map((p) => (
          <li key={p.id}>
            <button class="link" onClick={() => selectProvince(p.id, true)}>{p.name}</button>
            {w.controller[p.id] !== realm.id && <span class="tag">occupied</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
