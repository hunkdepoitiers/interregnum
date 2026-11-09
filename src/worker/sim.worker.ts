/// <reference lib="webworker" />
import { ageOf, childrenOf, healthOf, heirOf, skillBreakdown, skillsOf, startCharacters } from '../sim/characters';
import { applyCommand } from '../sim/commands';
import type { Content } from '../sim/content';
import {
  cannotBuild, computeLedgers, creditRating, ensureEconomy, ledgerNet, loanOffers, provinceEconomy, startEconomy,
  type EconomyContext, type Notice,
} from '../sim/economy';
import { cannotDeed, deedCost, deedIncome, excommunicationThreat, holySitesAt, realmFaith, startFaith, tiersOf } from '../sim/faith';
import { oddsFor } from '../sim/events';
import { check } from '../sim/script';
import { hasModifier } from '../sim/modifiers';
import { atWar, cannotHire, cannotHireCompany, levyPool } from '../sim/military';
import { assaultChance, bribeChance, bribeCost, dailyProgress, fullGarrison, startForts } from '../sim/sieges';
import { allied, cannotDiplo, contractOf, factionPower, giftCost, opinion, startDiplomacy, truceUntil, type DiploAction } from '../sim/diplomacy';
import { casusBelli, indemnity, landOnOffer, peaceCost, warScore } from '../sim/war';
import { armyWage } from '../sim/economy';
import { deserialize, serialize } from '../sim/save';
import { ensureStanding } from '../sim/standing';
import type { Scenario } from '../sim/scenario';
import { newGame, type GameState, type Speed } from '../sim/state';
import { tick } from '../sim/tick';
import type {
  ArmyView, CharacterRef, DiplomacyReport, PeaceOffer, SiegeView, WarView, CharacterReport, CourtReport, EconomyQuery, FromWorker, ProvinceReport, RealmReport, StandingReport, ToWorker,
} from './protocol';

/** Milliseconds per game day (speed 5 ≈ 100 days per second, if the tick keeps up). */
const DAY_MS: Record<Speed, number> = { 1: 1000, 2: 400, 3: 150, 4: 50, 5: 10 };

let scenario: Scenario | null = null;
let content: Content | null = null;
let economy: EconomyContext | null = null;
let state: GameState | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function postStatus(s: GameState) {
  const ec = s.player ? s.economy[s.player] : null;
  post({
    type: 'status', day: s.day, speed: s.speed, paused: s.paused, player: s.player,
    treasury: ec ? ec.treasury : null, net: ec ? ledgerNet(ec.ledger) : null,
  });
}

function postWorld(s: GameState) {
  const owner = Uint16Array.from(s.provinces, (p) => p.owner);
  const controller = Uint16Array.from(s.provinces, (p) => p.controller);
  const base = s.provinceBase.development ?? [];
  const development = Uint16Array.from(s.provinces, (p) => base[p.id] ?? 0);
  post({ type: 'world', realms: s.realms, owner, controller, modifiers: s.modifiers, development }, [owner.buffer, controller.buffer, development.buffer]);
}

/** The player hears about their own realm, and about things that concern everyone (a bank failing). */
function postNotices(s: GameState, notices: Notice[]) {
  const mine = notices.filter((n) => n.realm === 0 || (s.player && n.realm === s.player));
  if (mine.length) post({ type: 'notices', notices: mine });
}

function ref(s: GameState, id: number): CharacterRef | null {
  const c = id ? s.characters[id] : null;
  if (!c) return null;
  return { id, name: c.name, house: s.dynasties[c.dynasty]?.name ?? '', age: ageOf(c, c.died ?? s.day), female: c.female, alive: c.died === null };
}

