// The feed worker. Everything on the tick path lives here: transport,
// per-instrument sequencing, conflation (last-value-wins), position keeping and
// P&L. The main thread receives finished arrays and never does O(positions)
// work per tick (spec §4).

import {
  FRAME_FIELD_COUNT,
  POS_FIELD_COUNT,
  type FeedConfig,
  type Instrument,
  type Order,
  type PortfolioTotals,
  type WorkerInbound,
} from '../domain/types.ts';
import {
  buildUniverse,
  initQuote,
  mulberry32,
  stepQuote,
  type Quote,
} from '../sim/model.ts';
import { applyFill as applyFillBook, unrealised, type Book } from '../domain/pnl.ts';
import { decodeTicks } from './codec.ts';

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

// ── Worker state ─────────────────────────────────────────────────────────────

interface Pos {
  index: number;
  netQty: number;
  avgCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  marketValue: number;
}

let config: FeedConfig | null = null;
let instruments: Instrument[] = [];
let quotes: Quote[] = [];
let lastSeq: Int32Array = new Int32Array(0);
let rng: () => number = mulberry32(1);
let generation = 0;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastFlushEpoch = 0;
let gapsRecovered = 0;
let connected = true;
let disconnectUntil = 0;
let burstUntil = 0;
let dataTs = 0;
let slowAccum = 0;

const changed = new Set<number>();
const positions = new Map<number, Pos>();
const orders = new Map<string, Order>();

// ── WebSocketTransport ───────────────────────────────────────────────────────
// The second transport (§5.2). It shares everything that matters with the
// simulator: the same codec (codec.ts, also imported by the feed server), the
// same per-instrument sequence check, the same conflation set and flush. Only
// tick *production* differs — the server produces, this decodes.
// Both ends build the universe deterministically from (seed, universe, nowMs),
// so the wire carries numeric indices only.

const WS_URL = 'ws://127.0.0.1:8181';
let ws: WebSocket | null = null;
let wsMsgsAccum = 0;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;

function applyWireTicks(buf: ArrayBuffer): void {
  const ticks = decodeTicks(buf);
  if (!ticks) return; // foreign/corrupt frame — drop, never crash the worker
  for (const t of ticks) {
    const q = quotes[t.index];
    if (!q) continue;
    q.mid = t.mid;
    q.bid = t.bid;
    q.ask = t.ask;
    q.bidSize = t.bidSize;
    q.askSize = t.askSize;
    q.last = t.last;
    q.high = t.high;
    q.low = t.low;
    q.volume = t.volume;
    q.seq = t.seq;
    checkSequence(t.index, t.seq); // same discipline as the simulator path
    changed.add(t.index);
    wsMsgsAccum += 1;
  }
}

function wsStart(): void {
  if (!config || ws) return;
  const socket = new WebSocket(WS_URL);
  socket.binaryType = 'arraybuffer';
  ws = socket;
  socket.onopen = () => {
    connected = true;
    // Handshake: the server derives the identical universe from this config.
    socket.send(
      JSON.stringify({
        type: 'hello',
        seed: config?.seed,
        universe: config?.universe,
        nowMs: config?.nowMs,
        rate: config?.rate,
      }),
    );
    // Resync sequence expectations — a reconnect must not count as gaps.
    for (let i = 0; i < lastSeq.length; i++) lastSeq[i] = -1;
  };
  socket.onmessage = (ev: MessageEvent) => {
    if (ev.data instanceof ArrayBuffer) applyWireTicks(ev.data);
  };
  socket.onclose = () => {
    if (ws === socket) {
      ws = null;
      connected = false;
      if (config?.transport === 'websocket' && wsRetryTimer === null) {
        wsRetryTimer = setTimeout(() => {
          wsRetryTimer = null;
          wsStart();
        }, 2000);
      }
    }
  };
  socket.onerror = () => socket.close();
}

function wsStop(): void {
  if (wsRetryTimer !== null) {
    clearTimeout(wsRetryTimer);
    wsRetryTimer = null;
  }
  if (ws) {
    const s = ws;
    ws = null;
    s.close();
  }
}

