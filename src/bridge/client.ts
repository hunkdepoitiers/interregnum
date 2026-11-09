import { signal } from '@preact/signals';
import type { Command } from '../sim/commands';
import type { Content } from '../sim/content';
import type { Scenario } from '../sim/scenario';
import type { Speed } from '../sim/state';
import type { Notice } from '../sim/economy';
import type { ArmyView, SiegeView, WarView, CharacterReport, EconomyQuery, FromWorker, ProvinceReport, RealmReport, ToWorker, WorldView } from '../worker/protocol';

/**
 * Main-thread handle on the simulation worker. The UI reads this signal and never touches sim state.
 * One object signal, replaced on every status message: with separate signals per field, a component
 * only re-rendered when the day changed, so pause/speed changes showed one update late.
 */
export const status = signal<{ day: number; speed: Speed; paused: boolean; player: number; treasury: number | null; net: number | null }>(
  { day: 0, speed: 2, paused: true, player: 0, treasury: null, net: null },
);
/** Realms and who owns/holds each province; null until the worker has started a game. */
export const world = signal<WorldView | null>(null);
/** Bumped whenever money may have moved outside the monthly settlement (a command), so economy views refetch. */
export const economyEpoch = signal(0);
/** Every army in the field and every war, sent each day while there are any. */
export const armies = signal<ArmyView[]>([]);
export const wars = signal<WarView[]>([]);
export const sieges = signal<SiegeView[]>([]);
/** Called with what the player should hear about (set by the UI). */
export let onNotices: (notices: Notice[]) => void = () => {};
export function setNoticeHandler(fn: (notices: Notice[]) => void) {
  onNotices = fn;
}

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, (msg: FromWorker) => void>();
let nextRequestId = 1;

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.type === 'status') {
    status.value = { day: msg.day, speed: msg.speed, paused: msg.paused, player: msg.player, treasury: msg.treasury, net: msg.net };
    return;
  }
  if (msg.type === 'world') {
    world.value = { realms: msg.realms, owner: msg.owner, controller: msg.controller, modifiers: msg.modifiers, development: msg.development };
    return;
  }
  if (msg.type === 'armies') {
    armies.value = msg.armies;
    wars.value = msg.wars;
    sieges.value = msg.sieges;
    return;
  }
  if (msg.type === 'notices') {
    economyEpoch.value++;
    onNotices(msg.notices);
    return;
  }
  pending.get(msg.requestId)?.(msg);
  pending.delete(msg.requestId);
};

const send = (msg: ToWorker) => worker.postMessage(msg);

function request(build: (requestId: number) => ToWorker): Promise<FromWorker> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    send(build(requestId));
  });
}

export function command(cmd: Command) {
  send({ type: 'command', cmd });
  economyEpoch.value++;
}

/** Asks the worker about a realm's or a province's money. */
export async function query(q: { kind: 'realm'; id: number }): Promise<RealmReport | null>;
export async function query(q: { kind: 'province'; id: number }): Promise<ProvinceReport | null>;
export async function query(q: { kind: 'character'; id: number }): Promise<CharacterReport | null>;
export async function query(q: EconomyQuery): Promise<RealmReport | ProvinceReport | CharacterReport | null> {
  const msg = await request((requestId) => ({ type: 'query', requestId, query: q }));
  return msg.type === 'queryResult' ? msg.result : null;
}

export function startGame(seed: number, scenario: Scenario, content: Content) {
  send({ type: 'init', seed, scenario, content });
}

export async function getSaveText(): Promise<string> {
  const msg = await request((requestId) => ({ type: 'requestSave', requestId }));
  if (msg.type !== 'saveData') throw new Error('Unexpected worker reply');
  return msg.text;
}

/** Resolves on success, rejects with the save error message otherwise. */
export async function loadSaveText(text: string): Promise<void> {
  const msg = await request((requestId) => ({ type: 'load', requestId, text }));
  if (msg.type !== 'loaded') throw new Error('Unexpected worker reply');
  if (msg.error) throw new Error(msg.error);
}
