import { STRATA } from './content';
import { add, type EconomyContext, type Notice } from './economy';
import { indexModifiers, statValue, type ModifierIndex } from './modifiers';
import { nextInt } from './rng';
import { changeStanding } from './standing';
import type { Army, GameState, War } from './state';

/**
 * Armies, wars, marching, supply, battles and occupation (DESIGN §5.5, M7). Men are whole men; strength is in
 * hundredths per 1,000 men (content.military); morale is 0..10000.
 */

const S = STRATA.length;
const MORALE_FULL = 10000;
/** An army smaller than this after a battle or a hard month melts away. */
const SCATTERED = 100;

// ---------- Wars

export function warsOf(state: GameState, realm: number): War[] {
  return state.wars.filter((w) => w.attackers.includes(realm) || w.defenders.includes(realm));
}

export function atWar(state: GameState, a: number, b: number): boolean {
  if (!a || !b || a === b) return false;
  return state.wars.some((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.defenders.includes(a) && w.attackers.includes(b)));
}

/** Realms that fight on a realm's side in any war, itself included. */
export function allies(state: GameState, realm: number): Set<number> {
  const out = new Set([realm]);
  for (const w of warsOf(state, realm)) for (const r of w.attackers.includes(realm) ? w.attackers : w.defenders) out.add(r);
  return out;
}

/** A realm and its direct vassals: who a declaration of war drags in. */
function withVassals(state: GameState, realm: number): number[] {
  return [realm, ...state.realms.filter((r) => r && r.overlord === realm).map((r) => r!.id)];
}

/** Debug and later casus belli: the attacker and its vassals against the defender, its vassals and its overlord. */
export function declareWar(state: GameState, attacker: number, defender: number, cb = 'conquest', goal = 0): War | null {
  const a = state.realms[attacker];
  const d = state.realms[defender];
  if (!a || !d || attacker === defender || atWar(state, attacker, defender)) return null;
  const defenders = withVassals(state, defender);
  if (d.overlord && d.overlord !== attacker && state.realms[d.overlord]) defenders.push(d.overlord);
  const attackers = withVassals(state, attacker).filter((r) => !defenders.includes(r));
  const war: War = { id: state.nextWarId++, name: `${a.name}'s war on ${d.name}`, attackers, defenders, start: state.day, cb, goal: goal || d.capital, battles: 0, ticking: 0 };
  state.wars.push(war);
  return war;
}

/** White peace: every occupied province goes back to its owner, armies stand where they are. */
export function endWar(state: GameState, warId: number): boolean {
  const war = state.wars.find((w) => w.id === warId);
  if (!war) return false;
  state.wars = state.wars.filter((w) => w.id !== warId);
  for (const p of state.provinces) {
    if (p.owner && p.controller !== p.owner && !atWar(state, p.owner, p.controller)) p.controller = p.owner;
  }
  for (const a of state.armies) a.siege = 0;
  return true;
}

// ---------- Raising and paying

function realmPeople(state: GameState, realm: number): number {
  let people = 0;
  for (const p of state.provinces) {
    if (p.owner !== realm || p.controller !== realm) continue;
    for (let i = 0; i < S; i++) people += state.pops[p.id * S + i] ?? 0;
  }
  return people;
}

/** How many levies the realm can call up in all, and how many are under arms now. */
export function levyPool(state: GameState, ctx: EconomyContext, realm: number, index?: ModifierIndex): { total: number; raised: number; menAtArms: number; maxMenAtArms: number } {
  const m = ctx.content.military;
  const size = ctx.content.stats.levy_size ? statValue(state, ctx.content, 'levy_size', { kind: 'realm', id: realm }, index) : 0;
  const full = Math.trunc((realmPeople(state, realm) * size * m.levyShare) / 100000000);
  const total = Math.max(0, full - (state.levyLost[realm] ?? 0));
  let raised = 0;
  let menAtArms = 0;
  for (const a of state.armies) if (a.realm === realm) { raised += a.levies; menAtArms += a.menAtArms; }
  return { total, raised, menAtArms, maxMenAtArms: Math.trunc((full * m.menAtArmsPerThousandLevies) / 1000) };
}

/** The realm's best general: its marshal, else the ruler if grown, else no one. */
function commanderFor(state: GameState, ctx: EconomyContext, realm: number): number {
  const court = state.courts?.[realm];
  if (!court) return 0;
  const marshal = court.council[ctx.content.characters.council.findIndex((c) => c.role === 'marshal')] ?? 0;
  if (marshal && state.characters[marshal]?.died === null) return marshal;
  return court.regent ? 0 : court.ruler;
}

