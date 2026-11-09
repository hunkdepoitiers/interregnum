import { childrenOf, heirOf, isAlive } from './characters';
import type { TimelineEntry } from './content';
import { add, ledgerIncome, type EconomyContext, type Notice } from './economy';
import { realmFaith } from './faith';
import { atWar, declareWar, levyPool, placeArmy } from './military';
import { statValue } from './modifiers';
import { changeStanding, tierOf } from './standing';
import type { Character, GameState, Marriage, War } from './state';

/** Opinion, pacts, vassal contracts, factions and the scripted steppe powers (DESIGN §5.7, M9). */

const pairIs = (x: { a: number; b: number }, p: number, q: number) => (x.a === p && x.b === q) || (x.a === q && x.b === p);
export const allied = (s: GameState, a: number, b: number) => s.alliances.some((x) => pairIs(x, a, b));
export const marriageOf = (s: GameState, a: number, b: number): Marriage | undefined => s.marriages.find((x) => pairIs(x, a, b));
export const truceUntil = (s: GameState, a: number, b: number) => s.truces.find((x) => pairIs(x, a, b) && x.until > s.day)?.until ?? 0;

export function contractOf(state: GameState, ctx: EconomyContext, vassal: number) {
  const list = ctx.content.diplomacy.vassals.contracts;
  return list.find((c) => c.key === (state.contracts[vassal] ?? 'normal')) ?? list[0]!;
}

const rulerOf = (s: GameState, realm: number): Character | null => s.characters[s.courts[realm]?.ruler ?? 0] ?? null;

export interface OpinionLines { value: number; lines: { label: string; value: number }[] }

/** What one realm thinks of another, line by line. */
export function opinion(state: GameState, ctx: EconomyContext, from: number, to: number): OpinionLines {
  const d = ctx.content.diplomacy;
  const o = d.opinion;
  const lines: { label: string; value: number }[] = [];
  const line = (label: string, value: number) => { if (value) lines.push({ label, value }); };
  const rel = ctx.content.religions;
  const fa = realmFaith(state, ctx, from);
  const fb = realmFaith(state, ctx, to);
  if (fa && fa === fb) line('Same faith', o.sameFaith);
  else if (fa && fb) line(rel[fa - 1]?.family === rel[fb - 1]?.family ? 'Related faith' : 'Foreign faith', rel[fa - 1]?.family === rel[fb - 1]?.family ? o.sameFamily : o.otherFamily);
  const ca = ctx.content.cultures[(rulerOf(state, from)?.culture ?? 0) - 1];
  const cb = ctx.content.cultures[(rulerOf(state, to)?.culture ?? 0) - 1];
  if (ca && cb && ca.group === cb.group) line('Kindred culture', o.sameCultureGroup);
  if (allied(state, from, to)) line('Alliance', o.alliance);
  if (marriageOf(state, from, to)) line('Royal marriage', o.marriage);
  if (truceUntil(state, from, to)) line('Truce', o.truce);
  if (atWar(state, from, to)) line('At war', o.atWar);
  if (state.tributes.some((t) => t.payer === from && t.to === to)) line('Pays them tribute', o.paysTribute);
  if (state.realms[from]?.overlord === to) {
    const v = d.vassals;
    line('Vassal of them', v.base);
    line(contractOf(state, ctx, from).name, contractOf(state, ctx, from).opinion);
    if ((state.economy[to]?.treasury ?? 0) < 0) line('Overlord cannot pay its way', v.unpaid);
    if (ctx.content.stats.legitimacy) line('Overlord’s legitimacy', Math.trunc(((statValue(state, ctx.content, 'legitimacy', { kind: 'realm', id: to }) - 6000) / 100 * v.legitimacy) / 10));
    const st = state.standing[to];
    if (st) line('Overlord’s prestige', (tierOf(ctx.content.faith.prestigeTiers, st.prestige) - 2) * v.prestigeTier);
  }
  for (const e of state.opinions) if (e.from === from && e.to === to) line(e.label, e.value);
  return { value: lines.reduce((t, l) => t + l.value, 0), lines };
}

function remember(state: GameState, from: number, to: number, label: string, value: number, days: number): void {
  state.opinions.push({ from, to, label, value, start: state.day, end: state.day + days });
}

// ---------- What one realm may ask of another

const gross = (s: GameState, r: number) => ledgerIncome(s.economy[r]?.ledger ?? {});

