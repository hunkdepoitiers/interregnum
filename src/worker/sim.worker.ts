/// <reference lib="webworker" />
import { applyCommand } from '../sim/commands';
import type { Content } from '../sim/content';
import { deserialize, serialize } from '../sim/save';
import type { Scenario } from '../sim/scenario';
import { newGame, type GameState, type Speed } from '../sim/state';
import { tick } from '../sim/tick';
import type { FromWorker, ToWorker } from './protocol';

/** Milliseconds per game day (speed 5 ≈ 100 days per second, if the tick keeps up). */
const DAY_MS: Record<Speed, number> = { 1: 1000, 2: 400, 3: 150, 4: 50, 5: 10 };

let scenario: Scenario | null = null;
let content: Content | null = null;
let state: GameState | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function postStatus(s: GameState) {
  post({ type: 'status', day: s.day, speed: s.speed, paused: s.paused });
}

function postWorld(s: GameState) {
  const owner = Uint16Array.from(s.provinces, (p) => p.owner);
  const controller = Uint16Array.from(s.provinces, (p) => p.controller);
  post({ type: 'world', realms: s.realms, owner, controller, modifiers: s.modifiers }, [owner.buffer, controller.buffer]);
}

function schedule() {
  clearTimeout(timer);
  if (state && !state.paused) timer = setTimeout(step, DAY_MS[state.speed]);
}

function step() {
  if (!state) return;
  if (tick(state).modifiersChanged) postWorld(state);
  postStatus(state);
  schedule();
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    scenario = msg.scenario;
    content = msg.content;
    state = newGame(msg.seed, scenario);
    postWorld(state);
  } else if (!state || !scenario) {
    return; // nothing to act on before init
  } else if (msg.type === 'command') {
    if (applyCommand(state, msg.cmd, content ?? undefined)) postWorld(state);
  } else if (msg.type === 'requestSave') {
    post({ type: 'saveData', requestId: msg.requestId, text: serialize(state) });
    return;
  } else if (msg.type === 'load') {
    try {
      state = deserialize(msg.text, { scenario });
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
