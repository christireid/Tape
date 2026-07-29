// The store that lives outside React. It owns the worker, holds the full row
// snapshot, and exposes two channels:
//   • onFrame — the hot path. The grid and the canvas subscribe. Never React.
//   • onSlow  — ~4 Hz aggregates. Exactly one React hook subscribes.
//
// All instrumentation is here too: fps from rAF, long tasks from a
// PerformanceObserver, tick-to-screen from frame timestamps closed at paint,
// and heap sampled every second.

import {
  FRAME_FIELD_COUNT,
  POS_FIELD_COUNT,
  type BlotterRow,
  type ConflationWindow,
  type EngineKind,
  type FaultKind,
  type FeedConfig,
  type Health,
  type Instrument,
  type MessageRate,
  type Order,
  type OrderType,
  type PortfolioTotals,
  type Position,
  type Side,
  type Telemetry,
  type TransportKind,
  type UniverseSize,
  type WorkerOutbound,
} from '../domain/types.ts';

const EMPTY_TOTALS: PortfolioTotals = {
  marketValue: 0,
  unrealized: 0,
  realized: 0,
  net: 0,
  grossExposure: 0,
  netExposure: 0,
  positionCount: 0,
};

export type FrameListener = (changed: Int32Array, rows: BlotterRow[]) => void;
export type SlowListener = () => void;

function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

interface PerfMemory {
  usedJSHeapSize: number;
}

export class MarketStore {
  instruments: Instrument[] = [];
  rows: BlotterRow[] = [];
  generation = 0;
  positions: Position[] = [];
  orders: Order[] = [];
  engine: EngineKind = 'aggrid';

  config: FeedConfig = {
    universe: 1200,
    rate: 8000,
    conflateMs: 16,
    transport: 'simulator',
    seed: 0x9e3779b9,
    nowMs: Date.now(),
  };

  private worker: Worker | null = null;
  private frameListeners = new Set<FrameListener>();
  private slowListeners = new Set<SlowListener>();

  private totals: PortfolioTotals = EMPTY_TOTALS;
  private gapsRecovered = 0;
  private connected = true;
  private dataTs = epochNow();

  // Latency: last frame's timestamps, closed at paint.
  private lastOldest = 0;
  private lastNewest = 0;
  private t2s: number[] = [];
  private readonly T2S_CAP = 1024;

  // Throughput accumulators, drained on the slow tick.
  private accMsgsIn = 0;
  private accRowsOut = 0;
  private accStart = epochNow();

  // fps / long tasks / heap
  private fps = 0;
  private frameCount = 0;
  private fpsWindowStart = 0;
  private longTasks = 0;
  private longTaskSupported = false;
  private heapMB: number | null = null;
  private rafId = 0;
  private observer: PerformanceObserver | null = null;
  private heapTimer: ReturnType<typeof setInterval> | null = null;