export function giftCost(state: GameState, ctx: EconomyContext, to: number): number {
  const g = ctx.content.diplomacy.gift;
  return g.cost + Math.trunc(gross(state, to) * g.costMonths);
}

function canWed(s: GameState, ctx: EconomyContext, c: Character | null | undefined): c is Character {
  if (!isAlive(c) || c.spouse) return false;
  return s.day - c.born >= ctx.content.diplomacy.marriage.age * 365;
}

/** The match two realms could make: the ruler or heir of the first with kin of the second's ruler. */
function matchFor(state: GameState, ctx: EconomyContext, from: number, to: number): [Character, Character] | null {
  const mine = [rulerOf(state, from), state.characters[heirOf(state, ctx.content, from)]].filter((c): c is Character => canWed(state, ctx, c));
  const r = rulerOf(state, to);
  if (!r) return null;
  const theirs = [r, ...childrenOf(state, r.id)].filter((c) => canWed(state, ctx, c));
  for (const a of mine) for (const b of theirs) if (a.female !== b.female && a.dynasty !== b.dynasty) return [a, b];
  return null;
}

export type DiploAction = 'gift' | 'alliance' | 'breakAlliance' | 'marriage' | 'tribute';

/** Why a realm cannot do this to another now; null = it can (and, for a proposal, it will be accepted). */
export function cannotDiplo(state: GameState, ctx: EconomyContext, from: number, to: number, action: DiploAction): string | null {
  const d = ctx.content.diplomacy;
  const a = state.realms[from];
  const b = state.realms[to];
  if (!a || !b || from === to) return 'No such realm.';
  const op = opinion(state, ctx, to, from).value;
  if (action === 'breakAlliance') return allied(state, from, to) ? null : 'You are not allied.';
  if (action === 'gift') {
    if ((state.economy[from]?.treasury ?? 0) < giftCost(state, ctx, to)) return 'Not enough in the treasury.';
    return state.opinions.some((e) => e.from === to && e.to === from && e.label === 'Gifts received' && state.day - e.start < d.gift.cooldown) ? 'You have sent gifts lately.' : null;
  }
  if (atWar(state, from, to)) return 'You are at war.';
  if (action === 'alliance') {
    if (allied(state, from, to)) return 'You are already allied.';
    if (a.overlord === to || b.overlord === from) return 'Lord and vassal need no treaty.';
    return op < d.alliance.minOpinion ? `They must think better of you (${op} of ${d.alliance.minOpinion}).` : null;
  }
  if (action === 'marriage') {
    if (marriageOf(state, from, to)) return 'Your houses are already joined.';
    if (op < d.marriage.minOpinion) return `They must think better of you (${op} of ${d.marriage.minOpinion}).`;
    return matchFor(state, ctx, from, to) ? null : 'There is no one free to marry.';
  }
  if (state.tributes.some((t) => t.payer === to && t.to === from)) return 'They pay you already.';
  if (b.overlord === from) return 'Your vassal owes you dues.';
  const mine = levyPool(state, ctx, from).total;
  const theirs = levyPool(state, ctx, to).total;
  return mine * 100 < theirs * d.tributeDemand.power ? `You must be ${d.tributeDemand.power / 100} times as strong.` : null;
}

export function doDiplo(state: GameState, ctx: EconomyContext, from: number, to: number, action: DiploAction): Notice[] {
  if (cannotDiplo(state, ctx, from, to, action)) return [];
  const d = ctx.content.diplomacy;
  const name = state.realms[to]!.name;
  if (action === 'gift') {
    const cost = giftCost(state, ctx, to);
    const ec = state.economy[from]!;
    const eminence = (rulerOf(state, from)?.skills[0] ?? 10) - 10;
    ec.treasury -= cost;
    add(ec.oneOff, 'gifts', -cost);
    const te = state.economy[to];
    if (te) { te.treasury += cost; add(te.oneOff, 'gifts', cost); }
    remember(state, to, from, 'Gifts received', Math.trunc((d.gift.opinion * (100 + eminence * d.gift.perEminence)) / 100), d.gift.days);
    return [];
  }
  if (action === 'alliance') {
    state.alliances.push({ a: from, b: to, start: state.day });
    return [{ realm: from, text: `${name} has agreed to an alliance.` }];
  }
  if (action === 'breakAlliance') {
    state.alliances = state.alliances.filter((x) => !pairIs(x, from, to));
    changeStanding(state, ctx.content, from, { prestige: d.alliance.breakPrestige }, 'Broke an alliance');
    remember(state, to, from, 'Broke our alliance', -30, 3650);
    return [];
  }
  if (action === 'marriage') {
    const [a, b] = matchFor(state, ctx, from, to)!;
    a.spouse = b.id;
    b.spouse = a.id;
    state.marriages.push({ a: from, b: to, husband: a.female ? b.id : a.id, wife: a.female ? a.id : b.id });
    return [{ realm: from, text: `${a.name} has married ${b.name} of ${name}.` }];
  }
  state.tributes.push({ payer: to, to: from, share: d.tributeDemand.share, until: state.day + d.tributeDemand.days });
  remember(state, to, from, 'Forced us to pay tribute', d.tributeDemand.opinion, d.tributeDemand.days);
  return [{ realm: from, text: `${name} has agreed to pay tribute.` }];
}