function courtReport(s: GameState, ctx: EconomyContext, realm: number): CourtReport | null {
  const court = s.courts[realm];
  if (!court) return null;
  const ruler = s.characters[court.ruler];
  const ch = ctx.content.characters;
  return {
    ruler: ref(s, court.ruler), regent: ref(s, court.regent), heir: ref(s, heirOf(s, ctx.content, realm)), claimant: ref(s, court.claimant),
    law: court.law, since: court.since,
    rulerSkills: ruler ? skillsOf(ctx.content, ruler, s.day) : [0, 0, 0], rulerTraits: ruler?.traits ?? [],
    council: ch.council.map((seat, i) => {
      const c = s.characters[court.council[i] ?? 0];
      return { role: seat.role, skill: seat.skill, who: ref(s, court.council[i] ?? 0), value: c ? skillsOf(ctx.content, c, s.day)[seat.skill]! : 0 };
    }),
  };
}

function characterReport(s: GameState, ctx: EconomyContext, id: number): CharacterReport | null {
  const c = s.characters[id];
  if (!c) return null;
  const roles: { realm: number; role: string }[] = [];
  s.courts.forEach((court, realm) => {
    if (!court) return;
    if (court.ruler === id) roles.push({ realm, role: 'ruler' });
    if (court.regent === id) roles.push({ realm, role: 'regent' });
    if (court.claimant === id) roles.push({ realm, role: 'claimant' });
    const seat = court.council.indexOf(id);
    if (seat >= 0) roles.push({ realm, role: ctx.content.characters.council[seat]?.role ?? 'councillor' });
    if (c.died === null && heirOf(s, ctx.content, realm) === id) roles.push({ realm, role: 'heir' });
  });
  const refs = (list: { id: number }[]) => list.map((x) => ref(s, x.id)).filter((x): x is CharacterRef => !!x);
  const parent = c.father || c.mother;
  const siblings = parent ? childrenOf(s, parent).filter((x) => x.id !== id) : [];
  const day = c.died ?? s.day;
  return {
    ref: ref(s, id)!, born: c.born, died: c.died, skills: skillsOf(ctx.content, c, day), breakdown: skillBreakdown(ctx.content, c, day),
    traits: c.traits, education: c.education, health: healthOf(ctx.content, c), religion: c.religion, culture: c.culture, roles,
    father: ref(s, c.father), mother: ref(s, c.mother), spouse: ref(s, c.spouse), children: refs(childrenOf(s, id)), siblings: refs(siblings),
  };
}

function standingReport(s: GameState, ctx: EconomyContext, realm: number): StandingReport | null {
  const st = s.standing[realm];
  const tiers = tiersOf(s, ctx, realm);
  if (!st || !tiers) return null;
  const f = ctx.content.faith;
  const religion = realmFaith(s, ctx, realm);
  const faith = f.faiths[religion - 1];
  const site = (p: number) => s.provinces[p]?.owner === realm && s.provinces[p]?.controller === realm;
  return {
    prestige: st.prestige, piety: st.piety, ...tiers, religion, head: faith?.head ?? 0,
    holySites: (faith?.holySites ?? []).map((h) => ({ ...h, held: site(h.province) })),
    log: st.log, pilgrimage: st.pilgrimage?.until ?? null,
    excommunicated: hasModifier(s, f.excommunication.modifier, { kind: 'realm', id: realm }),
    excommunicationChance: excommunicationThreat(s, ctx, realm).chance,
    deeds: Object.values(f.deeds).map((d) => ({
      key: d.key, name: d.name, description: d.description, cost: deedCost(s, d, realm), income: deedIncome(s, d, realm),
      prestige: d.prestige, piety: d.piety, days: d.days, why: cannotDeed(s, ctx, realm, d.key),
    })),
  };
}

function edgeDays(ctx: EconomyContext, from: number, to: number): number {
  const g = ctx.graph;
  if (!g) return 10;
  for (let i = g.start[from]!; i < g.start[from + 1]!; i++) if (g.to[i] === to) return g.days[i]!;
  return 10;
}

