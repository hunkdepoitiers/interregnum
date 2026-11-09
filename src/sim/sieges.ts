import type { WarDef } from './content';
import { add, type EconomyContext, type Notice } from './economy';
import { allies, atWar, lootOnCapture, menOf, takeLosses } from './military';
import { nextInt } from './rng';
import { changeStanding } from './standing';
import type { Army, Fort, GameState, Siege } from './state';

/**
 * Forts and sieges (DESIGN §5.6, M8). A fortified province cannot be taken just by standing in it: its besiegers
 * wear the fort down day by day, may storm it or buy it, and its garrison starves once the stores run out.
 */

const LOG_LENGTH = 8;

function fortAt(development: number, capitalRank: string | null, centre: boolean, w: WarDef): number {
  let level = 0;
  for (const [min, l] of w.forts.development) if (development >= min! && l! > level) level = l!;
  if (capitalRank) level = Math.max(level, w.forts.capital[capitalRank as keyof typeof w.forts.capital] ?? 0);
  if (centre) level += w.forts.tradeCentre;
  return Math.min(w.forts.maxLevel, level);
}

export const fullGarrison = (w: WarDef, level: number) => level * w.forts.garrisonPerLevel;
export const fullStores = (w: WarDef, level: number) => w.forts.supplyBase + level * w.forts.supplyPerLevel;

function setFort(state: GameState, w: WarDef, province: number, level: number): void {
  if (level > 0) state.forts[province] = { level, garrison: fullGarrison(w, level), supply: fullStores(w, level) };
}

/** Builds the fort of every province from its development, capitals and trade centres. */
export function startForts(state: GameState, ctx: EconomyContext): void {
  const w = ctx.content.war;
  state.forts = {};
  const capital = new Map<number, string>();
  for (const r of state.realms) if (r) capital.set(r.capital, r.rank);
  for (const p of state.provinces) {
    if (!p.owner) continue;
    const dev = Math.trunc((state.provinceBase.development?.[p.id] ?? 0) / 100);
    setFort(state, w, p.id, fortAt(dev, capital.get(p.id) ?? null, !!ctx.centres?.[p.id], w));
  }
}

const logIt = (s: Siege, day: number, text: string) => {
  s.log.push({ day, text });
  if (s.log.length > LOG_LENGTH) s.log.shift();
};

function besiegers(state: GameState, province: number, controller: number): Army[] {
  return state.armies.filter((a) => a.location === province && !a.path.length && !a.retreating && state.day >= a.ready && atWar(state, a.realm, controller));
}

function bestWarcraft(state: GameState, armies: Army[]): number {
  return armies.reduce((b, a) => Math.max(b, state.characters[a.commander]?.skills[2] ?? 10), 0);
}

/** A day's progress on a siege, in hundredths of a percent. */
export function dailyProgress(state: GameState, w: WarDef, s: Siege, fort: Fort, armies: Army[]): number {
  const men = armies.reduce((t, a) => t + menOf(a), 0);
  const ratio = Math.max(w.siege.menMin, Math.min(w.siege.menMax, Math.trunc((men * 100) / Math.max(1, fort.garrison * 3))));
  let p = Math.trunc((w.siege.progress * ratio) / 100);
  p = Math.trunc((p * (100 + (bestWarcraft(state, armies) - 10) * w.siege.warcraft + s.engineers * w.siege.engineerBonus)) / 100);
  if (fort.supply <= 0) p = Math.trunc((p * w.siege.starvingProgress) / 100);
  return Math.max(1, Math.trunc(p / fort.level));
}

export function assaultChance(state: GameState, w: WarDef, s: Siege, fort: Fort, armies: Army[]): number {
  const a = w.assault;
  const men = armies.reduce((t, x) => t + menOf(x), 0);
  const ratio = Math.max(-a.ratioCap, Math.min(a.ratioCap, Math.trunc(((men - 3 * fort.garrison) * a.perRatio) / Math.max(1, fort.garrison))));
  const c = a.base + Math.trunc((s.progress * a.perProgress) / 100) + (s.breach ? a.breach : 0) + ratio - fort.level * a.perLevel;
  return Math.max(a.min, Math.min(a.max, c));
}

