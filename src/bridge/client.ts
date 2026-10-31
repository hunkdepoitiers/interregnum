import { signal } from '@preact/signals';
import type { Command } from '../sim/commands';
import type { Scenario } from '../sim/scenario';
import type { Speed } from '../sim/state';
import type { FromWorker, ToWorker, WorldView } from '../worker/protocol';

/**
 * Main-thread handle on the simulation worker. The UI reads this signal and never touches sim state.
 * One object signal, replaced on every status message: with separate signals per field, a component
 * only re-rendered when the day changed, so pause/speed changes showed one update late.
 */
export const status = signal<{ day: number; speed: Speed; paused: boolean }>({ day: 0, speed: 2, paused: true });
/** Realms and who owns/holds each province; null until the worker has started a game. */
export const world = signal<WorldView | null>(null);

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, (msg: FromWorker) => void>();
let nextRequestId = 1;

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.type === 'status') {
    status.value = { day: msg.day, speed: msg.speed, paused: msg.paused };
    return;
  }
  if (msg.type === 'world') {
    world.value = { realms: msg.realms, owner: msg.owner, controller: msg.controller };
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
}

export function startGame(seed: number, scenario: Scenario) {
  send({ type: 'init', seed, scenario });
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