function postArmies(s: GameState, ctx: EconomyContext) {
  const m = ctx.content.military;
  const armies: ArmyView[] = s.armies.map((a) => {
    let eta = 0;
    let from = a.location;
    for (const p of a.path) { eta += edgeDays(ctx, from, p); from = p; }
    const men = a.levies + a.menAtArms;
    const enemyHolds = atWar(s, a.realm, s.provinces[a.location]?.controller ?? 0);
    return {
      id: a.id, realm: a.realm, location: a.location, next: a.path[0] ?? 0,
      progress: a.path.length ? Math.min(100, Math.trunc((a.progress * 100) / edgeDays(ctx, a.location, a.path[0]!))) : 0,
      destination: a.path[a.path.length - 1] ?? 0, eta: Math.ceil(Math.max(0, eta - a.progress) / 10),
      path: [...a.path], levies: a.levies, menAtArms: a.menAtArms, morale: Math.trunc(a.morale / 100), commander: ref(s, a.commander), ready: a.ready,
      fighting: !a.retreating && s.armies.some((x) => x.location === a.location && !x.retreating && atWar(s, a.realm, x.realm)),
      retreating: a.retreating,
      company: ctx.content.war.companies[a.company - 1]?.name ?? null,
      siege: enemyHolds && !s.forts[a.location] ? a.siege : 0, siegeNeed: enemyHolds && !s.forts[a.location] ? Math.max(m.occupyMin, Math.trunc((m.occupyDays * 1000) / Math.max(1, men))) : 0,
      wage: armyWage(ctx.content, a, s.day),
    };
  });
  const w = ctx.content.war;
  const sieges: SiegeView[] = s.sieges.flatMap((x) => {
    const fort = s.forts[x.province];
    const controller = s.provinces[x.province]!.controller;
    if (!fort) return [];
    const here = s.armies.filter((a) => a.location === x.province && !a.path.length && !a.retreating && atWar(s, a.realm, controller));
    return [{
      province: x.province, realm: x.realm, progress: Math.trunc(x.progress / 100), level: fort.level, garrison: fort.garrison, supply: fort.supply,
      engineers: x.engineers, maxEngineers: w.siege.maxEngineers, engineerCost: w.siege.engineerCost, breach: x.breach,
      assaultChance: assaultChance(s, w, x, fort, here), assaultWon: fort.garrison * w.assault.lossesWon, assaultLost: fort.garrison * w.assault.lossesLost,
      assaultWait: Math.max(0, x.nextAssault - s.day), bribeWait: Math.max(0, x.nextBribe - s.day),
      bribes: w.bribe.chances.map((_, tier) => ({ cost: bribeCost(w, fort, tier), chance: bribeChance(s, w, x, fort, tier, controller) })),
      daily: dailyProgress(s, w, x, fort, here.length ? here : s.armies.filter((a) => a.realm === x.realm).slice(0, 1)), log: x.log,
    }];
  });
  const wars: WarView[] = s.wars.map((war) => {
    const lead = war.attackers[0] === s.player || war.defenders[0] === s.player;
    const iAttack = war.attackers[0] === s.player;
    const offer = (winnerAttackers: boolean): PeaceOffer => {
      const land = war.cb === 'raid' ? [] : landOnOffer(s, war, winnerAttackers);
      return {
        land, landCost: land.length ? peaceCost(s, ctx, war, winnerAttackers, { cede: land, months: 0 }) : 0,
        tributeCost: ctx.content.diplomacy.peaceTribute.cost, tributeShare: ctx.content.diplomacy.peaceTribute.share,
        gold: w.peace.indemnityMonths.map((months) => ({ months, amount: indemnity(s, war, winnerAttackers, months), cost: peaceCost(s, ctx, war, winnerAttackers, { cede: [], months }) })),
      };
    };
    return {
      id: war.id, name: war.name, cbName: w.casusBelli.find((c) => c.key === war.cb)?.name ?? war.cb, attackers: war.attackers, defenders: war.defenders, start: war.start,
      ...warScore(s, ctx, war), demand: lead ? offer(iAttack) : null, concede: lead ? offer(!iAttack) : null, concedeShare: w.peace.concede,
    };
  });
  post({ type: 'armies', armies, wars, sieges });
}

