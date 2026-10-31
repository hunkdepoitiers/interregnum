/** Validates data/scenario/1302.yaml against the built map and writes public/generated/scenario.json. Runs after build-map. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { MapData } from '../src/content/map';
import { scenarioSourceSchema } from '../src/content/scenario';
import { compileScenario } from './data-lib';

const map = JSON.parse(readFileSync('public/generated/map.json', 'utf8')) as MapData;
const parsed = scenarioSourceSchema.safeParse(parse(readFileSync('data/scenario/1302.yaml', 'utf8')));
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`error: data/scenario/1302.yaml ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

if (!parsed.data.enabled) {
  // Provinces-only mode: no realms, every province unowned. The realm data stays in the YAML untouched.
  const empty = new Array<number>(Math.max(...map.provinces.map((p) => p.id)) + 1).fill(0);
  writeFileSync('public/generated/scenario.json', JSON.stringify({ realms: [], owner: empty, controller: empty }));
  console.log('build-data: realms disabled (enabled: false), provinces-only map');
  process.exit(0);
}

const { scenario, errors, warnings } = compileScenario(parsed.data, map.provinces);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
writeFileSync('public/generated/scenario.json', JSON.stringify(scenario));
const owned = scenario.owner.filter(Boolean).length;
console.log(`build-data: ${scenario.realms.length} realms, ${owned} owned provinces, ${warnings.length} warnings`);
