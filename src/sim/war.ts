import { add, ledgerIncome, type EconomyContext, type Notice } from './economy';
import { addTruce, allied, callToArms, marriageOf, truceUntil } from './diplomacy';
import { declareWar, endWar } from './military';
import { realmFaith } from './faith';
import { changeStanding } from './standing';
import type { GameState, War } from './state';

/** Casus belli, war score and peace (DESIGN §5.5, M8). War score runs from the attackers' side: −100 to 100. */

const leader = (w: War, attackers: boolean) => (attackers ? w.attackers[0]! : w.defenders[0]!);

/** A province's worth in a war: development, and far more if fortified. */
function value(state: GameState, province: number): number {
  return Math.max(1, Math.trunc((state.provinceBase.development?.[province] ?? 100) / 100)) * (1 + (state.forts[province]?.level ?? 0));
}

function kingdomOf(ctx: EconomyContext, province: number): number {
  const t = ctx.content.titles;
  const county = t.counties[(ctx.county?.[province] ?? 0) - 1];
  return (county && t.duchies[county.parent - 1]?.parent) || 0;
}

/** A province of the defender in a de jure kingdom where the attacker holds land too; 0 = no claim. */
function claimProvince(state: GameState, ctx: EconomyContext, attacker: number, defender: number): number {
  const mine = new Set<number>();
  for (const p of state.provinces) if (p.owner === attacker) { const k = kingdomOf(ctx, p.id); if (k) mine.add(k); }
  let best = 0;
  let bestV = 0;
  for (const p of state.provinces) if (p.owner === defender && mine.has(kingdomOf(ctx, p.id))) {
    const v = value(state, p.id);
    if (v > bestV) { bestV = v; best = p.id; }
  }
  return best;
}

export interface CasusBelliOption { key: string; name: string; description: string; prestige: number; piety: number; why: string | null }

/** Every reason for war, and why this one cannot be used (null = it can). */
export function casusBelli(state: GameState, ctx: EconomyContext, attacker: number, defender: number): CasusBelliOption[] {
  const a = state.realms[attacker];
  const d = state.realms[defender];
  const s = state.standing[attacker];
  if (!a || !d || !s || attacker === defender) return [];
  const rel = ctx.content.religions;
  const fa = rel[realmFaith(state, ctx, attacker) - 1];
  const fd = rel[realmFaith(state, ctx, defender) - 1];
  const dip = ctx.content.diplomacy;
  const truce = truceUntil(state, attacker, defender);
  return ctx.content.war.casusBelli.map((c) => {
    let why: string | null = null;
    const prestige = c.prestige + (marriageOf(state, attacker, defender) ? dip.marriage.warPrestige : 0);
    if (c.key === 'claim' && !claimProvince(state, ctx, attacker, defender)) why = 'You share no de jure kingdom.';
    if (c.key === 'holy_war' && (!fa || !fd || fa.family === fd.family)) why = 'They are of your own family of faiths.';
    if (c.key === 'raid' && (!fa || !fd || fa.key === fd.key)) why = 'They share your faith.';
    if (c.key === 'independence' && a.overlord !== defender) why = 'They are not your overlord.';
    if (c.key !== 'independence' && a.overlord === defender) why = 'You may only rebel against your overlord.';
    if (c.governments.length && !c.governments.includes(a.government)) why = 'Your kind of realm does not wage this war.';
    if (s.piety < c.minPiety) why = `Needs ${c.minPiety} piety.`;
    if (allied(state, attacker, defender)) why = 'You are allied to them.';
    if (truce) why = `A truce binds you for ${truce - state.day} days.`;
    return { key: c.key, name: c.name, description: c.description, prestige, piety: c.piety, why };
  });
}

/** Goes to war for a stated reason, paying its cost in standing. */
export function declareFor(state: GameState, ctx: EconomyContext, attacker: number, defender: number, key: string, notices?: Notice[]): War | null {
  const c = casusBelli(state, ctx, attacker, defender).find((x) => x.key === key);
  if (!c || c.why) return null;
  const goal = key === 'claim' ? claimProvince(state, ctx, attacker, defender) : state.realms[defender]!.capital;
  const war = declareWar(state, attacker, defender, key, goal);
  if (war) {
    changeStanding(state, ctx.content, attacker, { prestige: c.prestige, piety: c.piety }, c.name);
    const called = callToArms(state, ctx, war);
    notices?.push(...called);
  }
  return war;
}

export interface ScoreLines { score: number; occupation: number; battles: number; ticking: number }

