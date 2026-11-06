import { command, status, world } from '../bridge/client';
import { STRATA } from '../sim/content';
import { content } from './StatList';
import type { ProvinceReport } from '../worker/protocol';
import { money, useReport } from './economy';
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
const PLACED = ['development', 'supply_limit', 'unrest', 'tax_efficiency', 'trade_efficiency', 'production'];

const STRATUM_LABEL: Record<(typeof STRATA)[number], string> = {
  peasants: 'Peasants', burghers: 'Burghers', nobles: 'Nobles', clergy: 'Clergy', nomads: 'Nomads',
};

/** When a field that has no simulation yet arrives (docs/ROADMAP.md). */
const EVENTS = 'events (M10)';
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
  const report = useReport(p?.kind === 'land' ? { kind: 'province', id: p.id } : null);
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
  const ec = report?.economy;
  const perMonth = (h: number) => <>{money(h)} <span class="muted">a month</span></>;

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
              <Pending label="Prosperity" when={EVENTS} />
              <Pending label="Fortifications" when={SIEGES} />
            </Section>
            <Section title="The People">
              {culture && <Row label="Culture">{culture.name} <span class="muted">({culture.groupName})</span></Row>}
              {religion && <Row label="Religion"><span class="swatch" style={{ background: religion.color }} aria-hidden="true" />{religion.name}</Row>}
              {ec && <Row label="Population">{ec.people.toLocaleString('en')}</Row>}
              {ec && STRATA.map((st, i) => (ec.strata[i] ? <div class="row sub-row" key={st}><dt>{STRATUM_LABEL[st]}</dt><dd>{ec.strata[i]!.toLocaleString('en')}</dd></div> : null))}
              <StatRow stat="unrest" scope="province" id={p.id} />
            </Section>
            <Section title="Wealth">
              {good && <Row label="Produces"><span class="swatch" style={{ background: good.color }} aria-hidden="true" />{good.name}</Row>}
              {ec && <Row label="Wealth">{perMonth(ec.wealthLand + ec.wealthUrban)}</Row>}
              <StatRow stat="tax_efficiency" scope="province" id={p.id} />
              {ec && <Row label="Taxes">{perMonth(ec.landTax + ec.urbanTax)}</Row>}
              {ec && ec.tithe > 0 && <Row label="Crown's tithe">{perMonth(ec.tithe)}</Row>}
              <StatRow stat="production" scope="province" id={p.id} />
              {ec && <Row label="Trade value">{perMonth(ec.tradeValue)}</Row>}
              <StatRow stat="trade_efficiency" scope="province" id={p.id} />
              {ec && <Row label="Trade income">{perMonth(ec.trade)}</Row>}
              {ec && !ec.paying && owner > 0 && <p class="warn small">Occupied: nothing reaches the owner.</p>}
            </Section>
            {report && <Buildings id={p.id} owner={owner} report={report} />}
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

function Buildings({ id, owner, report }: { id: number; owner: number; report: ProvinceReport }) {
  const defs = content.value?.economy.buildings ?? [];
  const player = status.value.player;
  const day = status.value.day;
  const name = (k: string) => defs.find((b) => b.key === k)?.name ?? k;
  const mine = player > 0 && owner === player;
  const open = mine ? defs.filter((b) => !report.buildings.includes(b.key) && !report.construction.some((c) => c.building === b.key)) : [];
  if (!report.buildings.length && !report.construction.length && !open.length) return null;
  return (
    <Section title="Buildings">
      {report.buildings.map((b) => <Row key={b} label={name(b)}><span class="muted">standing</span></Row>)}
      {report.construction.map((c) => <Row key={c.building} label={name(c.building)}><span class="muted">{Math.max(0, c.done - day)} days to finish</span></Row>)}
      {open.map((b) => {
        const why = report.canBuild[b.key] ?? null;
        return (
          <div class="row build-row" key={b.key}>
            <dt title={b.description}>{b.name}</dt>
            <dd>
              <button
                class="small-btn"
                disabled={!!why}
                title={why ?? `${b.description} Costs ${money(b.cost)} ducats, takes ${b.days} days, then ${money(b.upkeep)} a month.`}
                onClick={() => command({ type: 'build', realm: player, province: id, building: b.key })}
              >
                Build · {money(b.cost)}
              </button>
            </dd>
          </div>
        );
      })}
    </Section>
  );
}
