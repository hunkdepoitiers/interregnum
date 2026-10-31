import { mapData, selected, selectProvince } from './App';

const KIND_LABEL = { land: 'Land province', sea: 'Sea zone', wasteland: 'Wasteland (impassable)', lake: 'Lake' };

export function ProvincePanel() {
  const map = mapData.value;
  const p = map?.provinces.find((q) => q.id === selected.value);
  if (!map || !p) return null;
  const byId = new Map(map.provinces.map((q) => [q.id, q]));

  // Equirectangular pixels cover less ground away from the standard parallel; scale by latitude.
  const proj = map.projection;
  const lat = proj.north - (p.centroid[1] / map.height) * (proj.north - proj.south);
  const kmPerPx = ((proj.north - proj.south) * 111.32) / map.height;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const areaKm2 = p.pixels * kmPerPx * kmPerPx * (Math.cos(rad(lat)) / Math.cos(rad(proj.standardParallel)));

  return (
    <aside class="province-panel panel">
      <button class="close" aria-label="Close" onClick={() => selectProvince(0)}>×</button>
      <h2>{p.name}</h2>
      <p class="sub">
        {KIND_LABEL[p.kind]}
        {p.coastal ? ' · coastal' : ''} · #{p.id}
      </p>
      <dl>
        <dt>Area</dt>
        <dd>≈ {(Math.round(areaKm2 / 100) * 100).toLocaleString('en')} km²</dd>
        <dt>Key</dt>
        <dd><code>{p.key}</code></dd>
      </dl>
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
