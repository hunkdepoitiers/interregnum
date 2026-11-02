import { world } from '../bridge/client';
import { hasRealms, mapData, peoples, selected, selectProvince } from './App';
import { RealmLink } from './RealmPanel';
import { ModifierList, StatList } from './StatList';

const KIND_LABEL = {
  land: 'Land province', sea: 'Sea zone', wasteland: 'Wasteland (impassable)', mountain: 'Mountains (impassable)', lake: 'Lake',
};

export function ProvincePanel() {
  const map = mapData.value;
  const p = map?.provinces.find((q) => q.id === selected.value);
  if (!map || !p) return null;
  const byId = new Map(map.provinces.map((q) => [q.id, q]));
  const owner = world.value?.owner[p.id] ?? 0;
  const controller = world.value?.controller[p.id] ?? 0;

  // Equirectangular pixels cover less ground away from the standard parallel; scale by latitude.
  const proj = map.projection;
  const lat = proj.north - (p.centroid[1] / map.height) * (proj.north - proj.south);
  const kmPerPx = ((proj.north - proj.south) * 111.32) / map.height;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const areaKm2 = p.pixels * kmPerPx * kmPerPx * (Math.cos(rad(lat)) / Math.cos(rad(proj.standardParallel)));

  return (
    <aside class="side-panel panel" aria-label="Province">
      <button class="close" aria-label="Close" onClick={() => selectProvince(0)}>×</button>
      <h2>{p.name}</h2>
      <p class="sub">
        {KIND_LABEL[p.kind]}
        {p.coastal ? ' · coastal' : ''} · #{p.id}
      </p>
      <dl>
        {p.kind === 'land' && hasRealms.value && (
          <>
            <dt>Owner</dt>
            <dd>{owner ? <RealmLink id={owner} /> : <span class="muted">Unclaimed</span>}</dd>
            {controller !== owner && (
              <>
                <dt>Occupied by</dt>
                <dd><RealmLink id={controller} /></dd>
              </>
            )}
          </>
        )}
        {p.terrain && (
          <>
            <dt>Terrain</dt>
            <dd class="terrain-name">{p.terrain}</dd>
          </>
        )}
        {p.kind === 'land' && peoples.value && (() => {
          const { culture, religion, content: c } = peoples.value;
          const cu = culture[p.id] ? c.cultures[culture[p.id]! - 1] : undefined;
          const re = religion[p.id] ? c.religions[religion[p.id]! - 1] : undefined;
          return (
            <>
              {cu && (<><dt>Culture</dt><dd>{cu.name} <span class="muted">({cu.groupName})</span></dd></>)}
              {re && (<><dt>Religion</dt><dd>{re.name}</dd></>)}
              {peoples.value.good[p.id] ? (<><dt>Produces</dt><dd>{c.goods[peoples.value.good[p.id]! - 1]!.name}</dd></>) : null}
              {(() => {
                const t = c.titles;
                const county = peoples.value.county[p.id] ? t.counties[peoples.value.county[p.id]! - 1] : undefined;
                const duchy = county?.parent ? t.duchies[county.parent - 1] : undefined;
                const kingdom = duchy?.parent ? t.kingdoms[duchy.parent - 1] : undefined;
                const empire = kingdom?.parent ? t.empires[kingdom.parent - 1] : undefined;
                const hegemony = empire?.parent ? t.hegemonies[empire.parent - 1] : undefined;
                const chain = [county, duchy, kingdom, empire, hegemony].filter((x) => x).map((x) => x!.name);
                return chain.length ? (<><dt>De jure</dt><dd class="dejure">{chain.join(' › ')}</dd></>) : null;
              })()}
            </>
          );
        })()}
        <dt>Area</dt>
        <dd>≈ {(Math.round(areaKm2 / 100) * 100).toLocaleString('en')} km²</dd>
        <dt>Key</dt>
        <dd><code>{p.key}</code></dd>
      </dl>
      {p.kind === 'land' && (
        <>
          <h3>Stats</h3>
          <StatList scope="province" id={p.id} />
          <ModifierList scope="province" id={p.id} />
        </>
      )}
      <h3>Neighbours</h3>
      <ul class="neighbours">
        {p.adjacency.map((a) => {
          const n = byId.get(a.id);
          if (!n) return null;
          return (
            <li key={a.id}>
              <button class={`link kind-${n.kind}`} onClick={() => selectProvince(n.id, true)}>
                {n.name}
              </button>
              {a.strait && <span class="tag">strait</span>}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