function newArmy(state: GameState, ctx: EconomyContext, realm: number, levies: number, menAtArms: number): Army {
  const army: Army = {
    id: state.nextArmyId++, realm, location: state.realms[realm]!.capital, path: [], progress: 0, levies, menAtArms,
    morale: MORALE_FULL, raised: state.day, ready: state.day + ctx.content.military.musterDays, commander: commanderFor(state, ctx, realm),
    siege: 0, retreating: false, company: 0,
  };
  state.armies.push(army);
  return army;
}

/** Calls up every levy the realm has left, as a new army mustering at the capital. */
export function raiseLevies(state: GameState, ctx: EconomyContext, realm: number): Army | null {
  const r = state.realms[realm];
  if (!r || state.provinces[r.capital]?.controller !== realm) return null;
  const pool = levyPool(state, ctx, realm);
  const men = pool.total - pool.raised;
  if (men < SCATTERED) return null;
  return newArmy(state, ctx, realm, men, 0);
}

/** Hires men-at-arms (whole thousands) at the capital, into an army standing there or a new one. */
export function cannotHire(state: GameState, ctx: EconomyContext, realm: number, men: number): string | null {
  const r = state.realms[realm];
  const m = ctx.content.military.menAtArms;
  if (!r || men <= 0) return 'Nothing to hire.';
  if (state.provinces[r.capital]?.controller !== realm) return 'The capital is occupied.';
  const pool = levyPool(state, ctx, realm);
  if (pool.menAtArms + men > pool.maxMenAtArms) return `The realm can keep ${pool.maxMenAtArms.toLocaleString('en')} men-at-arms at most.`;
  if ((state.economy[realm]?.treasury ?? 0) < Math.trunc((men * m.cost) / 1000)) return 'Not enough in the treasury.';
  return null;
}

export function hireMenAtArms(state: GameState, ctx: EconomyContext, realm: number, men: number): boolean {
  if (cannotHire(state, ctx, realm, men)) return false;
  const cost = Math.trunc((men * ctx.content.military.menAtArms.cost) / 1000);
  const ec = state.economy[realm]!;
  ec.treasury -= cost;
  add(ec.oneOff, 'recruitment', -cost);
  const capital = state.realms[realm]!.capital;
  const here = state.armies.find((a) => a.realm === realm && a.location === capital && !a.path.length && !a.retreating);
  if (here) here.menAtArms += men;
  else newArmy(state, ctx, realm, 0, men);
  return true;
}

/** Splits an army in two halves standing together (to spread out over more provinces' supply). */
export function splitArmy(state: GameState, realm: number, armyId: number): boolean {
  const a = state.armies.find((x) => x.id === armyId && x.realm === realm);
  if (!a || a.retreating || a.company || menOf(a) < 2 * SCATTERED) return false;
  const half: Army = { ...a, id: state.nextArmyId++, path: [], progress: 0, levies: Math.trunc(a.levies / 2), menAtArms: Math.trunc(a.menAtArms / 2) };
  a.levies -= half.levies;
  a.menAtArms -= half.menAtArms;
  state.armies.push(half);
  return true;
}

/** Joins every army of the realm standing in the province, idle, into one. */
export function mergeArmies(state: GameState, realm: number, armyId: number): boolean {
  const a = state.armies.find((x) => x.id === armyId && x.realm === realm);
  if (!a || a.company) return false;
  const others = state.armies.filter((x) => x !== a && !x.company && x.realm === realm && x.location === a.location && !x.retreating && !x.path.length);
  if (!others.length) return false;
  const men = menOf(a) + others.reduce((t, x) => t + menOf(x), 0);
  a.morale = Math.trunc((a.morale * menOf(a) + others.reduce((t, x) => t + x.morale * menOf(x), 0)) / Math.max(1, men));
  for (const x of others) { a.levies += x.levies; a.menAtArms += x.menAtArms; a.raised = Math.min(a.raised, x.raised); a.ready = Math.max(a.ready, x.ready); }
  state.armies = state.armies.filter((x) => !others.includes(x));
  return true;
}

/** Why this company cannot be hired now, or null. */
export function cannotHireCompany(state: GameState, ctx: EconomyContext, realm: number, index: number): string | null {
  const c = ctx.content.war.companies[index];
  const r = state.realms[realm];
  if (!c || !r) return 'No such company.';
  const holder = state.armies.find((a) => a.company === index + 1);
  if (holder) return `In the pay of ${state.realms[holder.realm]?.name}.`;
  if (state.provinces[r.capital]?.controller !== realm) return 'The capital is occupied.';
  if ((state.economy[realm]?.treasury ?? 0) < c.cost) return 'Not enough in the treasury.';
  return null;
}

