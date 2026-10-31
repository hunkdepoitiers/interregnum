import { signal } from '@preact/signals';
import type { Command } from '../sim/commands';
import type { Speed } from '../sim/state';
import type { FromWorker, ToWorker } from '../worker/protocol';

/** Main-thread handle on the simulation worker. The UI reads these signals and never touches sim state. */
export const day = signal(0);
export const speed = signal<Speed>(2);
export const paused = signal(true);

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, (msg: FromWorker) => void>();
let nextRequestId = 1;

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.type === 'status') {
    day.value = msg.day;
    speed.value = msg.speed;
    paused.value = msg.paused;
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

export function newGame(seed: number) {
  send({ type: 'newGame', seed });
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
