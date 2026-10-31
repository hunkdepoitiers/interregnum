/// <reference lib="webworker" />
import { applyCommand } from '../sim/commands';
import { deserialize, serialize } from '../sim/save';
import { newGame, type GameState, type Speed } from '../sim/state';
import { tick } from '../sim/tick';
import type { FromWorker, ToWorker } from './protocol';

/** Milliseconds per game day (speed 5 ≈ 100 days per second, if the tick keeps up). */
const DAY_MS: Record<Speed, number> = { 1: 1000, 2: 400, 3: 150, 4: 50, 5: 10 };

let state: GameState = newGame(1302);
let timer: ReturnType<typeof setTimeout> | undefined;

const post = (msg: FromWorker) => self.postMessage(msg);
const postStatus = () => post({ type: 'status', day: state.day, speed: state.speed, paused: state.paused });

function schedule() {
  clearTimeout(timer);
  if (!state.paused) timer = setTimeout(step, DAY_MS[state.speed]);
}

function step() {
  tick(state);
  postStatus();
  schedule();
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'newGame':
      state = newGame(msg.seed);
      break;
    case 'command':
      applyCommand(state, msg.cmd);
      break;
    case 'requestSave':
      post({ type: 'saveData', requestId: msg.requestId, text: serialize(state) });
      return;
    case 'load':
      try {
        state = deserialize(msg.text);
        state.paused = true;
        post({ type: 'loaded', requestId: msg.requestId, error: null });
      } catch (err) {
        post({ type: 'loaded', requestId: msg.requestId, error: err instanceof Error ? err.message : String(err) });
      }
      break;
  }
  postStatus();
  schedule();
};
