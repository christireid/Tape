// Shared domain types. No DOM, no React — imported by the worker, the store and
// the components alike, so it must stay isomorphic.

export type AssetClass = 'fx' | 'future' | 'equity';
export type PriceFormat = 'decimal' | '32nds';

/** Static instrument definition — never changes after the universe is built. */
export interface Instrument {
  /** Stable, unique identifier. Asserted unique at bootstrap (§5.1). */
  id: string;
  /** Numeric index into the universe array — the hot path speaks in indices. */
  index: number;
  symbol: string;
  name: string;
  currency: string;
  tickSize: number;
  lotSize: number;
  assetClass: AssetClass;
  sector: string;
  priceFormat: PriceFormat;
  /** Model parameters. */
  vol: number;
  jumpP: number;
  spreadTicks: number;
  activity: number;
  /** Starting mid, drawn from a domain-plausible anchor range (§5.1). */
  anchorMid: number;
  prevClose: number;
}

/** Live per-instrument state, mutated on every tick. */
export interface PriceState {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  last: number;
  change: number;
  changePct: number;
  spread: number;
  high: number;
  low: number;
  volume: number;
  seq: number;
}

/** Row model the grid consumes — instrument statics + live price, joined. */
export interface BlotterRow extends PriceState {
  id: string;
  index: number;
  symbol: string;
  name: string;
  sector: string;
  tickSize: number;
  lotSize: number;
  priceFormat: PriceFormat;
  prevClose: number;
}

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus =
  | 'PENDING'
  | 'WORKING'
  | 'PARTIAL'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED';

export interface Order {
  id: string;
  instrumentId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  limitPrice: number | null;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  createdAt: number;
  reason?: string;
}

export interface Position {
  instrumentId: string;
  symbol: string;
  netQty: number;
  avgCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  marketValue: number;
}

export interface PortfolioTotals {
  marketValue: number;
  unrealized: number;
  realized: number;
  net: number;
  grossExposure: number;
  netExposure: number;
  positionCount: number;
}

export type Health = 'live' | 'stale' | 'down';

export interface DepthLevel {
  price: number;
  size: number;
  /** true for the top of book (from the feed); false for modelled levels. */
  fromFeed: boolean;
}

export interface Telemetry {
  t2sP50: number;
  t2sP95: number;
  t2sP99: number;
  fps: number;
  longTasks: number;
  longTaskSupported: boolean;
  msgsInPerSec: number;
  rowsOutPerSec: number;
  /** Derived from the two counters above, to one decimal (§5.4). */
  conflationRatio: number;
  gapsRecovered: number;
  heapMB: number | null;
  connected: boolean;
  health: Health;
  dataAgeMs: number;
}

// ── Runtime configuration ────────────────────────────────────────────────────

export type UniverseSize = 500 | 1200 | 5000;
export type MessageRate = 1000 | 8000 | 25000 | 50000;
export type ConflationWindow = 0 | 16 | 50 | 100;
export type TransportKind = 'simulator' | 'websocket';
export type EngineKind = 'aggrid' | 'virtual';
export type FaultKind = 'gap' | 'disconnect' | 'burst';

export interface FeedConfig {
  universe: UniverseSize;
  rate: MessageRate;
  conflateMs: ConflationWindow;
  transport: TransportKind;
  seed: number;
  /** Simulated wall-clock used to derive futures month codes (§5.1). */
  nowMs: number;
}

// ── Worker frame layout (transferable) ───────────────────────────────────────
// One flush per conflation window carries a columnar update for the rows that
// changed. Indices in `ids`, values packed row-major in `values`.

export const FRAME_FIELDS = [
  'bid',
  'ask',
  'bidSize',
  'askSize',
  'last',
  'change',
  'changePct',
  'spread',
  'high',
  'low',
  'volume',
  'seq',
] as const;
export type FrameField = (typeof FRAME_FIELDS)[number];
export const FRAME_FIELD_COUNT = FRAME_FIELDS.length;

export const POS_FIELDS = [
  'index',
  'netQty',
  'avgCost',
  'realizedPnl',
  'unrealizedPnl',
  'marketValue',
] as const;
export const POS_FIELD_COUNT = POS_FIELDS.length;

export interface FrameMessage {
  type: 'frame';
  ids: Int32Array;
  values: Float64Array;
  positions: Float64Array;
  /** Absolute epoch ms (timeOrigin + now) of the oldest tick in the batch. */
  oldestTs: number;
  /** Absolute epoch ms of the newest tick in the batch. */
  newestTs: number;
  /** Rows produced this flush (for rows/sec). */
  rowsOut: number;
  /** Raw messages consumed this flush (for msgs/sec + conflation ratio). */
  msgsIn: number;
  generation: number;
}

export interface SlowMessage {
  type: 'slow';
  totals: PortfolioTotals;
  gapsRecovered: number;
  connected: boolean;
  /** Epoch ms of the last window that carried at least one message. */
  dataTs: number;
}

export interface OrderMessage {
  type: 'order';
  order: Order;
}

export interface ReadyMessage {
  type: 'ready';
  generation: number;
  instruments: Instrument[];
}

export type WorkerOutbound =
  | FrameMessage
  | SlowMessage
  | OrderMessage
  | ReadyMessage;

export interface StartCommand {
  type: 'start';
  config: FeedConfig;
}
export interface ConfigCommand {
  type: 'config';
  patch: Partial<Pick<FeedConfig, 'rate' | 'conflateMs' | 'transport'>>;
}
export interface UniverseCommand {
  type: 'universe';
  universe: UniverseSize;
}
export interface FaultCommand {
  type: 'fault';
  fault: FaultKind;
}
export interface SubmitCommand {
  type: 'submit';
  order: Order;
}
export interface CancelCommand {
  type: 'cancel';
  id: string;
}
export interface FlattenCommand {
  type: 'flatten';
}

export type WorkerInbound =
  | StartCommand
  | ConfigCommand
  | UniverseCommand
  | FaultCommand
  | SubmitCommand
  | CancelCommand
  | FlattenCommand;
