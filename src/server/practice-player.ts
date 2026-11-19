// Uses the same authenticated socket and role-filtered messages as a browser.
import WebSocket from 'ws';
import type { Action, ClientMsg, PlayerView, ServerMsg } from '../shared/protocol.js';
import { marketBot, type Crew } from './market-bot.js';

export function practicePlayer(url: string, login: Extract<ClientMsg, { t: 'resume' }>, clock: () => number, speed: number) {
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  let socket: WebSocket;
  function connect() {
    const ws = new WebSocket(url);
    socket = ws;
    let pv: PlayerView;
    let bot: ReturnType<typeof marketBot> | undefined;
    let crew: Crew | undefined;
    const errors: string[] = [];
    const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
    ws.on('open', () => {
      if (!stopped) send(login);
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      if (m.t === 'error') {
        errors.push(m.message);
        return;
      }
      if (m.t !== 'view' || m.view.kind !== 'player') return;
      pv = m.view;
      if (pv.phase !== 'play' || !pv.team) {
        bot = undefined;
        return;
      }
      if (!bot) {
        crew = { team: pv.team.id, rocketAttempts: 0, rocketFailures: 0 };
        const client = {
          get pv() {
            return pv;
          },
          errors,
          act: (action: Action) => send({ t: 'act', action }),
        };
        bot = marketBot(
          client,
          crew,
          Math.max(0, Number(pv.team.id.slice(1)) + pv.round - 2),
          clock,
          false,
          () => 1000 + Math.random() * 3000,
        );
      }
      if (crew && pv.team.radio) {
        crew.size = pv.team.radio.size;
        crew.need = pv.team.radio.need;
      }
    });
    const timer = setInterval(
      () => {
        if (!stopped && ws.readyState === WebSocket.OPEN) bot?.step();
      },
      Math.max(25, Math.floor(125 / speed)),
    );
    ws.on('close', () => {
      clearInterval(timer);
      if (!stopped) retry = setTimeout(connect, 1000);
    });
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket.terminate();
  };
}