export function bribeChance(state: GameState, w: WarDef, s: Siege, fort: Fort, tier: number, controller: number): number {
  const b = w.bribe;
  const unpaid = (state.economy[controller]?.treasury ?? 0) < 0 ? b.unpaidBonus : 0;
  const ruler = state.characters[state.courts[s.realm]?.ruler ?? 0];
  const eminence = ((ruler?.skills[0] ?? 10) - 10) * b.perEminence;
  return Math.max(0, Math.min(9500, (b.chances[tier] ?? 0) + unpaid + eminence - fort.level * b.perLevel));
}

export const bribeCost = (w: WarDef, fort: Fort, tier: number) => w.bribe.cost * fort.level * (tier + 1);

function fall(state: GameState, ctx: EconomyContext, s: Siege, how: string, notices: Notice[]): void {
  const p = state.provinces[s.province]!;
  const w = ctx.content.war;
  const fort = state.forts[s.province]!;
  const loser = p.controller;
  p.controller = allies(state, s.realm).has(p.owner) ? p.owner : s.realm;
  fort.garrison = Math.trunc((fullGarrison(w, fort.level) * w.forts.capturedGarrison) / 100);
  fort.supply = fullStores(w, fort.level);
  changeStanding(state, ctx.content, s.realm, { prestige: w.siege.prestige }, 'A fortress taken');
  lootOnCapture(state, ctx, s.realm, s.province);
  state.sieges = state.sieges.filter((x) => x !== s);
  for (const a of state.armies) if (a.location === s.province) a.siege = 0;
  const text = `${state.realms[s.realm]?.name} ${how} {province}.`;
  notices.push({ realm: loser, text, province: s.province }, { realm: s.realm, text, province: s.province });
}

function dayEvent(state: GameState, ctx: EconomyContext, s: Siege, fort: Fort, armies: Army[], notices: Notice[]): void {
  const e = ctx.content.war.siege;
  if (nextInt(state.rng, 10000) >= e.eventChance) return;
  const entries = (Object.entries(e.events) as [keyof typeof e.events, { weight: number; text: string }][])
    .filter(([k, v]) => v.weight > 0 && (k !== 'traitor' || fort.supply <= e.traitorStores));
  const total = entries.reduce((t, [, v]) => t + v.weight, 0);
  if (!total) return;
  let roll = nextInt(state.rng, total);
  const picked = entries.find(([, v]) => (roll -= v.weight) < 0);
  if (!picked) return;
  const [key, ev] = picked;
  logIt(s, state.day, ev.text);
  const hit = (pct: number) => { for (const a of armies) takeLosses(state, a, Math.trunc((menOf(a) * pct) / 100)); };
  if (key === 'disease') hit(e.diseaseLoss);
  else if (key === 'sally') { hit(e.sallyLoss); fort.garrison -= Math.trunc((fort.garrison * e.sallyGarrisonLoss) / 100); }
  else if (key === 'breach') { s.breach = true; s.progress = Math.min(10000, s.progress + e.breachProgress); }
  else if (key === 'stores_lost') fort.supply = Math.max(0, fort.supply - e.storesLostDays);
  else fall(state, ctx, s, 'was let in by a traitor at', notices);
}

/** Every day: sieges begin, grind on, break up or end. At month start, idle garrisons fill up. */
export function dailySieges(state: GameState, ctx: EconomyContext, monthStart: boolean): Notice[] {
  const w = ctx.content.war;
  const notices: Notice[] = [];
  for (const a of state.armies) {
    if (a.path.length || a.retreating || state.day < a.ready || !state.forts[a.location]) continue;
    const p = state.provinces[a.location]!;
    if (!atWar(state, a.realm, p.controller) || state.sieges.some((s) => s.province === a.location)) continue;
    state.sieges.push({ province: a.location, realm: a.realm, start: state.day, progress: 0, engineers: 0, breach: false, nextAssault: 0, nextBribe: 0, log: [] });
  }
  for (const s of [...state.sieges]) {
    const p = state.provinces[s.province]!;
    const fort = state.forts[s.province];
    const armies = fort ? besiegers(state, s.province, p.controller) : [];
    if (!fort || !armies.length) { state.sieges = state.sieges.filter((x) => x !== s); continue; }
    if (!armies.some((a) => a.realm === s.realm)) s.realm = armies[0]!.realm;
    if (state.armies.some((x) => x.location === s.province && !x.retreating && atWar(state, x.realm, s.realm))) continue; // a relieving army: fight first
    if (fort.supply > 0) fort.supply--;
    else fort.garrison -= Math.max(1, Math.trunc((fort.garrison * w.siege.starvingLoss) / 100));
    s.progress = Math.min(10000, s.progress + dailyProgress(state, w, s, fort, armies));
    if (s.progress >= 10000 || fort.garrison <= 0) { fall(state, ctx, s, fort.garrison <= 0 ? 'starved out' : 'took', notices); continue; }
    dayEvent(state, ctx, s, fort, armies, notices);
    if (state.sieges.includes(s) && s.realm !== state.player && state.day % 10 === 0 && state.day >= s.nextAssault && assaultChance(state, w, s, fort, armies) >= 6000) assault(state, ctx, s.realm, s.province, notices);
  }
  if (monthStart) {
    for (const [id, fort] of Object.entries(state.forts)) {
      if (state.sieges.some((s) => s.province === Number(id))) continue;
      fort.garrison = Math.min(fullGarrison(w, fort.level), fort.garrison + Math.ceil((fullGarrison(w, fort.level) * w.forts.refill) / 100));
      fort.supply = fullStores(w, fort.level);
    }
  }
  state.armies = state.armies.filter((a) => menOf(a) > 0);
  return notices;
}