/** Signs a company: it arrives at the capital and is paid month by month. */
export function hireCompany(state: GameState, ctx: EconomyContext, realm: number, index: number): boolean {
  if (cannotHireCompany(state, ctx, realm, index)) return false;
  const c = ctx.content.war.companies[index]!;
  const ec = state.economy[realm]!;
  ec.treasury -= c.cost;
  add(ec.oneOff, 'recruitment', -c.cost);
  const army = newArmy(state, ctx, realm, 0, c.men);
  army.company = index + 1;
  return true;
}

export function disband(state: GameState, realm: number, armyId: number): boolean {
  const before = state.armies.length;
  state.armies = state.armies.filter((a) => !(a.id === armyId && a.realm === realm));
  return state.armies.length !== before;
}

// ---------- Marching

function edgeDays(ctx: EconomyContext, from: number, to: number): number {
  const g = ctx.graph;
  if (!g) return 0;
  for (let i = g.start[from]!; i < g.start[from + 1]!; i++) if (g.to[i] === to) return g.days[i]!;
  return 0;
}

/** Binary min-heap of [priority, value] for the planner. */
class Heap {
  private readonly items: [number, number][] = [];
  get size() { return this.items.length; }
  push(p: number, v: number) {
    const a = this.items;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up]![0] <= a[i]![0]) break;
      [a[up], a[i]] = [a[i]!, a[up]!];
      i = up;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The quickest march from one province to another (A*, tenths of a day), not counting the start; null if there is
 * no way by land. The estimate is kept low so routes stay near the best.
 */
export function findPath(ctx: EconomyContext, from: number, to: number, maxVisits = 60000): { path: number[]; days: number } | null {
  const g = ctx.graph;
  const pos = ctx.pos;
  if (!g || !pos || from === to || g.start[to] === g.start[to + 1]) return null;
  const km = ctx.kmPerPx ?? 1.4;
  const tx = pos[to * 2]!;
  const ty = pos[to * 2 + 1]!;
  // 25 km a day is faster than any terrain allows, and half the map distance is less than any real one.
  const guess = (p: number) => Math.trunc((Math.hypot(pos[p * 2]! - tx, pos[p * 2 + 1]! - ty) * km * 10 * 0.5) / 25);
  const best = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new Heap();
  open.push(guess(from), from);
  let visited = 0;
  while (open.size) {
    const [, p] = open.pop();
    if (p === to) break;
    if (++visited > maxVisits) return null;
    const d = best.get(p)!;
    for (let i = g.start[p]!; i < g.start[p + 1]!; i++) {
      const q = g.to[i]!;
      const nd = d + g.days[i]!;
      if (nd < (best.get(q) ?? Infinity)) {
        best.set(q, nd);
        prev.set(q, p);
        open.push(nd + guess(q), q);
      }
    }
  }
  if (!best.has(to)) return null;
  const path: number[] = [];
  for (let p = to; p !== from; p = prev.get(p)!) path.push(p);
  return { path: path.reverse(), days: best.get(to)! };
}

/** Orders an army to march; it keeps going until it gets there. */
export function moveArmy(state: GameState, ctx: EconomyContext, realm: number, armyId: number, to: number, maxVisits?: number): boolean {
  const a = state.armies.find((x) => x.id === armyId && x.realm === realm);
  if (!a || a.retreating) return false;
  if (to === a.location) { a.path = []; a.progress = 0; return true; }
  // Mid-march, the new route starts from the province it is heading into.
  const from = a.path.length && a.progress > 0 ? a.path[0]! : a.location;
  const route = from === to ? { path: [] } : findPath(ctx, from, to, maxVisits);
  if (!route) return false;
  if (from !== a.location) a.path = [from, ...route.path];
  else { a.path = route.path; a.progress = 0; }
  return true;
}

function march(state: GameState, ctx: EconomyContext): void {
  for (const a of state.armies) {
    if (!a.path.length || state.day < a.ready) continue;
    a.progress += 10;
    const need = edgeDays(ctx, a.location, a.path[0]!) || 10;
    if (a.progress < need) continue;
    a.location = a.path.shift()!;
    a.progress = 0;
    a.siege = 0;
    if (!a.path.length) a.retreating = false;
  }
}