function diplomacyReport(s: GameState, ctx: EconomyContext, realm: number): DiplomacyReport {
  const d = ctx.content.diplomacy;
  const p = s.player;
  const other = p > 0 && p !== realm;
  const partner = (x: { a: number; b: number }) => (x.a === realm ? x.b : x.b === realm ? x.a : 0);
  const actions: DiplomacyReport['actions'] = [];
  if (other) {
    const add = (key: DiploAction, label: string, detail: string, cost = 0) => actions.push({ key, label, detail, cost, why: cannotDiplo(s, ctx, p, realm, key) });
    add('gift', 'Send gifts', `They will think ${d.gift.opinion} better of you for ${Math.round(d.gift.days / 365)} years.`, giftCost(s, ctx, realm));
    if (allied(s, p, realm)) add('breakAlliance', 'Break alliance', `Costs ${-d.alliance.breakPrestige} prestige.`);
    else add('alliance', 'Propose alliance', 'Allies are called to each other’s wars.');
    add('marriage', 'Arrange marriage', 'Weds your ruler or heir to their kin. Kin may join your wars, and war on them costs prestige.');
    add('tribute', 'Demand tribute', `${d.tributeDemand.share}% of their income for ${Math.round(d.tributeDemand.days / 365)} years.`);
  }
  const f = realm === p ? s.factions.find((x) => x.overlord === realm) : undefined;
  return {
    opinion: other ? opinion(s, ctx, realm, p) : null,
    truceDays: other ? Math.max(0, truceUntil(s, p, realm) - s.day) : 0,
    allies: s.alliances.map(partner).filter(Boolean), kin: s.marriages.map(partner).filter(Boolean),
    paysTo: s.tributes.filter((t) => t.payer === realm).map((t) => ({ realm: t.to, share: t.share })),
    receivesFrom: s.tributes.filter((t) => t.to === realm).map((t) => ({ realm: t.payer, share: t.share })),
    faction: f ? { members: f.members, power: factionPower(s, ctx, realm, f.members), needed: d.factions.revoltPower, days: s.day - f.start, needDays: d.factions.revoltDays } : null,
    demands: realm === p ? s.demands.filter((x) => x.to === p).map((x) => ({ id: x.id, from: x.from, share: x.share, years: Math.round(x.days / 365), men: x.men, days: Math.max(0, x.expires - s.day) })) : [],
    actions,
    contract: other && s.realms[realm]?.overlord === p ? { current: contractOf(s, ctx, realm).key, options: d.vassals.contracts.map((c) => ({ key: c.key, name: c.name, description: c.description })) } : null,
  };
}

let eventsShown = 0;
function postEvents(s: GameState, ctx: EconomyContext) {
  if (!s.pendingEvents.length && !eventsShown) return;
  eventsShown = s.pendingEvents.length;
  post({ type: 'events', events: s.pendingEvents.map((p) => {
    const def = ctx.content.events.list.find((e) => e.key === p.key);
    return {
      id: p.id, key: p.key, realm: p.realm, ruler: s.characters[s.courts[p.realm]?.ruler ?? 0]?.name ?? 'the ruler',
      options: (def?.options ?? []).map((o) => ({ key: o.key, open: !o.when || check(s, ctx.content, o.when, { kind: 'realm', id: p.realm }), chance: oddsFor(s, o, p.realm) })),
    };
  }) });
}

