import { world } from '../bridge/client';
import type { MapData, MapProvince } from '../content/map';
import { hasRealms, mapData, peoples, selected, selectProvince } from './App';
import { Pending, Row, Section } from './folio';
import { CoatOfArms } from './heraldry';
import { GOVERNMENT_LABEL, RANK_LABEL, RealmLink } from './RealmPanel';
import { ModifierList, StatList, StatRow } from './StatList';
import { TerrainVignette } from './vignette';

const KIND_LABEL = {
  land: 'Land province', sea: 'Sea zone', wasteland: 'Wasteland, impassable', mountain: 'Mountains, impassable', lake: 'Lake',
};

/** Stats this panel places in its own sections; any other province stat goes under "Other". */
const PLACED = ['development', 'supply_limit', 'unrest', 'tax_efficiency'];

/** When a field that has no simulation yet arrives (docs/ROADMAP.md). */
const ECONOMY = 'the economy (M4)';
const ARMIES = 'armies (M7)';
const SIEGES = 'sieges (M8)';

function areaKm2(map: MapData, p: MapProvince): number {
  // Equirectangular pixels cover less ground away from the standard parallel; scale by latitude.
  const proj = map.projection;
  const lat = proj.north - (p.centroid[1] / map.height) * (proj.north - proj.south);
  const kmPerPx = ((proj.north - proj.south) * 111.32) / map.height;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  return p.pixels * kmPerPx * kmPerPx * (Math.cos(rad(lat)) / Math.cos(rad(proj.standardParallel)));
}

const TIER = /^(County|Duchy|Kingdom|Empire) of /;

function DeJure({ id }: { id: number }) {
  const pe = peoples.value;
  if (!pe) return null;
  const t = pe.content.titles;
  const county = pe.county[id] ? t.counties[pe.county[id]! - 1] : undefined;
  const duchy = county?.parent ? t.duchies[county.parent - 1] : undefined;
  const kingdom = duchy?.parent ? t.kingdoms[duchy.parent - 1] : undefined;
  const empire = kingdom?.parent ? t.empires[kingdom.parent - 1] : undefined;
  const hegemony = empire?.parent ? t.hegemonies[empire.parent - 1] : undefined;
  const ladder = [
    ['Barony & county', county?.name],
    ['Duchy', duchy?.name],
    ['Kingdom', kingdom?.name],
    ['Empire', empire?.name],
    ['Hegemony', hegemony?.name],
  ].filter(([, n]) => n) as [string, string][];
  if (!ladder.length) return null;
  return (
    <section class="folio-sec">
      <h3><span class="initial">D</span>e jure</h3>
      <ol class="ladder">
        {ladder.map(([tier, name]) => (
          <li key={tier}><span class="tier">{tier}</span><span class="title-name">{name.replace(TIER, '')}</span></li>
        ))}
      </ol>
    </section>
  );
}

export function ProvincePanel() {
  const map = mapData.value;
  const p = map?.provinces.find((q) => q.id === selected.value);
  if (!map || !p) return null;
  const w = world.value;
  const owner = w?.owner[p.id] ?? 0;
  const controller = w?.controller[p.id] ?? 0;
  const realm = owner ? w?.realms[owner] : undefined;
  const land = p.kind === 'land';
  const pe = land ? peoples.value : null;
  const culture = pe && pe.culture[p.id] ? pe.content.cultures[pe.culture[p.id]! - 1] : undefined;
  const religion = pe && pe.religion[p.id] ? pe.content.religions[pe.religion[p.id]! - 1] : undefined;
  const good = pe && pe.good[p.id] ? pe.content.goods[pe.good[p.id]! - 1] : undefined;

  return (
    <aside class="side-panel folio panel" aria-label="Province">
      <header class="folio-head">
        <TerrainVignette terrain={p.terrain} kind={p.kind} coastal={!!p.coastal} seed={p.id} />
        <div class="cartouche">
          <h2>{p.name}</h2>
          <p class="sub">
            {land && p.terrain ? <span class="cap">{p.terrain}</span> : KIND_LABEL[p.kind]}
            {p.coastal ? ' · coastal' : ''}
          </p>
        </div>
        <button class="close" aria-label="Close" onClick={() => selectProvince(0)}>×</button>
      </header>

      <div class="folio-body">
        {land && hasRealms.value && (
          <div class="liege">
            {realm ? <CoatOfArms realm={realm} size={42} /> : <span class="arms-blank" />}
            <div>
              {realm ? <RealmLink id={owner} /> : <span class="muted">Unclaimed land</span>}
              {realm && <div class="sub">{RANK_LABEL[realm.rank]} · {GOVERNMENT_LABEL[realm.government]}</div>}
              {controller !== owner && controller > 0 && <div class="warn">Occupied by <RealmLink id={controller} /></div>}
            </div>
          </div>
        )}

        {land ? (
          <>
            <Section title="The Land">
              <Row label="Area">≈ {(Math.round(areaKm2(map, p) / 100) * 100).toLocaleString('en')} km²</Row>
              <StatRow stat="development" scope="province" id={p.id} />
              <StatRow stat="supply_limit" scope="province" id={p.id} />
              <Pending label="Control" when={ARMIES} />
              <Pending label="Prosperity" when={ECONOMY} />
              <Pending label="Fortifications" when={SIEGES} />
              <Pending label="Buildings" when={ECONOMY} />
            </Section>
            <Section title="The People">
              {culture && <Row label="Culture">{culture.name} <span class="muted">({culture.groupName})</span></Row>}
              {religion && <Row label="Religion"><span class="swatch" style={{ background: religion.color }} aria-hidden="true" />{religion.name}</Row>}
              <Pending label="Population" when={ECONOMY} />
              <StatRow stat="unrest" scope="province" id={p.id} />
              <Pending label="Estates" when={ECONOMY} />
            </Section>
            <Section title="Wealth">
              {good && <Row label="Produces"><span class="swatch" style={{ background: good.color }} aria-hidden="true" />{good.name}</Row>}
              <StatRow stat="tax_efficiency" scope="province" id={p.id} />
              <Pending label="Tax income" when={ECONOMY} />
              <Pending label="Trade value" when={ECONOMY} />
              <Pending label="Trade power" when={ECONOMY} />
            </Section>
            <Section title="Arms">
              <Pending label="Manpower" when={ARMIES} />
              {p.coastal && <Pending label="Sailors" when={ARMIES} />}
              <Pending label="Garrison" when={SIEGES} />
            </Section>
            <DeJure id={p.id} />
            <StatList scope="province" id={p.id} skip={PLACED} />
            <ModifierList scope="province" id={p.id} />
          </>
        ) : (
          <Section title="The Place">
            <Row label="Area">≈ {(Math.round(areaKm2(map, p) / 100) * 100).toLocaleString('en')} km²</Row>
            <Row label="Kind">{KIND_LABEL[p.kind]}</Row>
          </Section>
        )}
        <p class="colophon">{p.key} · #{p.id}</p>
      </div>
    </aside>
  );
}
