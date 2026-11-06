/// <reference lib="webworker" />
import { ageOf, childrenOf, healthOf, heirOf, skillBreakdown, skillsOf, startCharacters } from '../sim/characters';
import { applyCommand } from '../sim/commands';
import type { Content } from '../sim/content';
import {
  cannotBuild, computeLedgers, creditRating, ensureEconomy, ledgerNet, loanOffers, provinceEconomy, startEconomy,
  type EconomyContext, type Notice,
} from '../sim/economy';
import { deserialize, serialize } from '../sim/save';
import type { Scenario } from '../sim/scenario';
import { newGame, type GameState, type Speed } from '../sim/state';
import { tick } from '../sim/tick';
import type {
  CharacterRef, CharacterReport, CourtReport, EconomyQuery, FromWorker, ProvinceReport, RealmReport, ToWorker,
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
  };
}

function schedule() {
  clearTimeout(timer);
  if (state && !state.paused) timer = setTimeout(step, DAY_MS[state.speed]);
}

function step() {
  if (!state) return;
  const r = tick(state, economy ?? undefined);
  if (r.modifiersChanged) postWorld(state);
  postNotices(state, r.notices);
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
    };
    state = newGame(msg.seed, scenario, content.economy.banks.map((b) => b.capital));
    startCharacters(state, economy);
    startEconomy(state, economy);
    postWorld(state);
  } else if (!state || !scenario || !economy) {
    return; // nothing to act on before init
  } else if (msg.type === 'command') {
    const notices: Notice[] = [];
    if (applyCommand(state, msg.cmd, economy.content, economy.goods, notices)) postWorld(state);
    postNotices(state, notices);
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
      state.paused = true;
      postWorld(state);
      post({ type: 'loaded', requestId: msg.requestId, error: null });
    } catch (err) {
      post({ type: 'loaded', requestId: msg.requestId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  postStatus(state);
  schedule();
};
