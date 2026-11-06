import { signal } from '@preact/signals';
import { dayToDate, formatDate } from '../sim/calendar';
import { SKILL_NAMES } from '../sim/characters';
import type { CharacterRef } from '../worker/protocol';
import { selectProvince, selectRealm } from './App';
import { useReport } from './economy';
import { Row, Section } from './folio';
import { RealmLink } from './RealmPanel';
import { content } from './StatList';

/** Character whose page is open; 0 = none. Opening one closes the province and realm panels. */
export const selectedCharacter = signal(0);

export function selectCharacter(id: number) {
  selectProvince(0);
  selectRealm(0);
  selectedCharacter.value = id;
}

export const TIERS = ['Indifferent', 'Competent', 'Accomplished', 'Masterful'];
const ROLE_LABEL: Record<string, string> = {
  ruler: 'Ruler of', regent: 'Regent of', heir: 'Heir to', claimant: 'Claimant to',
  chancellor: 'Chancellor of', treasurer: 'Treasurer of', marshal: 'Marshal of', chaplain: 'Court chaplain of',
};

/** A character's name as a link, with their age, or the cross for the dead. */
export function CharLink({ who }: { who: CharacterRef | null }) {
  if (!who) return <span class="muted">none</span>;
  return (
    <button class="link" onClick={() => selectCharacter(who.id)} title={who.house ? `${who.name} ${who.house}` : who.name}>
      {who.name}
      <span class="muted"> {who.alive ? `(${who.age})` : '†'}</span>
    </button>
  );
}

/** A house's colour, for medallions: a stable hue from its name. */
function houseHue(house: string): number {
  let h = 0;
  for (let i = 0; i < house.length; i++) h = (h * 31 + house.charCodeAt(i)) % 360;
  return h;
}

export function Medallion({ who, size = 64, crowned = false }: { who: CharacterRef; size?: number; crowned?: boolean }) {
  return (
    <span class={`medallion${who.alive ? '' : ' dead'}`} style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.55)}px`, background: `hsl(${houseHue(who.house)} 38% 32%)` }} aria-hidden="true">
      {who.name[0]}
      {crowned && <span class="crown">♛</span>}
    </span>
  );
}

function health(h: number): string {
  return h >= 75 ? 'Hale' : h >= 55 ? 'Well' : h >= 35 ? 'Ailing' : 'Frail';
}

export function CharacterPanel() {
  const id = selectedCharacter.value;
  const r = useReport(id ? { kind: 'character', id } : null);
  const c = content.value;
  if (!id || !r || !c) return null;
  const traits = c.characters.traits;
  const religion = c.religions[r.religion - 1];
  const culture = c.cultures[r.culture - 1];
  const rules = r.roles.some((x) => x.role === 'ruler');
  const year = (day: number) => formatDate(dayToDate(day));
  return (
    <aside class="side-panel folio panel" aria-label="Character">
      <header class="folio-head realm-head">
        <Medallion who={r.ref} size={76} crowned={rules && r.ref.alive} />
        <div class="cartouche">
          <h2>{r.ref.name}</h2>
          <p class="sub">{r.ref.house ? `House ${r.ref.house}` : 'Of no great house'}</p>
        </div>
        <button class="close" aria-label="Close" onClick={() => (selectedCharacter.value = 0)}>×</button>
      </header>
      <div class="folio-body">
        <Section title="The Person">
          <Row label="Born">{year(r.born)}</Row>
          {r.died !== null ? <Row label="Died">{year(r.died)}, aged {r.ref.age}</Row> : <Row label="Age">{r.ref.age}</Row>}
          {r.died === null && <Row label="Health">{health(r.health)}</Row>}
          {culture && <Row label="Culture">{culture.name}</Row>}
          {religion && <Row label="Faith"><span class="swatch" style={{ background: religion.color }} aria-hidden="true" />{religion.name}</Row>}
          {r.education && <Row label="Education">{SKILL_NAMES[r.education.focus]}, {TIERS[r.education.tier]?.toLowerCase()}</Row>}
        </Section>
        {r.roles.length > 0 && (
          <Section title="Standing">
            {r.roles.map((x) => <Row key={`${x.role}-${x.realm}`} label={ROLE_LABEL[x.role] ?? x.role}><RealmLink id={x.realm} /></Row>)}
          </Section>
        )}
        <section class="folio-sec">
          <h3><span class="initial">S</span>kills</h3>
          <dl class="rows">
            {SKILL_NAMES.map((name, i) => (
              <div class="row" key={name} title={r.breakdown.filter((l) => l.values[i]).map((l) => `${l.label}: ${l.values[i]! > 0 && l.label !== 'Talent' ? '+' : ''}${l.values[i]}`).join('\n')}>
                <dt>{name}</dt><dd><strong>{r.skills[i]}</strong></dd>
              </div>
            ))}
          </dl>
        </section>
        {r.traits.length > 0 && (
          <section class="folio-sec">
            <h3><span class="initial">T</span>raits</h3>
            <p class="traits">
              {r.traits.map((t) => {
                const d = traits.find((x) => x.key === t);
                return <span key={t} class="trait" title={d?.description}>{d?.name ?? t}</span>;
              })}
            </p>
          </section>
        )}
        <Section title="Family">
          {r.father && <Row label="Father"><CharLink who={r.father} /></Row>}
          {r.mother && <Row label="Mother"><CharLink who={r.mother} /></Row>}
          {r.spouse && <Row label={r.ref.female ? 'Husband' : 'Wife'}><CharLink who={r.spouse} /></Row>}
          {r.children.map((k) => <Row key={k.id} label={k.female ? 'Daughter' : 'Son'}><CharLink who={k} /></Row>)}
          {r.siblings.map((k) => <Row key={k.id} label={k.female ? 'Sister' : 'Brother'}><CharLink who={k} /></Row>)}
        </Section>
      </div>
    </aside>
  );
}
