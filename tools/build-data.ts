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

const { scenario, errors, warnings } = compileScenario(parsed.data, map.provinces);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
writeFileSync('public/generated/scenario.json', JSON.stringify(scenario));
const owned = scenario.owner.filter(Boolean).length;
console.log(`build-data: ${scenario.realms.length} realms, ${owned} owned provinces, ${warnings.length} warnings`);
