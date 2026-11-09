import { computed, signal } from '@preact/signals';
import { command, status, world } from '../bridge/client';
import { dayToDate, formatDate } from '../sim/calendar';
import { SKILL_NAMES } from '../sim/characters';
import { currentView, mapData } from './App';
import { hexToRgb } from '../render/map-modes';
import { money, useReport } from './economy';
import { Row, Section } from './folio';
import { CoatOfArms } from './heraldry';
import { GOVERNMENT_LABEL, RANK_LABEL } from './RealmPanel';
import { CharLink, Medallion } from './CharacterPanel';
import { content } from './StatList';

/** True until a realm is chosen: the game opens on this screen, and a loaded save with a player skips it. */
export const choosing = computed(() => !!world.value && status.value.player === 0);

/** The realm on the selection card; 0 = none yet. */
export const chosen = signal(0);

/** Selects a realm on the screen, lights it on the map and, from the list, flies to it. */
export function pickRealm(id: number, center = false) {
  const realm = world.value?.realms[id];
  if (!realm) return;
  chosen.value = id;
  currentView()?.setRealmHighlight(hexToRgb(realm.color));
  const capital = mapData.value?.provinces.find((p) => p.id === realm.capital);
  if (center && capital) currentView()?.centerOn(capital.centroid[0], capital.centroid[1]);
}

/** A click on the map picks whoever owns the province. */
export function pickProvince(id: number) {
  const owner = world.value?.owner[id] ?? 0;
  if (owner) pickRealm(owner);
}

const FEATURED: [string, string[]][] = [
  ['West', ['france', 'england', 'scotland', 'castile', 'aragon', 'portugal', 'naples', 'papal_states', 'venice', 'genoa', 'florence']],
  ['Empire and North', ['bavaria', 'habsburg', 'bohemia', 'brandenburg', 'swiss', 'denmark', 'sweden', 'norway', 'teutonic_order']],
  ['East', ['poland', 'lithuania', 'hungary', 'moscow', 'tver', 'serbia', 'bulgaria', 'byzantium']],
  ['Islam and the Steppe', ['ottomans', 'karaman', 'mamluks', 'golden_horde', 'ilkhanate', 'granada', 'delhi', 'mali']],
  ['Far East', ['yuan', 'japan', 'tibet', 'goryeo', 'dai_viet']],
];

/** The opening screen: pick a realm on the map or from the list, see what it is, and begin. */
export function NationSelect() {
  const id = chosen.value;
  const w = world.value;
  const realm = id ? w?.realms[id] : null;
  const report = useReport(choosing.value && realm ? { kind: 'realm', id } : null);
  if (!choosing.value || !w) return null;
  const provinces = realm ? w.owner.reduce((n, o) => n + (o === id ? 1 : 0), 0) : 0;
  const court = report?.court;
  const religion = report?.standing ? content.value?.religions[report.standing.religion - 1] : undefined;
  return (
    <>
      <div class="nation-banner panel">
        <h1>Interregnum</h1>
        <p>{formatDate(dayToDate(status.value.day))} · Choose your realm</p>
      </div>
      <aside class="side-panel folio panel" aria-label="Chosen realm">
        {!realm && <div class="folio-body"><p class="nation-hint">Click any realm on the map, or pick one from the list.</p></div>}
        {realm && (
          <>
            <header class="folio-head realm-head">
              <CoatOfArms realm={realm} size={74} />
              <div class="cartouche">
                <h2>{realm.name}</h2>
                <p class="sub">{RANK_LABEL[realm.rank]} · {GOVERNMENT_LABEL[realm.government]}</p>
              </div>
            </header>
            <div class="folio-body">
              {court?.ruler && (
                <section class="folio-sec">
                  <h3><span class="initial">R</span>uler</h3>
                  <div class="ruler-line">
                    <Medallion who={court.ruler} size={48} crowned />
                    <div>
                      <CharLink who={court.ruler} />
                      <div class="sub">{court.ruler.house ? `House ${court.ruler.house}` : 'Of no great house'}</div>
                      <div class="skills-line">{SKILL_NAMES.map((n, i) => <span key={n} title={n}>{n[0]} <strong>{court.rulerSkills[i]}</strong></span>)}</div>
                    </div>
                  </div>
                  <dl class="rows">
                    {court.regent && <Row label="Regent"><CharLink who={court.regent} /></Row>}
                    <Row label="Heir"><CharLink who={court.heir} /></Row>
                  </dl>
                </section>
              )}
              <Section title="The Realm">
                <Row label="Provinces">{provinces}</Row>
                {report && <Row label="People">{report.people.toLocaleString('en')}</Row>}
                {realm.overlord > 0 && <Row label="Vassal of">{w.realms[realm.overlord]?.name}</Row>}
                {religion && <Row label="Faith"><span class="swatch" style={{ background: religion.color }} aria-hidden="true" />{religion.name}</Row>}
                {report?.standing && <Row label="Prestige">{report.standing.prestige} <span class="muted">{report.standing.prestigeName}</span></Row>}
                {report && <Row label="Levies">{report.military.total.toLocaleString('en')}</Row>}
                {report && <Row label="Treasury">{money(report.treasury)} ducats</Row>}
              </Section>
              {realm.scripted && <p class="muted small">The steppe powers follow history’s timeline of demands and invasions.</p>}
            </div>
            <div class="nation-play">
              <button onClick={() => { currentView()?.setRealmHighlight(null); command({ type: 'setPlayer', realm: id }); }}>Play as {realm.name}</button>
            </div>
          </>
        )}
      </aside>
      <nav class="nation-list panel" aria-label="Notable realms">
        {FEATURED.map(([group, keys]) => {
          const realms = keys.flatMap((k) => w.realms.filter((r) => r?.key === k));
          return (
            <section key={group}>
              <h3>{group}</h3>
              {realms.map((r) => (
                <button key={r!.id} class={r!.id === id ? 'on' : ''} onClick={() => pickRealm(r!.id, true)}>
                  <CoatOfArms realm={r!} size={24} /> {r!.name.replace(/^(Kingdom|Duchy|County|Empire|Crown|Republic) of /, '')}
                </button>
              ))}
            </section>
          );
        })}
      </nav>
    </>
  );
}
