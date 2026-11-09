/**
 * Runs the built game headless for some years and prints the money of the biggest realms each year, for balancing:
 *   npx tsx tools/run-years.ts [years=10] [realm keys...] [--war attacker,defender]
 * Reads public/generated/{scenario,content}.json, so run build-data first.
 */
import { readFileSync } from 'node:fs';
import type { Content } from '../src/sim/content';
import { computeLedgers, ducats, LEDGER, startEconomy, type EconomyContext } from '../src/sim/economy';
import type { Scenario } from '../src/sim/scenario';
import { ageOf, startCharacters } from '../src/sim/characters';
import { startFaith, tiersOf } from '../src/sim/faith';
import { declareWar } from '../src/sim/military';
import { startForts } from '../src/sim/sieges';
import { warScore } from '../src/sim/war';
import { startDiplomacy } from '../src/sim/diplomacy';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const years = Number(process.argv[2] ?? 10);
const scenario = JSON.parse(readFileSync('public/generated/scenario.json', 'utf8')) as Scenario;
const content = JSON.parse(readFileSync('public/generated/content.json', 'utf8')) as Content;
const ctx: EconomyContext = {
  content, goods: scenario.good ?? [], centres: scenario.tradeCentre ?? [], seats: scenario.seats ?? [],
  culture: scenario.culture ?? [], religion: scenario.religion ?? [],
  county: scenario.county ?? [], graph: scenario.graph, pos: scenario.pos, kmPerPx: scenario.kmPerPx, terrain: scenario.terrain,
};
const state = newGame(1314, scenario, content.economy.banks.map((b) => b.capital));
startCharacters(state, ctx);
startEconomy(state, ctx);
startFaith(state, ctx);
startForts(state, ctx);
startDiplomacy(state, ctx);

const warAt = process.argv.indexOf('--war');
const warPair = warAt > 0 ? process.argv[warAt + 1]!.split(',') : null;
const keys = process.argv.slice(3).filter((_, i, all) => all[i] !== '--war' && all[i - 1] !== '--war');
if (warPair) {
  const id = (k: string) => state.realms.find((r) => r?.key === k)?.id ?? 0;
  const w = declareWar(state, id(warPair[0]!), id(warPair[1]!));
  console.log(`War: ${w?.attackers.map((r) => state.realms[r]!.key).join(', ')} against ${w?.defenders.map((r) => state.realms[r]!.key).join(', ')}`);
}
const watched = (keys.length ? keys : ['france', 'england', 'castile', 'venice', 'golden_horde', 'mamluks', 'yuan', 'delhi', 'papal_states', 'scotland'])
  .map((k) => state.realms.findIndex((r) => r?.key === k)).filter((i) => i > 0);

function report(label: string) {
  const ledgers = computeLedgers(state, ctx);
  console.log(`\n${label}`);
  for (const id of watched) {
    const l = ledgers[id]!;
    const inc = LEDGER.filter((c) => c.kind === 'income').reduce((a, c) => a + (l[c.key] ?? 0), 0);
    const exp = LEDGER.filter((c) => c.kind === 'expense').reduce((a, c) => a + (l[c.key] ?? 0), 0);
    const court = state.courts[id];
    const ruler = court ? state.characters[court.ruler] : null;
    const who = ruler ? `${ruler.name} ${state.dynasties[ruler.dynasty]?.name ?? ''} (${ageOf(ruler, state.day)})${court?.regent ? ' regency' : ''}${court?.claimant ? ' +claimant' : ''}` : '';
    const st = state.standing[id]!;
    const t = tiersOf(state, ctx, id)!;
    console.log(`  ${state.realms[id]!.name.padEnd(28)} treasury ${ducats(state.economy[id]!.treasury).padStart(12)}  month +${ducats(inc).padStart(8)} ${ducats(exp).padStart(8)}  P ${String(st.prestige).padStart(5)} ${t.prestigeName.padEnd(11)} F ${String(st.piety).padStart(5)} ${t.pietyName.padEnd(10)} ${who}`);
  }
}

