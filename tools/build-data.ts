/**
 * Validates data/scenario/1314.yaml (plus the map editor's 1314-edits.yaml, if present) against the built map and writes
 * public/generated/scenario.json, and the edits as scenario-edits.json for the editor to build on; compiles
 * data/content/*.yaml (stats, modifiers) into public/generated/content.json. Runs after build-map.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { seedsSchema, type MapData } from '../src/content/map';
import { modifiersSourceSchema, statsSourceSchema } from '../src/content/content';
import { peoplesSourceSchema } from '../src/content/peoples';
import { generatedTitlesSchema, upperTitlesSchema } from '../src/content/titles';
import { goodsSourceSchema } from '../src/content/goods';
import { editsSourceSchema, scenarioSourceSchema } from '../src/content/scenario';
import { compileContent } from './content-lib';
import { compileScenario } from './data-lib';
import { compilePeoples } from './peoples-lib';
import { compileTitles } from './titles-lib';
import { compileGoods } from './goods-lib';
import { compileEconomy, compilePopulation } from './economy-lib';
import { compileCharacters, compileRulers } from './characters-lib';
import { charactersSourceSchema, namesSourceSchema, rulersSourceSchema } from '../src/content/characters';
import { economySourceSchema, populationSourceSchema } from '../src/content/economy';

function load<T>(file: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): T {
  const r = schema.safeParse(parse(readFileSync(file, 'utf8')));
  if (!r.success) {
    for (const issue of r.error.issues) console.error(`error: ${file} ${issue.path.join('.')}: ${issue.message}`);
    process.exit(1);
  }
  return r.data;
}
const compiled = compileContent(load('data/content/stats.yaml', statsSourceSchema), load('data/content/modifiers.yaml', modifiersSourceSchema));
if (compiled.errors.length) {
  for (const e of compiled.errors) console.error(`error: ${e}`);
  process.exit(1);
}
const content = compiled.content;

const SCENARIO = 'data/scenario/1314.yaml';
const map = JSON.parse(readFileSync('public/generated/map.json', 'utf8')) as MapData;
const parsed = scenarioSourceSchema.safeParse(parse(readFileSync(SCENARIO, 'utf8')));
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`error: ${SCENARIO} ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const EDITS = 'data/scenario/1314-edits.yaml';
const editsParsed = editsSourceSchema.safeParse(existsSync(EDITS) ? parse(readFileSync(EDITS, 'utf8')) ?? {} : {});
if (!editsParsed.success) {
  for (const issue of editsParsed.error.issues) console.error(`error: ${EDITS} ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
const edits = editsParsed.data;
const source = { ...parsed.data, realms: [...parsed.data.realms, ...edits.realms], overrides: edits.overrides };

const towns = new Map<string, [number, number]>();
for (const file of ['data/map/seeds.yaml', 'data/map/seeds-world.yaml']) {
  for (const [key, , lat, lon] of seedsSchema.parse(parse(readFileSync(file, 'utf8'))).land) towns.set(key, [lat, lon]);
}

// Id-map tiles from build-map (id = R + 256 G), decoded on first use.
const tiles = new Map<string, Uint16Array>();
function idAt(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  const [col, row] = [Math.floor(x / map.tileSize), Math.floor(y / map.tileSize)];
  const name = `${col}-${row}`;
  let ids = tiles.get(name);
  if (!ids) {
    const png = PNG.sync.read(readFileSync(`public/generated/province-ids-${name}.png`));
    ids = new Uint16Array(png.width * png.height);
    for (let i = 0; i < ids.length; i++) ids[i] = png.data[i * 4]! | (png.data[i * 4 + 1]! << 8);
    tiles.set(name, ids);
  }
  const w = Math.min(map.tileSize, map.width - col * map.tileSize);
  return ids[(y - row * map.tileSize) * w + (x - col * map.tileSize)]!;
}

const { scenario, errors, warnings, unowned } = compileScenario(source, map.provinces, {
  projection: map.projection, towns, idAt, editedFrom: parsed.data.realms.length, content,
});
const peoples = compilePeoples(load('data/scenario/1314-peoples.yaml', peoplesSourceSchema), map.provinces, { projection: map.projection, towns, idAt });
errors.push(...peoples.errors);
content.cultures = peoples.cultures;
content.religions = peoples.religions;
scenario.culture = peoples.culture;
scenario.religion = peoples.religion;
const titles = compileTitles(load('data/map/titles.yaml', generatedTitlesSchema), load('data/content/titles.yaml', upperTitlesSchema), map.provinces, { projection: map.projection, towns, idAt });
errors.push(...titles.errors);
warnings.push(...titles.warnings);
content.titles = titles.titles;
scenario.county = titles.county;
const goods = compileGoods(load('data/content/trade_goods.yaml', goodsSourceSchema), map.provinces, { projection: map.projection, towns, idAt });
errors.push(...goods.errors);
content.goods = goods.goods;
scenario.good = goods.good;
const ctxAll = { projection: map.projection, towns, idAt };
const economy = compileEconomy(load('data/content/economy.yaml', economySourceSchema), content, map.provinces, ctxAll);
errors.push(...economy.errors);
content.economy = economy.economy;
scenario.tradeCentre = economy.tradeCentre;
const population = compilePopulation(load('data/scenario/1314-population.yaml', populationSourceSchema), map.provinces, ctxAll, new Set(scenario.realms.map((r) => r.capital)));
scenario.pops = population.pops;
scenario.development = population.development;
const characters = compileCharacters(load('data/content/characters.yaml', charactersSourceSchema), load('data/content/names.yaml', namesSourceSchema), content);
errors.push(...characters.errors);
content.characters = characters.characters;
const rulers = compileRulers(load('data/scenario/1314-rulers.yaml', rulersSourceSchema), scenario.realms, content, scenario.culture ?? [], scenario.religion ?? []);
errors.push(...rulers.errors);
scenario.characters = rulers.characters;
scenario.dynasties = rulers.dynasties;
scenario.courts = rulers.courts;
const provinceName = new Map(map.provinces.map((p) => [p.id, p.name]));
scenario.seats = scenario.realms.map((r) => provinceName.get(r.capital) ?? r.name);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
writeFileSync('public/generated/scenario.json', JSON.stringify(scenario));
writeFileSync('public/generated/scenario-edits.json', JSON.stringify(edits));
writeFileSync('public/generated/content.json', JSON.stringify(content));
const owned = scenario.owner.filter(Boolean).length;
console.log(`build-data: ${scenario.realms.length} realms, ${owned} owned and ${unowned} unowned land provinces, ${edits.overrides.length} edits, ${scenario.modifiers?.length ?? 0} starting modifiers, ${Object.keys(content.stats).length} stats, ${Object.keys(content.modifiers).length} modifier types, ${content.cultures.length} cultures, ${content.religions.length} religions, ${titles.titles.counties.length}/${titles.titles.duchies.length}/${titles.titles.kingdoms.length}/${titles.titles.empires.length}/${titles.titles.hegemonies.length} counties/duchies/kingdoms/empires/hegemonies, ${goods.goods.length} trade goods, ${Math.round(population.pops.reduce((a, b) => a + b, 0) / 1e6)} million people, ${economy.economy.banks.length} banks, ${rulers.courts.filter(Boolean).length} historical rulers, ${warnings.length} warnings`);
