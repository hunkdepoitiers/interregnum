/// <reference lib="webworker" />
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
import type { EconomyQuery, FromWorker, ProvinceReport, RealmReport, ToWorker } from './protocol';

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

function answer(s: GameState, ctx: EconomyContext, q: EconomyQuery): RealmReport | ProvinceReport | null {
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
    economy = { content, goods: scenario.good ?? [], centres: scenario.tradeCentre ?? [] };
    state = newGame(msg.seed, scenario, content.economy.banks.map((b) => b.capital));
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
