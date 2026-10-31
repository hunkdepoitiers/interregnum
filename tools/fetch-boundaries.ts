/**
 * Downloads simplified district boundaries from geoBoundaries gbOpen for every country on the map into
 * tools/vendor/geoboundaries/ (git-ignored), and records each file's source and licence in
 * data/map/boundary-sources.json for attribution.
 *
 * For each country it picks the finest ADM level whose units average at least MIN_MEAN_KM2 and whose file
 * is at most MAX_FILE_MB: fine districts let province borders follow real municipal and county lines.
 *
 * Usage: npm run fetch-boundaries [-- --dry-run]   (dry run prints the chosen levels and sizes only)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/** ISO 3166-1 alpha-3 codes of countries that overlap the map area. */
const COUNTRIES = `PRT ESP AND FRA MCO GBR IRL IMN GIB BEL NLD LUX DEU DNK NOR SWE FIN EST LVA LTU POL CZE SVK AUT CHE
LIE ITA SMR MLT SVN HRV BIH SRB MNE XKX ALB MKD GRC BGR ROU MDA UKR BLR RUS HUN TUR CYP GEO ARM AZE IRN IRQ SYR
LBN ISR PSE JOR SAU KWT EGY LBY TUN DZA MAR KAZ TKM SDN`.split(/\s+/);
const LEVELS = ['ADM1', 'ADM2', 'ADM3', 'ADM4'];
const MIN_MEAN_KM2 = 30;
const MAX_FILE_MB = 20;
const OUT_DIR = 'tools/vendor/geoboundaries';
const SOURCES_FILE = 'data/map/boundary-sources.json';
const dryRun = process.argv.includes('--dry-run');

interface Source { iso: string; level: string; units: number; license: string; source: string; url: string }
interface Candidate { level: string; meta: Record<string, string>; bytes: number }

async function meta(iso: string, level: string): Promise<Record<string, string> | null> {
  const r = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/${level}/`);
  if (!r.ok) return null;
  try {
    return (await r.json()) as Record<string, string>;
  } catch {
    return null;
  }
}

async function size(url: string): Promise<number> {
  const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  return Number(r.headers.get('content-length') ?? 0);
}

/** Finest level that is neither municipal-scale tiny nor too large to download, but never coarser than ADM2. */
function choose(cands: Candidate[]): Candidate | null {
  const ok = cands.filter((c) => Number(c.meta.meanAreaSqKM) >= MIN_MEAN_KM2 && c.bytes <= MAX_FILE_MB * 1e6);
  const finest = ok.at(-1);
  const adm2 = cands.find((c) => c.level === 'ADM2');
  if (adm2 && (!finest || LEVELS.indexOf(finest.level) < LEVELS.indexOf('ADM2'))) return adm2;
  return finest ?? cands[0] ?? null;
}

const previous: Source[] = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) : [];
mkdirSync(OUT_DIR, { recursive: true });
const sources: Source[] = [];
let newBytes = 0;
for (const iso of COUNTRIES) {
  const cands: Candidate[] = [];
  for (const level of LEVELS) {
    const m = await meta(iso, level);
    if (m) cands.push({ level, meta: m, bytes: await size(m.simplifiedGeometryGeoJSON!) });
  }
  const pick = choose(cands);
  if (!pick) {
    console.warn(`${iso}: no geoBoundaries data, the generator falls back to seed growth there`);
    continue;
  }
  const m = pick.meta;
  const url = m.simplifiedGeometryGeoJSON!;
  const src: Source = { iso, level: pick.level, units: Number(m.admUnitCount), license: m.boundaryLicense!, source: m.boundarySource!, url };
  sources.push(src);
  const have = previous.find((p) => p.iso === iso && p.url === url) && existsSync(`${OUT_DIR}/${iso}.geojson`);
  const note = `${iso} ${pick.level} ${m.admUnitCount} units, mean ${Math.round(Number(m.meanAreaSqKM))} km², ${(pick.bytes / 1e6).toFixed(1)} MB`;
  if (have) {
    console.log(`${note}  (already downloaded)`);
    continue;
  }
  newBytes += pick.bytes;
  if (dryRun) {
    console.log(`${note}  -> would download`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${iso}: download failed (${res.status}) ${url}`);
  const text = await res.text();
  JSON.parse(text); // fail early on anything that is not JSON
  writeFileSync(`${OUT_DIR}/${iso}.geojson`, text);
  console.log(`${note}  downloaded`);
}
console.log(`${dryRun ? 'Would download' : 'Downloaded'} ${(newBytes / 1e6).toFixed(1)} MB`);
if (!dryRun) writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2) + '\n');