// ---------- Battle

function warcraft(state: GameState, ctx: EconomyContext, a: Army): number {
  const c = state.characters[a.commander];
  if (!c || c.died !== null) return 10;
  return c.skills[2] ?? 10;
}

/** Fighting strength in hundredths: men by type, the commander's warcraft, and the ground for its holder. */
export function armyStrength(state: GameState, ctx: EconomyContext, a: Army, defending = false): number {
  const m = ctx.content.military;
  const company = ctx.content.war.companies[a.company - 1];
  let s = Math.trunc((a.levies * m.levy.strength + a.menAtArms * (company?.strength ?? m.menAtArms.strength)) / 1000);
  s = Math.trunc((s * (100 + (warcraft(state, ctx, a) - 10) * m.warcraftStrength)) / 100);
  if (defending) {
    const terrain = ctx.terrain?.[a.location];
    s = Math.trunc((s * (m.terrainDefence[terrain ?? ''] ?? 100)) / 100);
  }
  return Math.max(0, s);
}

export const menOf = (a: Army) => a.levies + a.menAtArms;

export function takeLosses(state: GameState, a: Army, dead: number): void {
  const men = menOf(a);
  if (men <= 0) return;
  const lost = Math.min(men, dead);
  const fromLevies = Math.min(a.levies, Math.trunc((lost * a.levies) / men));
  a.levies -= fromLevies;
  if (fromLevies) state.levyLost[a.realm] = (state.levyLost[a.realm] ?? 0) + fromLevies;
  a.menAtArms = Math.max(0, a.menAtArms - (lost - fromLevies));
}

function retreat(state: GameState, ctx: EconomyContext, a: Army, enemies: Set<number>): void {
  const g = ctx.graph;
  if (!g) return;
  let best = 0;
  let bestScore = -1;
  for (let i = g.start[a.location]!; i < g.start[a.location + 1]!; i++) {
    const q = g.to[i]!;
    if (state.armies.some((x) => x.location === q && enemies.has(x.realm))) continue;
    const ctrl = state.provinces[q]?.controller ?? 0;
    const score = allies(state, a.realm).has(ctrl) ? 2 : atWar(state, a.realm, ctrl) ? 0 : 1;
    if (score > bestScore) { best = q; bestScore = score; }
  }
  a.siege = 0;
  if (best) { a.path = [best]; a.progress = 0; a.retreating = true; }
}

/** One day of fighting wherever enemies share a province. */
function fight(state: GameState, ctx: EconomyContext, notices: Notice[]): void {
  const m = ctx.content.military;
  const byPlace = new Map<number, Army[]>();
  for (const a of state.armies) if (!a.retreating && menOf(a) > 0) {
    const list = byPlace.get(a.location);
    if (list) list.push(a); else byPlace.set(a.location, [a]);
  }
  for (const [place, here] of byPlace) {
    if (here.length < 2) continue;
    const first = here[0]!;
    const foes = here.filter((x) => atWar(state, first.realm, x.realm));
    if (!foes.length) continue;
    const friends = here.filter((x) => !foes.includes(x) && !foes.some((f) => !atWar(state, f.realm, x.realm)));
    const holder = state.provinces[place]?.controller ?? 0;
    const sides = [friends, foes];
    const strength = sides.map((side) => side.reduce((t, a) => t + armyStrength(state, ctx, a, allies(state, a.realm).has(holder)), 0));
    const menBefore = sides.map((side) => side.reduce((t, a) => t + menOf(a), 0));
    sides.forEach((side, i) => {
      const men = menBefore[i]!;
      if (!men) return;
      const dead = Math.trunc((strength[1 - i]! * m.casualties * (80 + nextInt(state.rng, 41))) / 10000);
      for (const a of side) {
        const share = Math.trunc((dead * menOf(a)) / men);
        takeLosses(state, a, share);
        a.morale = Math.max(0, a.morale - Math.trunc((share * MORALE_FULL * m.moraleLoss) / Math.max(1, menOf(a) + share) / 100));
      }
    });
    const broken = sides.map((side) => side.every((a) => a.morale <= 0 || menOf(a) < SCATTERED));
    if (!broken[0] && !broken[1]) continue;
    const loser = broken[0] && broken[1] ? (strength[0]! <= strength[1]! ? 0 : 1) : broken[0] ? 0 : 1;
    const winners = sides[1 - loser]!;
    const losers = sides[loser]!;
    const enemyRealms = new Set(winners.map((a) => a.realm));
    for (const a of losers) {
      a.morale = 0;
      if (menOf(a) < SCATTERED) a.levies = a.menAtArms = 0;
      else retreat(state, ctx, a, enemyRealms);
    }
    const win = winners[0]!.realm;
    const lose = losers[0]!.realm;
    const sc = ctx.content.war.score;
    const swing = Math.max(1, Math.min(sc.battleMax, Math.trunc(menBefore[loser]! / sc.battleMen)));
    for (const w of state.wars) {
      if (w.attackers.includes(win) && w.defenders.includes(lose)) w.battles = Math.min(sc.battleCap, w.battles + swing);
      else if (w.defenders.includes(win) && w.attackers.includes(lose)) w.battles = Math.max(-sc.battleCap, w.battles - swing);
    }
    if (menBefore[loser]! >= ctx.content.war.battlePrestigeMen) {
      changeStanding(state, ctx.content, win, { prestige: 10 }, 'Victory in battle');
      changeStanding(state, ctx.content, lose, { prestige: -10 }, 'Defeat in battle');
    }
    const text = `Battle of {province}: ${state.realms[win]?.name} defeated ${state.realms[lose]?.name}.`;
    notices.push({ realm: win, text, province: place }, { realm: lose, text, province: place });
  }
  state.armies = state.armies.filter((a) => menOf(a) > 0);
}

