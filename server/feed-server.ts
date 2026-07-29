// The WebSocket feed server (§5.2). Runs the SAME price model and the SAME
// binary codec as the in-browser simulator — that sharing is the point: the
// worker's sequencing, conflation and recovery code cannot tell the transports
// apart, and the universe is derived deterministically on both ends from the
// handshake's (seed, universe, nowMs), so only numeric indices cross the wire.
//
//   npm run feed-server          # ws://127.0.0.1:8181
//
// Runs under Node 22's type stripping — no build step:
//   node --experimental-strip-types server/feed-server.ts
//
// Deployment note (spec §5.2): host on a persistent VM or Durable Objects, not
// a function platform — a continuous tick feed needs persistent in-memory
// state. The public demo deliberately does not depend on this server.

import { WebSocketServer, type WebSocket } from 'ws';
import {
  buildUniverse,
  initQuote,
  mulberry32,
  stepQuote,
  type Quote,
} from '../src/sim/model.ts';
import { encodeTicks, type WireTick } from '../src/worker/codec.ts';
import type { FeedConfig, Instrument } from '../src/domain/types.ts';

const PORT = Number(process.env.FEED_PORT ?? 8181);
const INTERVAL_MS = 8;

interface Session {
  instruments: Instrument[];
  quotes: Quote[];
  rng: () => number;
  rate: number;
  totalActivity: number;
  timer: ReturnType<typeof setInterval> | null;
}

function startSession(socket: WebSocket, hello: Record<string, unknown>): Session {
  const cfg: FeedConfig = {
    universe: (Number(hello.universe) || 1200) as FeedConfig['universe'],
    rate: (Number(hello.rate) || 8000) as FeedConfig['rate'],
    conflateMs: 16,
    transport: 'websocket',
    seed: Number(hello.seed) || 0x9e3779b9,
    nowMs: Number(hello.nowMs) || Date.now(),
  };
  const instruments = buildUniverse(cfg);
  const quotes = instruments.map((inst) => initQuote(inst));
  const rng = mulberry32(cfg.seed);
  let totalActivity = 0;
  for (const inst of instruments) totalActivity += inst.activity;

  const session: Session = {
    instruments,
    quotes,
    rng,
    rate: cfg.rate,
    totalActivity,
    timer: null,
  };

  session.timer = setInterval(() => {
    const want = Math.max(1, Math.round((session.rate * INTERVAL_MS) / 1000));
    const batch: WireTick[] = [];
    for (let m = 0; m < want; m++) {
      // Weighted instrument pick by activity — identical to the simulator path.
      let r = session.rng() * session.totalActivity;
      let idx = 0;
      for (let i = 0; i < session.instruments.length; i++) {
        r -= session.instruments[i]!.activity;
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      const inst = session.instruments[idx]!;
      const q = session.quotes[idx]!;
      stepQuote(inst, q, INTERVAL_MS, session.rng);
      batch.push({
        index: idx,
        seq: q.seq,
        mid: q.mid,
        bid: q.bid,
        ask: q.ask,
        bidSize: q.bidSize,
        askSize: q.askSize,
        last: q.last,
        high: q.high,
        low: q.low,
        volume: q.volume,
      });
    }
    if (socket.readyState === socket.OPEN) {
      socket.send(encodeTicks(batch));
    }
  }, INTERVAL_MS);

  return session;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  let session: Session | null = null;

  socket.on('message', (data, isBinary) => {
    if (isBinary) return; // clients only send JSON control messages
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      if (session?.timer) clearInterval(session.timer);
      session = startSession(socket, msg);
    } else if (msg.type === 'config' && session) {
      if (typeof msg.rate === 'number') session.rate = msg.rate;
    }
  });

  socket.on('close', () => {
    if (session?.timer) clearInterval(session.timer);
    session = null;
  });
});

console.error(`tape feed server listening on ws://127.0.0.1:${PORT}`);