function wsSendControl(patch: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'config', ...patch }));
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function bootstrap(cfg: FeedConfig): void {
  wsStop();
  config = cfg;
  generation += 1;
  rng = mulberry32(cfg.seed);
  instruments = buildUniverse(cfg);
  quotes = instruments.map((inst) => initQuote(inst));
  lastSeq = new Int32Array(instruments.length).fill(-1);
  changed.clear();
  positions.clear();
  orders.clear();
  gapsRecovered = 0;
  connected = cfg.transport !== 'websocket'; // ws connects asynchronously
  disconnectUntil = 0;
  burstUntil = 0;
  dataTs = epochNow();
  lastFlushEpoch = epochNow();
  wsMsgsAccum = 0;
  if (cfg.transport === 'websocket') wsStart();
  ctx.postMessage({ type: 'ready', generation, instruments });
}

function scheduleNext(): void {
  const interval = config && config.conflateMs > 0 ? config.conflateMs : 8;
  timer = setTimeout(flush, interval);
}

// ── Sequence discipline ──────────────────────────────────────────────────────
// Runs on the raw stream, before conflation. In steady state consecutive seqs
// keep the gap counter at 0; an injected gap makes seq skip, which the check
// detects and then resynchronises its expectation from the current book.

function checkSequence(index: number, seq: number): void {
  const prev = lastSeq[index]!;
  if (prev >= 0 && seq !== prev + 1) {
    gapsRecovered += 1; // detected → recover: adopt the current book as truth
  }
  lastSeq[index] = seq;
}

// ── Production, bounded to the nominal window ─────────────────────────────────

function produce(nowE: number, measuredDt: number): number {
  if (!config) return 0;
  // WebSocket mode: the server produces; drain what the socket delivered.
  if (config.transport === 'websocket') {
    const n = wsMsgsAccum;
    wsMsgsAccum = 0;
    return n;
  }
  if (!connected) return 0;

  const rate = nowE < burstUntil ? config.rate * 5 : config.rate;
  // Derive the budget from the nominal window, not the measured frame time —
  // measured dt compounds (a slow frame begets a larger, slower one).
  const window = Math.min(measuredDt, Math.max(config.conflateMs, 8) * 1.5);
  const want = Math.max(1, Math.round((rate * window) / 1000));

  const n = instruments.length;
  let totalActivity = 0;
  for (const inst of instruments) totalActivity += inst.activity;

  for (let m = 0; m < want; m++) {
    // Weighted instrument pick by activity.
    let r = rng() * totalActivity;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      r -= instruments[i]!.activity;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const inst = instruments[idx]!;
    const q = quotes[idx]!;
    stepQuote(inst, q, Math.max(window, 8), rng);
    checkSequence(idx, q.seq);
    changed.add(idx);
  }
  return want;
}

// ── Positions and P&L ────────────────────────────────────────────────────────

function applyFill(index: number, side: 'BUY' | 'SELL', qty: number, price: number): void {
  let p = positions.get(index);
  if (!p) {
    p = { index, netQty: 0, avgCost: 0, realizedPnl: 0, unrealizedPnl: 0, marketValue: 0 };
    positions.set(index, p);
  }
  const book: Book = { netQty: p.netQty, avgCost: p.avgCost, realizedPnl: p.realizedPnl };
  const next = applyFillBook(book, side, qty, price);
  p.netQty = next.netQty;
  p.avgCost = next.avgCost;
  p.realizedPnl = next.realizedPnl;
}

function markPositions(): void {
  for (const p of positions.values()) {
    const q = quotes[p.index]!;
    p.marketValue = p.netQty * q.mid;
    p.unrealizedPnl = unrealised({ netQty: p.netQty, avgCost: p.avgCost, realizedPnl: p.realizedPnl }, q.mid);
  }
}