// ---------- Occupation

/** In a raid, each province taken pays the raider in gold. */
export function lootOnCapture(state: GameState, ctx: EconomyContext, realm: number, province: number): void {
  if (!warsOf(state, realm).some((w) => w.cb === 'raid' && w.attackers.includes(realm))) return;
  const gold = Math.trunc(((state.provinceBase.development?.[province] ?? 0) * ctx.content.war.raidLoot) / 100);
  const ec = state.economy[realm];
  if (ec && gold) { ec.treasury += gold; add(ec.oneOff, 'loot', gold); }
}

function occupy(state: GameState, ctx: EconomyContext, notices: Notice[]): void {
  const m = ctx.content.military;
  for (const a of state.armies) {
    if (a.path.length || a.retreating || state.day < a.ready) continue;
    const p = state.provinces[a.location];
    if (!p || !p.owner || state.forts[a.location]) continue;
    const side = allies(state, a.realm);
    const enemyHolds = atWar(state, a.realm, p.controller);
    if (!enemyHolds) { a.siege = 0; continue; }
    if (state.armies.some((x) => x.location === a.location && !x.retreating && atWar(state, a.realm, x.realm))) continue;
    a.siege++;
    const need = Math.max(m.occupyMin, Math.trunc((m.occupyDays * 1000) / Math.max(1, menOf(a))));
    if (a.siege < need) continue;
    const before = p.controller;
    p.controller = side.has(p.owner) ? p.owner : a.realm;
    for (const x of state.armies) if (x.location === a.location) x.siege = 0;
    lootOnCapture(state, ctx, a.realm, p.id);
    const text = `${state.realms[a.realm]?.name} has occupied {province}.`;
    notices.push({ realm: before, text, province: p.id }, { realm: a.realm, text, province: p.id });
  }
}

// ---------- The month

function attrition(state: GameState, ctx: EconomyContext, index: ModifierIndex, notices: Notice[]): void {
  const m = ctx.content.military;
  const d = ctx.content.war.desertion;
  for (const a of [...state.armies]) {
    if ((state.economy[a.realm]?.treasury ?? 0) < 0) {
      const company = ctx.content.war.companies[a.company - 1];
      if (company) {
        state.armies = state.armies.filter((x) => x !== a);
        notices.push({ realm: a.realm, text: `${company.name}, unpaid, has walked out.` });
        continue;
      }
      takeLosses(state, a, Math.trunc((menOf(a) * d.share) / 100));
      a.morale = Math.max(0, a.morale - d.morale * 100);
    }
    const men = menOf(a);
    const p = state.provinces[a.location];
    if (!p || !men) continue;
    const limitStat = ctx.content.stats.supply_limit ? statValue(state, ctx.content, 'supply_limit', { kind: 'province', id: p.id }, index) : 100000;
    let limit = Math.trunc(limitStat * 10); // hundredths of thousands → men
    if (atWar(state, a.realm, p.controller)) limit = Math.trunc((limit * m.hostileSupply) / 100);
    else if (allies(state, a.realm).has(p.controller)) limit = Math.trunc((limit * m.homeSupply) / 100);
    if (men > limit && m.attrition) {
      const pct = Math.min(m.attritionMax * 100, Math.trunc(((men - limit) * m.attrition * 100) / Math.max(1, limit)));
      takeLosses(state, a, Math.max(1, Math.trunc((men * pct) / 10000)));
    }
    a.morale = Math.min(MORALE_FULL, a.morale + m.moraleRegain * 100);
    if (a.commander && state.characters[a.commander]?.died !== null) a.commander = commanderFor(state, ctx, a.realm);
  }
  state.armies = state.armies.filter((x) => menOf(x) >= SCATTERED || x.retreating);
  for (const key of Object.keys(state.levyLost)) {
    const realm = Number(key);
    const back = Math.max(100, Math.trunc((levyPool(state, ctx, realm, index).total + state.levyLost[key]!) * ctx.content.war.levyRecovery / 100));
    state.levyLost[key] = state.levyLost[key]! - back;
    if (state.levyLost[key]! <= 0) delete state.levyLost[key];
  }
}