/** The war's score: land held by each side, battles and the goal. */
export function warScore(state: GameState, ctx: EconomyContext, war: War): ScoreLines {
  const a = new Set(war.attackers);
  const d = new Set(war.defenders);
  let aTotal = 0; let dTotal = 0; let aHeld = 0; let dHeld = 0;
  for (const p of state.provinces) {
    if (a.has(p.owner)) { const v = value(state, p.id); aTotal += v; if (d.has(p.controller)) aHeld += v; }
    else if (d.has(p.owner)) { const v = value(state, p.id); dTotal += v; if (a.has(p.controller)) dHeld += v; }
  }
  const occupation = Math.min(60, Math.trunc((dHeld * 100) / Math.max(1, dTotal))) - Math.min(60, Math.trunc((aHeld * 100) / Math.max(1, aTotal)));
  const score = Math.max(-100, Math.min(100, occupation + war.battles + war.ticking));
  return { score, occupation, battles: war.battles, ticking: war.ticking };
}

export interface PeaceTerms {
  /** Land the loser gives up (occupied by the winner's side). */
  cede: number[];
  /** Months of the loser's gross income paid at once. */
  months: number;
  /** The loser pays tribute for some years. */
  tribute?: boolean;
}

/** The land the winning side could take: held by it, owned by the other side. */
export function landOnOffer(state: GameState, war: War, winnerAttackers: boolean): number[] {
  const win = new Set(winnerAttackers ? war.attackers : war.defenders);
  const lose = new Set(winnerAttackers ? war.defenders : war.attackers);
  return state.provinces.filter((p) => lose.has(p.owner) && win.has(p.controller)).map((p) => p.id);
}

/** War score the terms are worth. */
export function peaceCost(state: GameState, ctx: EconomyContext, war: War, winnerAttackers: boolean, terms: PeaceTerms): number {
  const w = ctx.content.war.peace;
  let land = 0;
  if (terms.cede.length) {
    const lose = new Set(winnerAttackers ? war.defenders : war.attackers);
    let total = 0;
    for (const p of state.provinces) if (lose.has(p.owner)) total += value(state, p.id);
    const taken = terms.cede.reduce((t, p) => t + value(state, p), 0);
    land = Math.max(1, Math.trunc((taken * w.land) / Math.max(1, total)));
  }
  return land + terms.months * w.indemnityPerMonth + (terms.tribute ? ctx.content.diplomacy.peaceTribute.cost : 0);
}

/** What the indemnity amounts to, in hundredths of a ducat. */
export function indemnity(state: GameState, war: War, winnerAttackers: boolean, months: number): number {
  return ledgerIncome(state.economy[leader(war, !winnerAttackers)]?.ledger ?? {}) * months;
}

/** A realm that lost its capital moves it; one that lost everything is gone, its armies with it. */
function afterLosingLand(state: GameState, realm: number): void {
  const r = state.realms[realm];
  if (!r || state.provinces[r.capital]?.owner === realm) return;
  let best = 0;
  let bestV = -1;
  for (const p of state.provinces) if (p.owner === realm) {
    const v = value(state, p.id);
    if (v > bestV) { bestV = v; best = p.id; }
  }
  if (best) { r.capital = best; return; }
  state.armies = state.armies.filter((a) => a.realm !== realm);
  for (const w of state.wars) {
    w.attackers = w.attackers.filter((x) => x !== realm);
    w.defenders = w.defenders.filter((x) => x !== realm);
  }
  state.wars = state.wars.filter((w) => w.attackers.length && w.defenders.length);
}

/** Ends the war on these terms; the winners' reason for war pays out. */
export function settle(state: GameState, ctx: EconomyContext, war: War, winnerAttackers: boolean | null, terms: PeaceTerms): Notice[] {
  const { peace } = ctx.content.war;
  const notices: Notice[] = [];
  const attacker = leader(war, true);
  const defender = leader(war, false);
  const cb = ctx.content.war.casusBelli.find((c) => c.key === war.cb);
  if (winnerAttackers !== null) {
    const win = leader(war, winnerAttackers);
    const lose = leader(war, !winnerAttackers);
    const hurt = new Set<number>();
    for (const id of cb?.key === 'raid' ? [] : terms.cede) {
      const p = state.provinces[id]!;
      hurt.add(p.owner);
      p.owner = win;
      p.controller = win;
    }
    const gold = indemnity(state, war, winnerAttackers, terms.months);
    if (gold) {
      const le = state.economy[lose]!;
      const we = state.economy[win]!;
      le.treasury -= gold; add(le.oneOff, 'indemnity', -gold);
      we.treasury += gold; add(we.oneOff, 'indemnity', gold);
    }
    if (terms.tribute) {
      const t = ctx.content.diplomacy.peaceTribute;
      state.tributes.push({ payer: lose, to: win, share: t.share, until: state.day + t.days });
    }
    if (winnerAttackers && war.cb === 'independence') for (const r of war.attackers) if (state.realms[r]?.overlord === defender) state.realms[r]!.overlord = 0;
    const iWon = winnerAttackers && cb;
    changeStanding(state, ctx.content, win, { prestige: peace.winPrestige + (iWon ? cb.winPrestige : 0), piety: iWon ? cb.winPiety : 0 }, 'Victory in war');
    changeStanding(state, ctx.content, lose, { prestige: peace.losePrestige }, 'Defeat in war');
    endWar(state, war.id);
    addTruce(state, ctx, attacker, defender);
    for (const r of hurt) afterLosingLand(state, r);
    const text = `Peace: ${state.realms[win]?.name} has won its war with ${state.realms[lose]?.name}${terms.cede.length ? `, taking ${terms.cede.length} provinces` : ''}${gold ? ` and ${Math.trunc(gold / 100).toLocaleString('en')} ducats` : ''}.`;
    notices.push({ realm: attacker, text }, { realm: defender, text });
  } else {
    endWar(state, war.id);
    addTruce(state, ctx, attacker, defender);
    const text = `White peace between ${state.realms[attacker]?.name} and ${state.realms[defender]?.name}.`;
    notices.push({ realm: attacker, text }, { realm: defender, text });
  }
  return notices;
}