function computeTotals(): PortfolioTotals {
  let marketValue = 0;
  let unrealized = 0;
  let realized = 0;
  let gross = 0;
  let netExp = 0;
  let count = 0;
  for (const p of positions.values()) {
    marketValue += p.marketValue;
    unrealized += p.unrealizedPnl;
    realized += p.realizedPnl;
    gross += Math.abs(p.marketValue);
    netExp += p.marketValue;
    if (p.netQty !== 0) count += 1;
  }
  return {
    marketValue,
    unrealized,
    realized,
    net: realized + unrealized,
    grossExposure: gross,
    netExposure: netExp,
    positionCount: count,
  };
}

// ── Orders ───────────────────────────────────────────────────────────────────

function emitOrder(o: Order): void {
  orders.set(o.id, { ...o });
  ctx.postMessage({ type: 'order', order: { ...o } });
}

function acceptOrder(order: Order): void {
  const inst = instruments.find((i) => i.id === order.instrumentId);
  if (!inst) {
    emitOrder({ ...order, status: 'REJECTED', reason: 'unknown instrument' });
    return;
  }
  emitOrder({ ...order, status: 'WORKING' });
}

function workOrders(): void {
  for (const o of orders.values()) {
    if (o.status !== 'WORKING' && o.status !== 'PARTIAL') continue;
    const inst = instruments.find((i) => i.id === o.instrumentId);
    if (!inst) continue;
    const q = quotes[inst.index]!;
    const marketable =
      o.type === 'MARKET' ||
      (o.side === 'BUY' && o.limitPrice !== null && o.limitPrice >= q.ask) ||
      (o.side === 'SELL' && o.limitPrice !== null && o.limitPrice <= q.bid);
    if (!marketable) continue;

    const remaining = o.qty - o.filledQty;
    if (remaining <= 0) continue;
    // Partial slice so the interface exercises partial-fill state.
    const slice = Math.min(remaining, Math.max(inst.lotSize, Math.round(remaining * (0.3 + rng() * 0.5))));
    const px = o.side === 'BUY' ? q.ask : q.bid;
    applyFill(inst.index, o.side, slice, px);
    const filled = o.filledQty + slice;
    const avg =
      (o.avgFillPrice * o.filledQty + px * slice) / filled;
    const status = filled >= o.qty ? 'FILLED' : 'PARTIAL';
    emitOrder({ ...o, filledQty: filled, avgFillPrice: avg, status });
  }
}

function cancelOrder(id: string): void {
  const o = orders.get(id);
  if (!o) return;
  if (o.status === 'FILLED' || o.status === 'CANCELLED' || o.status === 'REJECTED') return;
  emitOrder({ ...o, status: 'CANCELLED' });
}

function flatten(): void {
  for (const p of positions.values()) {
    if (p.netQty === 0) continue;
    const inst = instruments[p.index]!;
    const q = quotes[p.index]!;
    const side = p.netQty > 0 ? 'SELL' : 'BUY';
    const qty = Math.abs(p.netQty);
    const px = side === 'SELL' ? q.bid : q.ask;
    applyFill(p.index, side, qty, px);
    emitOrder({
      id: `flat-${inst.id}-${Math.round(epochNow())}`,
      instrumentId: inst.id,
      symbol: inst.symbol,
      side,
      type: 'MARKET',
      qty,
      limitPrice: null,
      status: 'FILLED',
      filledQty: qty,
      avgFillPrice: px,
      createdAt: epochNow(),
      reason: 'flatten',
    });
  }
}

// ── Fault injection ──────────────────────────────────────────────────────────

function injectGap(): void {
  const n = instruments.length;
  const hits = Math.min(40, n);
  for (let k = 0; k < hits; k++) {
    const i = Math.floor(rng() * n);
    quotes[i]!.seq += 4; // simulate dropped messages → detected on next tick
  }
}

// ── Flush ────────────────────────────────────────────────────────────────────