const people = () => Math.round(state.pops.reduce((a, b) => a + b, 0) / 1e5) / 10;
report(`Start, ${people()} million people`);
const t0 = performance.now();
let months = 0;
const tally = { successions: 0, regencies: 0, newHouses: 0, comingOfAge: 0, embezzled: 0 };
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 365; d++) {
    const r = tick(state, ctx);
    if (r.monthStart) months++;
    for (const n of r.notices) {
      if (n.text.includes('has died')) tally.successions++;
      if (n.text.includes('regency of')) tally.regencies++;
      if (n.text.includes('come of age')) tally.comingOfAge++;
      if (n.text.includes('helped himself')) tally.embezzled++;
      if (/^(The Bruce|Morgarten|Mühldorf)/.test(n.text)) console.log(`  [y${y}] ${n.text}`);
      if (/risen in revolt|has invaded|forced you|formed a faction/.test(n.text)) console.log(`  [y${y}] ${n.realm ? state.realms[n.realm]?.key : 'all'}: ${n.text}`);
    }
  }
  if (y % (years > 20 ? 10 : 1) === 0 || y === years) report(`Year ${y}, ${people()} million people`);
}
if (warPair) {
  const occupied = state.provinces.filter((p) => p.owner && p.controller !== p.owner);
  const by = new Map<string, number>();
  for (const p of occupied) { const k = `${state.realms[p.controller]?.key} holds ${state.realms[p.owner]?.key}`; by.set(k, (by.get(k) ?? 0) + 1); }
  console.log(`armies: ${state.armies.map((a) => `${state.realms[a.realm]?.key} ${a.levies}+${a.menAtArms} @${a.location} m${Math.trunc(a.morale / 100)}`).join('; ')}`);
  console.log(`wars: ${state.wars.map((w) => `${w.name} ${JSON.stringify(warScore(state, ctx, w))}`).join('; ') || 'none left'}; sieges ${state.sieges.length}; forts ${Object.keys(state.forts).length}`);
  console.log(`occupied: ${[...by].map(([k, n]) => `${k}: ${n}`).join(', ')}`);
}
console.log(`events done: ${state.eventsDone.length}; pulses on cooldown: ${Object.keys(state.eventCooldowns).length}; ${state.realms.find((r) => r?.key === 'ottomans') ? `Bursa owner ${state.realms[state.provinces[content.events.places.bursa!]!.owner]?.key}` : ''}`);
const ex = state.modifiers.filter((m) => m.def === 'excommunicated').length;
console.log(`excommunicated now: ${ex}; prestige range ${Math.min(...state.standing.filter(Boolean).map((x) => x!.prestige))}..${Math.max(...state.standing.filter(Boolean).map((x) => x!.prestige))}, piety range ${Math.min(...state.standing.filter(Boolean).map((x) => x!.piety))}..${Math.max(...state.standing.filter(Boolean).map((x) => x!.piety))}`);
tally.newHouses = state.modifiers.filter((m) => m.def === 'dynasty_change').length;
const living = state.characters.filter((c) => c && c.died === null).length;
console.log(`
${JSON.stringify(tally)}; ${state.characters.length - 1} characters ever, ${living} living; ${state.courts.filter((c) => c?.regent).length} regencies now, ${state.courts.filter((c) => c?.claimant).length} claimants now`);
console.log(`\n${months} months settled, ${((performance.now() - t0) / months).toFixed(1)} ms per month on average (with the daily ticks)`);
const broke = state.economy.filter((e, i) => e && state.realms[i] && e.treasury < 0).length;
console.log(`${broke} realms in debt: ${state.economy.map((e, i) => (e && e.treasury < 0 ? state.realms[i]?.key : null)).filter(Boolean).join(', ')}`);