function answer(s: GameState, ctx: EconomyContext, q: EconomyQuery): RealmReport | ProvinceReport | CharacterReport | null {
  if (q.kind === 'character') return characterReport(s, ctx, q.id);
  if (q.kind === 'realm') {
    const ec = s.economy[q.id];
    if (!ec || !s.realms[q.id]) return null;
    const ledgers = computeLedgers(s, ctx);
    let people = 0;
    for (const p of s.provinces) if (p.owner === q.id) for (let i = 0; i < 5; i++) people += s.pops[p.id * 5 + i] ?? 0;
    return {
      treasury: ec.treasury,
      ledger: ec.ledger,
      projected: { ...ledgers[q.id], ...ec.oneOff },
      credit: creditRating(s, ctx, q.id, ledgers),
      offers: loanOffers(s, ctx, q.id, ledgers),
      loans: s.loans.filter((l) => l.realm === q.id),
      taxLaw: ec.taxLaw,
      lawWait: Math.max(0, ec.lawChanged + ctx.content.economy.lawCooldownDays - s.day),
      construction: s.construction.filter((c) => c.realm === q.id),
      people,
      court: courtReport(s, ctx, q.id),
      standing: standingReport(s, ctx, q.id),
      diplomacy: diplomacyReport(s, ctx, q.id),
      military: { ...levyPool(s, ctx, q.id), hireCost: Math.trunc(ctx.content.military.menAtArms.cost), cannotHire: cannotHire(s, ctx, q.id, 1000),
        companies: ctx.content.war.companies.map((c, index) => ({ index, name: c.name, description: c.description, men: c.men, cost: c.cost, wage: c.wage, why: cannotHireCompany(s, ctx, q.id, index) })),
        casusBelli: s.player && s.player !== q.id ? casusBelli(s, ctx, s.player, q.id) : [],
      },
    };
  }
  const p = s.provinces[q.id];
  if (!p) return null;
  const canBuild: Record<string, string | null> = {};
  if (s.player && p.owner === s.player) for (const b of ctx.content.economy.buildings) canBuild[b.key] = cannotBuild(s, ctx, s.player, q.id, b.key);
  return {
    economy: provinceEconomy(s, ctx, q.id),
    buildings: s.buildings[q.id] ?? [],
    construction: s.construction.filter((c) => c.province === q.id),
    canBuild,
    holySites: holySitesAt(ctx, q.id),
    fort: s.forts[q.id] ? { ...s.forts[q.id]!, maxGarrison: fullGarrison(ctx.content.war, s.forts[q.id]!.level) } : null,
  };
}

function schedule() {
  clearTimeout(timer);
  if (state && !state.paused) timer = setTimeout(step, DAY_MS[state.speed]);
}

function step() {
  if (!state) return;
  if (state.pendingEvents.length) { state.paused = true; postStatus(state); if (economy) postEvents(state, economy); return; } // the player must answer first
  const r = tick(state, economy ?? undefined);
  if (r.modifiersChanged) postWorld(state);
  if (economy && (state.armies.length || state.wars.length || state.sieges.length || r.notices.length)) postArmies(state, economy);
  postNotices(state, r.notices);
  if (economy) postEvents(state, economy);
  postStatus(state);
  schedule();
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    scenario = msg.scenario;
    content = msg.content;
    economy = {
      content, goods: scenario.good ?? [], centres: scenario.tradeCentre ?? [], seats: scenario.seats ?? [],
      culture: scenario.culture ?? [], religion: scenario.religion ?? [],
      county: scenario.county ?? [], graph: scenario.graph, pos: scenario.pos, kmPerPx: scenario.kmPerPx, terrain: scenario.terrain,
    };
    state = newGame(msg.seed, scenario, content.economy.banks.map((b) => b.capital));
    startCharacters(state, economy);
    startEconomy(state, economy);
    startFaith(state, economy);
    startForts(state, economy);
    startDiplomacy(state, economy);
    postWorld(state);
  } else if (!state || !scenario || !economy) {
    return; // nothing to act on before init
  } else if (msg.type === 'command') {
    const notices: Notice[] = [];
    if (applyCommand(state, msg.cmd, economy.content, economy.goods, notices, economy)) postWorld(state);
    postArmies(state, economy);
    postNotices(state, notices);
    postEvents(state, economy);
  } else if (msg.type === 'requestSave') {
    post({ type: 'saveData', requestId: msg.requestId, text: serialize(state) });
    return;
  } else if (msg.type === 'query') {
    post({ type: 'queryResult', requestId: msg.requestId, result: answer(state, economy, msg.query) });
    return;
  } else if (msg.type === 'load') {
    try {
      state = deserialize(msg.text, { scenario, economy });
      ensureEconomy(state);
      ensureStanding(state);
      state.paused = true;
      postWorld(state);
      postArmies(state, economy);
      eventsShown = 1;
      postEvents(state, economy);
      post({ type: 'loaded', requestId: msg.requestId, error: null });
    } catch (err) {
      post({ type: 'loaded', requestId: msg.requestId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  postStatus(state);
  schedule();
};