/**
 * A leader's offer. demand: terms it takes from the enemy, within its war score. Otherwise it gives them up, and
 * the enemy takes them if they are worth enough. With no terms at all, an offer of white peace.
 */
export function proposePeace(state: GameState, ctx: EconomyContext, realm: number, warId: number, terms: PeaceTerms, demand: boolean): { accepted: boolean; notices: Notice[] } {
  const war = state.wars.find((w) => w.id === warId);
  const none = { accepted: false, notices: [] as Notice[] };
  if (!war || (leader(war, true) !== realm && leader(war, false) !== realm)) return none;
  const amAttacker = leader(war, true) === realm;
  const score = amAttacker ? warScore(state, ctx, war).score : -warScore(state, ctx, war).score;
  const p = ctx.content.war.peace;
  const white = !terms.cede.length && !terms.months && !terms.tribute;
  if (white) {
    if (-score > p.aiWhite) return none;
    return { accepted: true, notices: settle(state, ctx, war, null, terms) };
  }
  const winnerAttackers = demand ? amAttacker : !amAttacker;
  const onOffer = new Set(landOnOffer(state, war, winnerAttackers));
  if (terms.cede.some((c) => !onOffer.has(c))) return none;
  const cost = peaceCost(state, ctx, war, winnerAttackers, terms);
  const ok = demand ? cost <= score : cost * 100 >= -score * p.concede;
  return ok ? { accepted: true, notices: settle(state, ctx, war, winnerAttackers, terms) } : none;
}

/** As much as the score allows: the largest provinces first, then gold. */
function bestTerms(state: GameState, ctx: EconomyContext, war: War, winnerAttackers: boolean, score: number): PeaceTerms {
  const p = ctx.content.war.peace;
  const offer = landOnOffer(state, war, winnerAttackers).sort((a, b) => value(state, b) - value(state, a) || a - b);
  const cede: number[] = [];
  if (war.cb !== 'raid') for (const id of offer) if (peaceCost(state, ctx, war, winnerAttackers, { cede: [...cede, id], months: 0 }) <= score) cede.push(id);
  const left = score - peaceCost(state, ctx, war, winnerAttackers, { cede, months: 0 });
  let months = 0;
  for (const m of p.indemnityMonths) if (m * p.indemnityPerMonth <= left) months = m;
  return { cede, months };
}

/** Month start: the goal ticks, and leaders the player does not rule make peace when the war is decided or old. */
export function monthlyWars(state: GameState, ctx: EconomyContext): Notice[] {
  const { score: sc, peace } = ctx.content.war;
  const notices: Notice[] = [];
  for (const war of [...state.wars]) {
    const goal = state.provinces[war.goal];
    if (goal && war.attackers.includes(goal.controller)) war.ticking = Math.min(sc.tickingCap, war.ticking + sc.ticking);
    else if (state.day - war.start > 365) war.ticking = Math.max(-sc.tickingCap, war.ticking - sc.ticking);
    const { score } = warScore(state, ctx, war);
    const age = state.day - war.start;
    const attackerWins = score >= 0;
    const loser = leader(war, !attackerWins);
    const playerLeads = leader(war, true) === state.player || leader(war, false) === state.player;
    if (playerLeads && !(loser === state.player && Math.abs(score) >= peace.aiScore + 20 && age > 365)) continue;
    if (Math.abs(score) >= peace.aiScore || (age >= peace.aiDays && Math.abs(score) >= 10)) {
      notices.push(...settle(state, ctx, war, attackerWins, bestTerms(state, ctx, war, attackerWins, Math.abs(score))));
    } else if (age >= peace.aiDays) notices.push(...settle(state, ctx, war, null, { cede: [], months: 0 }));
  }
  return notices;
}