function ownSiege(state: GameState, realm: number, province: number): Siege | null {
  const s = state.sieges.find((x) => x.province === province);
  return s && state.armies.some((a) => a.location === province && a.realm === realm && !a.path.length && !a.retreating) ? s : null;
}

/** Storms the walls now: the odds are shown first, and failure is bloody. */
export function assault(state: GameState, ctx: EconomyContext, realm: number, province: number, notices: Notice[]): boolean {
  const s = ownSiege(state, realm, province);
  const w = ctx.content.war;
  const fort = state.forts[province];
  if (!s || !fort || state.day < s.nextAssault) return false;
  const armies = besiegers(state, province, state.provinces[province]!.controller);
  if (!armies.length) return false;
  const chance = assaultChance(state, w, s, fort, armies);
  const men = armies.reduce((t, a) => t + menOf(a), 0);
  const won = nextInt(state.rng, 10000) < chance;
  const dead = fort.garrison * (won ? w.assault.lossesWon : w.assault.lossesLost);
  for (const a of armies) {
    takeLosses(state, a, Math.trunc((dead * menOf(a)) / Math.max(1, men)));
    if (!won) a.morale = Math.max(0, a.morale - w.assault.moraleLost * 100);
  }
  s.nextAssault = state.day + w.assault.cooldown;
  if (won) fall(state, ctx, s, 'stormed', notices);
  else {
    fort.garrison -= Math.trunc((fort.garrison * w.assault.garrisonLost) / 100);
    logIt(s, state.day, 'An assault was thrown back from the walls.');
    if (fort.garrison <= 0) fall(state, ctx, s, 'stormed', notices);
  }
  state.armies = state.armies.filter((a) => menOf(a) > 0);
  return true;
}

export function bribe(state: GameState, ctx: EconomyContext, realm: number, province: number, tier: number, notices: Notice[]): boolean {
  const s = ownSiege(state, realm, province);
  const w = ctx.content.war;
  const fort = state.forts[province];
  const ec = state.economy[realm];
  if (!s || !fort || !ec || state.day < s.nextBribe || tier < 0 || tier >= w.bribe.chances.length) return false;
  const cost = bribeCost(w, fort, tier);
  if (ec.treasury < cost) return false;
  ec.treasury -= cost;
  add(ec.oneOff, 'recruitment', -cost);
  s.realm = realm;
  s.nextBribe = state.day + w.bribe.cooldown;
  if (nextInt(state.rng, 10000) < bribeChance(state, w, s, fort, tier, state.provinces[province]!.controller)) fall(state, ctx, s, 'bought the gates of', notices);
  else logIt(s, state.day, 'The garrison took the gold and kept the gates shut.');
  return true;
}

export function hireEngineers(state: GameState, ctx: EconomyContext, realm: number, province: number): boolean {
  const s = ownSiege(state, realm, province);
  const w = ctx.content.war.siege;
  const ec = state.economy[realm];
  if (!s || !ec || s.engineers >= w.maxEngineers || ec.treasury < w.engineerCost) return false;
  ec.treasury -= w.engineerCost;
  add(ec.oneOff, 'recruitment', -w.engineerCost);
  s.engineers++;
  logIt(s, state.day, 'Engineers join the siege works.');
  return true;
}