function flush(): void {
  const nowE = epochNow();
  const measuredDt = nowE - lastFlushEpoch;

  if (nowE >= disconnectUntil && !connected && disconnectUntil > 0) {
    disconnectUntil = 0;
    if (config?.transport === 'websocket') {
      wsStart(); // reconnect; sequence baselines resync in onopen
    } else {
      connected = true; // reconnected → resync baselines to avoid false gaps
      for (let i = 0; i < lastSeq.length; i++) lastSeq[i] = quotes[i]!.seq;
    }
  }

  const msgsIn = produce(nowE, measuredDt);
  workOrders();
  markPositions();

  // Build the columnar frame for changed rows.
  const ids = new Int32Array(changed.size);
  const values = new Float64Array(changed.size * FRAME_FIELD_COUNT);
  let w = 0;
  for (const idx of changed) {
    ids[w] = idx;
    const q = quotes[idx]!;
    const inst = instruments[idx]!;
    const change = q.last - q.prevClose;
    const changePct = q.prevClose !== 0 ? (change / q.prevClose) * 100 : 0;
    const base = w * FRAME_FIELD_COUNT;
    values[base + 0] = q.bid;
    values[base + 1] = q.ask;
    values[base + 2] = q.bidSize;
    values[base + 3] = q.askSize;
    values[base + 4] = q.last;
    values[base + 5] = change;
    values[base + 6] = changePct;
    values[base + 7] = q.ask - q.bid;
    values[base + 8] = q.high;
    values[base + 9] = q.low;
    values[base + 10] = q.volume;
    values[base + 11] = q.seq;
    w += 1;
    void inst;
  }
  const rowsOut = changed.size;
  changed.clear();

  // Positions array (finished — the main thread only reads it).
  const posArr = new Float64Array(positions.size * POS_FIELD_COUNT);
  let pw = 0;
  for (const p of positions.values()) {
    const b = pw * POS_FIELD_COUNT;
    posArr[b + 0] = p.index;
    posArr[b + 1] = p.netQty;
    posArr[b + 2] = p.avgCost;
    posArr[b + 3] = p.realizedPnl;
    posArr[b + 4] = p.unrealizedPnl;
    posArr[b + 5] = p.marketValue;
    pw += 1;
  }

  if (msgsIn > 0) dataTs = nowE;

  ctx.postMessage(
    {
      type: 'frame',
      ids,
      values,
      positions: posArr,
      oldestTs: lastFlushEpoch,
      newestTs: nowE,
      rowsOut,
      msgsIn,
      generation,
    },
    [ids.buffer, values.buffer, posArr.buffer],
  );

  // Slow channel ~4 Hz for aggregate figures.
  slowAccum += measuredDt;
  if (slowAccum >= 250) {
    slowAccum = 0;
    ctx.postMessage({
      type: 'slow',
      totals: computeTotals(),
      gapsRecovered,
      connected,
      dataTs,
    });
  }

  lastFlushEpoch = nowE;
  scheduleNext();
}

// ── Message pump ─────────────────────────────────────────────────────────────

ctx.onmessage = (ev: MessageEvent<WorkerInbound>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'start':
      if (timer !== null) return; // StrictMode double-invoke guard
      bootstrap(msg.config);
      scheduleNext();
      break;
    case 'config':
      if (config) {
        const prevTransport = config.transport;
        config = { ...config, ...msg.patch };
        if (msg.patch.rate !== undefined) wsSendControl({ rate: msg.patch.rate });
        if (msg.patch.transport && msg.patch.transport !== prevTransport) {
          if (msg.patch.transport === 'websocket') {
            connected = false;
            wsStart();
          } else {
            wsStop();
            connected = true;
            for (let i = 0; i < lastSeq.length; i++) lastSeq[i] = quotes[i]!.seq;
          }
        }
      }
      break;
    case 'universe':
      if (config) {
        if (timer !== null) clearTimeout(timer);
        bootstrap({ ...config, universe: msg.universe });
        scheduleNext();
      }
      break;
    case 'fault':
      if (msg.fault === 'gap') injectGap();
      else if (msg.fault === 'disconnect') {
        connected = false;
        disconnectUntil = epochNow() + 4000;
        if (config?.transport === 'websocket') wsStop(); // drop the socket too
      } else if (msg.fault === 'burst') {
        burstUntil = epochNow() + 3000;
      }
      break;
    case 'submit':
      acceptOrder(msg.order);
      break;
    case 'cancel':
      cancelOrder(msg.id);
      break;
    case 'flatten':
      flatten();
      break;
    default:
      break;
  }
};
