/**
 * Runs the built game headless for some years and prints the money of the biggest realms each year, for balancing:
 *   npx tsx tools/run-years.ts [years=10] [realm keys...]
 * Reads public/generated/{scenario,content}.json, so run build-data first.
 */
import { readFileSync } from 'node:fs';
import type { Content } from '../src/sim/content';
import { computeLedgers, ducats, LEDGER, startEconomy, type EconomyContext } from '../src/sim/economy';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const years = Number(process.argv[2] ?? 10);
const scenario = JSON.parse(readFileSync('public/generated/scenario.json', 'utf8')) as Scenario;
const content = JSON.parse(readFileSync('public/generated/content.json', 'utf8')) as Content;
const ctx: EconomyContext = { content, goods: scenario.good ?? [], centres: scenario.tradeCentre ?? [] };
const state = newGame(1314, scenario, content.economy.banks.map((b) => b.capital));
startEconomy(state, ctx);

const keys = process.argv.slice(3);
const watched = (keys.length ? keys : ['france', 'england', 'castile', 'venice', 'golden_horde', 'mamluks', 'yuan', 'delhi', 'papal_states', 'scotland'])
  .map((k) => state.realms.findIndex((r) => r?.key === k)).filter((i) => i > 0);

function report(label: string) {
  const ledgers = computeLedgers(state, ctx);
  console.log(`\n${label}`);
  for (const id of watched) {
    const l = ledgers[id]!;
    const inc = LEDGER.filter((c) => c.kind === 'income').reduce((a, c) => a + (l[c.key] ?? 0), 0);
    const exp = LEDGER.filter((c) => c.kind === 'expense').reduce((a, c) => a + (l[c.key] ?? 0), 0);
    console.log(`  ${state.realms[id]!.name.padEnd(28)} treasury ${ducats(state.economy[id]!.treasury).padStart(12)}  month +${ducats(inc).padStart(8)} ${ducats(exp).padStart(8)}`);
  }
}

const people = () => Math.round(state.pops.reduce((a, b) => a + b, 0) / 1e5) / 10;
report(`Start, ${people()} million people`);
const t0 = performance.now();
let months = 0;
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 365; d++) if (tick(state, ctx).monthStart) months++;
  report(`Year ${y}, ${people()} million people`);
}
console.log(`\n${months} months settled, ${((performance.now() - t0) / months).toFixed(1)} ms per month on average (with the daily ticks)`);
const broke = state.economy.filter((e, i) => e && state.realms[i] && e.treasury < 0).length;
console.log(`${broke} realms in debt: ${state.economy.map((e, i) => (e && e.treasury < 0 ? state.realms[i]?.key : null)).filter(Boolean).join(', ')}`);