/** Every day: march, fight, occupy. At month start, supply and morale. Then the realms that are not the player's act. */
export function dailyMilitary(state: GameState, ctx: EconomyContext, monthStart: boolean): Notice[] {
  const notices: Notice[] = [];
  if (!state.armies.length && !state.wars.length) return notices;
  march(state, ctx);
  fight(state, ctx, notices);
  occupy(state, ctx, notices);
  if (monthStart) {
    attrition(state, ctx, indexModifiers(state.modifiers), notices);
    // At peace, realms the player does not rule send their men home.
    state.armies = state.armies.filter((a) => a.realm === state.player || warsOf(state, a.realm).length > 0);
  }
  warAi(state, ctx);
  return notices;
}

// ---------- The realms at war that the player does not rule

const AI_EVERY = 5;
/** The AI plans only marches it can find quickly; a target out of reach sends the army home. */
const AI_SEARCH = 4000;

function nearest(ctx: EconomyContext, from: number, targets: number[]): number {
  const pos = ctx.pos;
  if (!pos || !targets.length) return 0;
  const x = pos[from * 2]!;
  const y = pos[from * 2 + 1]!;
  let best = 0;
  let bestD = Infinity;
  for (const t of targets) {
    const d = (pos[t * 2]! - x) ** 2 + (pos[t * 2 + 1]! - y) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * A simple general: call up the levies; win back the realm's own land; fall on enemy armies on it that are not much
 * stronger; if the realm's side is the stronger, march on the nearest enemy province; else hold the capital.
 */
function warAi(state: GameState, ctx: EconomyContext): void {
  const atWarNow = new Set<number>();
  for (const w of state.wars) for (const r of [...w.attackers, ...w.defenders]) atWarNow.add(r);
  for (const realm of atWarNow) {
    if (realm === state.player || !state.realms[realm] || (state.day + realm) % AI_EVERY !== 0) continue;
    if (!state.armies.some((a) => a.realm === realm)) raiseLevies(state, ctx, realm);
    const enemies = new Set<number>();
    for (const w of warsOf(state, realm)) for (const r of w.attackers.includes(realm) ? w.defenders : w.attackers) enemies.add(r);
    const side = allies(state, realm);
    const men = (rs: Set<number>) => state.armies.reduce((t, a) => t + (rs.has(a.realm) ? menOf(a) : 0), 0);
    const strong = men(side) * 10 >= men(enemies) * 12;
    const lost: number[] = [];
    const theirs: number[] = [];
    for (const p of state.provinces) {
      if (!p.owner) continue;
      if (p.owner === realm && enemies.has(p.controller)) lost.push(p.id);
      else if (enemies.has(p.controller) && enemies.has(p.owner)) theirs.push(p.id);
    }
    for (const a of state.armies) {
      if (a.realm !== realm || a.retreating || state.day < a.ready || a.morale < 5000) continue;
      if (a.path.length) continue;
      const mine = menOf(a);
      const prey = state.armies.filter((e) => enemies.has(e.realm) && !e.retreating && state.provinces[e.location]?.owner === realm && menOf(e) * 10 <= mine * 13);
      const target = nearest(ctx, a.location, prey.map((e) => e.location))
        || nearest(ctx, a.location, lost)
        || (strong ? nearest(ctx, a.location, theirs) : 0)
        || state.realms[realm]!.capital;
      const home = state.realms[realm]!.capital;
      if (target !== a.location && !moveArmy(state, ctx, realm, a.id, target, AI_SEARCH) && a.location !== home) moveArmy(state, ctx, realm, a.id, home);
    }
  }
}
