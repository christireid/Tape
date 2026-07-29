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

// ── Lifecycle ────────────────────────────────────────────────────────────────

function bootstrap(cfg: FeedConfig): void {
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
  connected = true;
  disconnectUntil = 0;
  burstUntil = 0;
  dataTs = epochNow();
  lastFlushEpoch = epochNow();
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

  if (nowE >= disconnectUntil && !connected) {
    connected = true; // reconnected → resync baselines to avoid false gaps
    for (let i = 0; i < lastSeq.length; i++) lastSeq[i] = quotes[i]!.seq;
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
      if (config) config = { ...config, ...msg.patch };
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