  private startEpoch = 0;
  private warmupMs = 3000;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.worker) return; // StrictMode double-mount guard
    this.startEpoch = epochNow();
    this.config = { ...this.config, nowMs: Date.now() };
    this.worker = new Worker(new URL('../worker/feed.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => this.onWorker(ev.data);
    this.worker.postMessage({ type: 'start', config: this.config });

    this.startInstrumentation();
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.observer) this.observer.disconnect();
    if (this.heapTimer) clearInterval(this.heapTimer);
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private startInstrumentation(): void {
    this.fpsWindowStart = performance.now();
    const loop = (): void => {
      this.frameCount += 1;
      const now = performance.now();
      const elapsed = now - this.fpsWindowStart;
      if (elapsed >= 500) {
        this.fps = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.fpsWindowStart = now;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    try {
      this.observer = new PerformanceObserver((list) => {
        this.longTasks += list.getEntries().length;
      });
      this.observer.observe({ entryTypes: ['longtask'] });
      this.longTaskSupported = true;
    } catch {
      this.longTaskSupported = false; // report unavailability rather than faking
    }

    const mem = (performance as unknown as { memory?: PerfMemory }).memory;
    if (mem) {
      this.heapTimer = setInterval(() => {
        this.heapMB = mem.usedJSHeapSize / (1024 * 1024);
      }, 1000);
    }
  }

  // ── Worker messages ──────────────────────────────────────────────────────────

  private onWorker(msg: WorkerOutbound): void {
    switch (msg.type) {
      case 'ready':
        this.generation = msg.generation;
        this.instruments = msg.instruments;
        this.rows = msg.instruments.map((inst) => this.seedRow(inst));
        this.positions = [];
        this.orders = [];
        this.notifySlow();
        break;
      case 'frame':
        this.applyFrame(msg.ids, msg.values, msg.positions, msg.oldestTs, msg.newestTs);
        this.accMsgsIn += msg.msgsIn;
        this.accRowsOut += msg.rowsOut;
        break;
      case 'slow':
        this.totals = msg.totals;
        this.gapsRecovered = msg.gapsRecovered;
        this.connected = msg.connected;
        this.dataTs = msg.dataTs;
        this.notifySlow();
        break;
      case 'order':
        this.upsertOrder(msg.order);
        this.notifySlow();
        break;
      default:
        break;
    }
  }

  private seedRow(inst: Instrument): BlotterRow {
    return {
      id: inst.id,
      index: inst.index,
      symbol: inst.symbol,
      name: inst.name,
      sector: inst.sector,
      tickSize: inst.tickSize,
      lotSize: inst.lotSize,
      priceFormat: inst.priceFormat,
      prevClose: inst.prevClose,
      bid: inst.anchorMid,
      ask: inst.anchorMid,
      bidSize: 0,
      askSize: 0,
      last: inst.anchorMid,
      change: 0,
      changePct: 0,
      spread: 0,
      high: inst.anchorMid,
      low: inst.anchorMid,
      volume: 0,
      seq: 0,
    };
  }

  private applyFrame(
    ids: Int32Array,
    values: Float64Array,
    positions: Float64Array,
    oldest: number,
    newest: number,
  ): void {
    for (let w = 0; w < ids.length; w++) {
      const idx = ids[w]!;
      const row = this.rows[idx];
      if (!row) continue;
      const b = w * FRAME_FIELD_COUNT;
      row.bid = values[b + 0]!;
      row.ask = values[b + 1]!;
      row.bidSize = values[b + 2]!;
      row.askSize = values[b + 3]!;
      row.last = values[b + 4]!;
      row.change = values[b + 5]!;
      row.changePct = values[b + 6]!;
      row.spread = values[b + 7]!;
      row.high = values[b + 8]!;
      row.low = values[b + 9]!;
      row.volume = values[b + 10]!;
      row.seq = values[b + 11]!;
    }

    // Positions: rebuild the finished array the worker handed us.
    const count = positions.length / POS_FIELD_COUNT;
    const next: Position[] = [];
    for (let p = 0; p < count; p++) {
      const base = p * POS_FIELD_COUNT;
      const index = positions[base + 0]!;
      const inst = this.instruments[index];
      if (!inst) continue;
      const netQty = positions[base + 1]!;
      if (netQty === 0) continue;
      next.push({
        instrumentId: inst.id,
        symbol: inst.symbol,
        netQty,
        avgCost: positions[base + 2]!,
        realizedPnl: positions[base + 3]!,
        unrealizedPnl: positions[base + 4]!,
        marketValue: positions[base + 5]!,
      });
    }
    this.positions = next;

    this.lastOldest = oldest;
    this.lastNewest = newest;

    for (const cb of this.frameListeners) cb(ids, this.rows);
  }

  /**
   * Called by the active engine after its transaction queue has flushed and one
   * animation frame has painted — the first moment the number means what it
   * claims. Both ends of the batch are sampled.
   */
  /** Clear latency + throughput accumulators and re-arm the warm-up discard.
   * Used by the bench harness between matrix cells so each cell is measured
   * from a clean slate. */
  resetSamples(): void {
    this.t2s = [];
    this.startEpoch = epochNow();
    this.accMsgsIn = 0;
    this.accRowsOut = 0;
    this.accStart = epochNow();
  }

  recordPaint(): void {
    if (epochNow() - this.startEpoch < this.warmupMs) return; // discard warm-up
    const now = epochNow();
    if (this.lastOldest > 0) this.push(now - this.lastOldest);
    if (this.lastNewest > 0) this.push(now - this.lastNewest);
  }

  private push(v: number): void {
    if (v < 0 || v > 60000) return;
    this.t2s.push(v);
    if (this.t2s.length > this.T2S_CAP) this.t2s.shift();
  }

  private upsertOrder(order: Order): void {
    const i = this.orders.findIndex((o) => o.id === order.id);
    if (i >= 0) this.orders[i] = order;
    else this.orders.unshift(order);
    if (this.orders.length > 200) this.orders.length = 200;
  }

  // ── Subscriptions ────────────────────────────────────────────────────────────

  onFrame(cb: FrameListener): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onSlow(cb: SlowListener): () => void {
    this.slowListeners.add(cb);
    return () => this.slowListeners.delete(cb);
  }

  slowVersion = 0;
  private notifySlow(): void {
    this.slowVersion += 1;
    for (const cb of this.slowListeners) cb();
  }

  // ── Telemetry snapshot ───────────────────────────────────────────────────────

  getTelemetry(): Telemetry {
    const now = epochNow();
    const elapsed = (now - this.accStart) / 1000;
    let msgsInPerSec = 0;
    let rowsOutPerSec = 0;
    if (elapsed >= 0.24) {
      msgsInPerSec = this.accMsgsIn / elapsed;
      rowsOutPerSec = this.accRowsOut / elapsed;
      this.accMsgsIn = 0;
      this.accRowsOut = 0;
      this.accStart = now;
      this.cachedMsgsIn = msgsInPerSec;
      this.cachedRowsOut = rowsOutPerSec;
    } else {
      msgsInPerSec = this.cachedMsgsIn;
      rowsOutPerSec = this.cachedRowsOut;
    }
    const ratio = rowsOutPerSec > 0 ? msgsInPerSec / rowsOutPerSec : 1;

    const sorted = [...this.t2s].sort((a, b) => a - b);
    const dataAgeMs = now - this.dataTs;
    const health: Health = !this.connected
      ? 'down'
      : dataAgeMs > 2000
        ? 'stale'
        : 'live';

    return {
      t2sP50: percentile(sorted, 50),
      t2sP95: percentile(sorted, 95),
      t2sP99: percentile(sorted, 99),
      fps: this.fps,
      longTasks: this.longTasks,
      longTaskSupported: this.longTaskSupported,
      msgsInPerSec,
      rowsOutPerSec,
      conflationRatio: ratio,
      gapsRecovered: this.gapsRecovered,
      heapMB: this.heapMB,
      connected: this.connected,
      health,
      dataAgeMs,
    };
  }

  private cachedMsgsIn = 0;
  private cachedRowsOut = 0;

  getTotals(): PortfolioTotals {
    return this.totals;
  }

  // ── Controls ─────────────────────────────────────────────────────────────────

  setUniverse(universe: UniverseSize): void {
    this.config = { ...this.config, universe };
    this.worker?.postMessage({ type: 'universe', universe });
  }
  setRate(rate: MessageRate): void {
    this.config = { ...this.config, rate };
    this.worker?.postMessage({ type: 'config', patch: { rate } });
  }
  setConflate(conflateMs: ConflationWindow): void {
    this.config = { ...this.config, conflateMs };
    this.worker?.postMessage({ type: 'config', patch: { conflateMs } });
  }
  setTransport(transport: TransportKind): void {
    this.config = { ...this.config, transport };
    this.worker?.postMessage({ type: 'config', patch: { transport } });
  }
  setEngine(engine: EngineKind): void {
    this.engine = engine;
    this.notifySlow();
  }
  injectFault(fault: FaultKind): void {
    this.worker?.postMessage({ type: 'fault', fault });
  }

  submitOrder(draft: {
    instrumentId: string;
    symbol: string;
    side: Side;
    type: OrderType;
    qty: number;
    limitPrice: number | null;
  }): Order {
    const order: Order = {
      id: `o-${this.orderSeq++}-${Math.round(epochNow())}`,
      instrumentId: draft.instrumentId,
      symbol: draft.symbol,
      side: draft.side,
      type: draft.type,
      qty: draft.qty,
      limitPrice: draft.limitPrice,
      status: 'PENDING', // optimistic; the worker confirms
      filledQty: 0,
      avgFillPrice: 0,
      createdAt: epochNow(),
    };
    this.upsertOrder(order);
    this.worker?.postMessage({ type: 'submit', order });
    this.notifySlow();
    return order;
  }
  private orderSeq = 1;

  cancelOrder(id: string): void {
    this.worker?.postMessage({ type: 'cancel', id });
  }
  flatten(): void {
    this.worker?.postMessage({ type: 'flatten' });
  }

  rowByIndex(index: number): BlotterRow | undefined {
    return this.rows[index];
  }
  rowById(id: string): BlotterRow | undefined {
    return this.rows.find((r) => r.id === id);
  }
}

// Single instance for the app — created outside React, on purpose.
export const store = new MarketStore();