export function addTruce(state: GameState, ctx: EconomyContext, a: number, b: number): void {
  state.truces = state.truces.filter((x) => !pairIs(x, a, b));
  state.truces.push({ a, b, until: state.day + ctx.content.diplomacy.truceDays });
}

/** A new war calls in allies and kin of both leaders, each if it is willing; an ally who will not come is an ally no more. */
export function callToArms(state: GameState, ctx: EconomyContext, war: War): Notice[] {
  const d = ctx.content.diplomacy;
  const notices: Notice[] = [];
  const inWar = (r: number) => war.attackers.includes(r) || war.defenders.includes(r);
  for (const [leader, side, other] of [[war.attackers[0]!, war.attackers, war.defenders[0]!], [war.defenders[0]!, war.defenders, war.attackers[0]!]] as const) {
    const partners = [...state.alliances.map((x) => ({ who: x.a === leader ? x.b : x.b === leader ? x.a : 0, need: d.alliance.callOpinion, pact: true })),
      ...state.marriages.map((x) => ({ who: x.a === leader ? x.b : x.b === leader ? x.a : 0, need: d.marriage.callOpinion, pact: false }))];
    for (const { who, need, pact } of partners) {
      if (!who || inWar(who) || allied(state, who, other) || truceUntil(state, who, other)) continue;
      if (opinion(state, ctx, who, leader).value >= need) {
        side.push(who);
        notices.push({ realm: leader, text: `${state.realms[who]?.name} comes to your side.` });
      } else if (pact) {
        state.alliances = state.alliances.filter((x) => !pairIs(x, who, leader));
        notices.push({ realm: leader, text: `${state.realms[who]?.name} refuses your call and ends the alliance.` });
      }
    }
  }
  return notices;
}

// ---------- Vassals

/** Sets a vassal's obligations; any change is resented for a while. */
export function setContract(state: GameState, ctx: EconomyContext, overlord: number, vassal: number, key: string): boolean {
  const d = ctx.content.diplomacy.vassals;
  if (state.realms[vassal]?.overlord !== overlord || !d.contracts.some((c) => c.key === key) || (state.contracts[vassal] ?? 'normal') === key) return false;
  state.contracts[vassal] = key;
  remember(state, vassal, overlord, 'Changed our obligations', d.contractChange, 730);
  return true;
}

function factionsMonth(state: GameState, ctx: EconomyContext, notices: Notice[]): void {
  const f = ctx.content.diplomacy.factions;
  const byLord = new Map<number, number[]>();
  for (const r of state.realms) if (r?.overlord && state.realms[r.overlord] && r.id !== state.player) {
    if (atWar(state, r.id, r.overlord) || truceUntil(state, r.id, r.overlord)) continue;
    if (opinion(state, ctx, r.id, r.overlord).value >= f.joinBelow) continue;
    if (contractOf(state, ctx, r.id).key === 'high') {
      state.contracts[r.id] = 'normal';
      notices.push({ realm: r.overlord, text: `${r.name} forced you to return to customary obligations.` });
      continue;
    }
    byLord.set(r.overlord, [...(byLord.get(r.overlord) ?? []), r.id]);
  }
  state.factions = state.factions.filter((x) => byLord.has(x.overlord));
  for (const [overlord, members] of byLord) {
    let faction = state.factions.find((x) => x.overlord === overlord);
    if (!faction) {
      faction = { overlord, members, start: state.day };
      state.factions.push(faction);
      notices.push({ realm: overlord, text: `Your vassals have formed a faction against you.` });
    }
    faction.members = members;
    if (factionPower(state, ctx, overlord, members) < f.revoltPower || state.day - faction.start < f.revoltDays) continue;
    const loyal = state.realms.filter((r) => r && r.overlord === overlord && !members.includes(r.id) && !atWar(state, r.id, overlord)).map((r) => r!.id);
    state.wars.push({
      id: state.nextWarId++, name: `Revolt against ${state.realms[overlord]?.name}`, attackers: [...members], defenders: [overlord, ...loyal], start: state.day,
      cb: 'independence', goal: state.realms[overlord]!.capital, battles: 0, ticking: 0,
    });
    state.factions = state.factions.filter((x) => x !== faction);
    notices.push({ realm: overlord, text: `Your vassals have risen in revolt!` });
    for (const m of members) notices.push({ realm: m, text: `${state.realms[m]?.name} has risen against its overlord.` });
  }
}

