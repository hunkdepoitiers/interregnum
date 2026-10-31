/**
 * Downloads simplified district boundaries (ADM2, or ADM1 where ADM2 is missing) from geoBoundaries gbOpen
 * for every country on the map into tools/vendor/geoboundaries/ (git-ignored), and records each file's
 * source and licence in data/map/boundary-sources.json for attribution.
 *
 * Usage: npm run fetch-boundaries      (one-off; seed-map uses the files when present)
 */
import { mkdirSync, writeFileSync } from 'node:fs';

/** ISO 3166-1 alpha-3 codes of countries that overlap the map area. */
const COUNTRIES = `PRT ESP AND FRA MCO GBR IRL IMN GIB BEL NLD LUX DEU DNK NOR SWE FIN EST LVA LTU POL CZE SVK AUT CHE
LIE ITA SMR MLT SVN HRV BIH SRB MNE XKX ALB MKD GRC BGR ROU MDA UKR BLR RUS HUN TUR CYP GEO ARM AZE IRN IRQ SYR
LBN ISR PSE JOR SAU KWT EGY LBY TUN DZA MAR KAZ TKM SDN`.split(/\s+/);
const OUT_DIR = 'tools/vendor/geoboundaries';

interface Source { iso: string; level: string; units: number; license: string; source: string; url: string }

async function meta(iso: string, level: string): Promise<Record<string, string> | null> {
  const r = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/${level}/`);
  if (!r.ok) return null;
  try {
    return (await r.json()) as Record<string, string>;
  } catch {
    return null;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const sources: Source[] = [];
for (const iso of COUNTRIES) {
  let level = 'ADM2';
  let m = await meta(iso, level);
  if (!m) {
    level = 'ADM1';
    m = await meta(iso, level);
  }
  if (!m) {
    console.warn(`${iso}: no geoBoundaries data, the generator falls back to seed growth there`);
    continue;
  }
  const url = m.simplifiedGeometryGeoJSON!;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${iso}: download failed (${res.status}) ${url}`);
  const text = await res.text();
  JSON.parse(text); // fail early on anything that is not JSON
  writeFileSync(`${OUT_DIR}/${iso}.geojson`, text);
  sources.push({ iso, level, units: Number(m.admUnitCount), license: m.boundaryLicense!, source: m.boundarySource!, url });
  console.log(`${iso} ${level} ${(text.length / 1e6).toFixed(1)} MB  ${m.boundaryLicense}`);
}
writeFileSync('data/map/boundary-sources.json', JSON.stringify(sources, null, 2) + '\n');
console.log(`Saved ${sources.length} countries to ${OUT_DIR} and data/map/boundary-sources.json`);