/** A faction's levies as a percentage of its overlord's. */
export function factionPower(state: GameState, ctx: EconomyContext, overlord: number, members: number[]): number {
  const own = Math.max(1, levyPool(state, ctx, overlord).total);
  return Math.trunc((members.reduce((t, m) => t + levyPool(state, ctx, m).total, 0) * 100) / own);
}

// ---------- The scripted steppe powers

function invade(state: GameState, e: Pick<TimelineEntry, 'from' | 'to' | 'men' | 'spawn'>, notices: Notice[]): void {
  if (!state.realms[e.from] || !state.realms[e.to] || atWar(state, e.from, e.to)) return;
  const war = declareWar(state, e.from, e.to, 'raid');
  if (!war) return;
  placeArmy(state, e.from, e.spawn, e.men);
  notices.push({ realm: e.to, text: `${state.realms[e.from]?.name} has invaded your lands!` }, { realm: 0, text: `${state.realms[e.from]?.name} rides against ${state.realms[e.to]?.name}.` });
}

function timeline(state: GameState, ctx: EconomyContext, notices: Notice[]): void {
  const d = ctx.content.diplomacy;
  d.timeline.forEach((e, i) => {
    if (e.day > state.day || state.timelineDone.includes(i)) return;
    state.timelineDone.push(i);
    if (!state.provinces.some((p) => p.owner === e.to) || !state.provinces.some((p) => p.owner === e.from)) return;
    if (e.type === 'invasion') return invade(state, e, notices);
    if (e.to === state.player) {
      state.demands.push({ id: state.nextDemandId++, from: e.from, to: e.to, share: e.share, days: e.days, men: e.men, spawn: e.spawn, expires: state.day + d.replyDays });
      notices.push({ realm: e.to, text: `${state.realms[e.from]?.name} demands tribute. Answer in your realm’s Diplomacy section.` });
    } else if (levyPool(state, ctx, e.to).total < e.men * 2) state.tributes.push({ payer: e.to, to: e.from, share: e.share, until: state.day + e.days });
    else invade(state, e, notices);
  });
}

/** The player's answer to a demand; left unanswered, it counts as refused. */
export function answerDemand(state: GameState, id: number, pay: boolean, notices: Notice[]): boolean {
  const dm = state.demands.find((x) => x.id === id);
  if (!dm) return false;
  state.demands = state.demands.filter((x) => x !== dm);
  if (pay) state.tributes.push({ payer: dm.to, to: dm.from, share: dm.share, until: state.day + dm.days });
  else invade(state, dm, notices);
  return true;
}

/** Month start: old grudges, truces and tribute run out, dead spouses end marriages, factions stir, the steppe moves. */
export function monthlyDiplomacy(state: GameState, ctx: EconomyContext): Notice[] {
  const notices: Notice[] = [];
  state.opinions = state.opinions.filter((e) => e.end > state.day);
  state.truces = state.truces.filter((x) => x.until > state.day);
  state.tributes = state.tributes.filter((t) => t.until > state.day && !!state.realms[t.to]);
  state.marriages = state.marriages.filter((m) => isAlive(state.characters[m.husband]) && isAlive(state.characters[m.wife]));
  for (const dm of state.demands.filter((x) => x.expires <= state.day)) answerDemand(state, dm.id, false, notices);
  factionsMonth(state, ctx, notices);
  timeline(state, ctx, notices);
  return notices;
}

/** The alliances standing at the start of the game. */
export function startDiplomacy(state: GameState, ctx: EconomyContext): void {
  for (const [a, b] of ctx.content.diplomacy.startAlliances) state.alliances.push({ a: a!, b: b!, start: 0 });
}

