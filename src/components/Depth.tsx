import { store } from '../store/marketStore.ts';
import { useSlowTick } from '../store/hooks.ts';
import { formatPrice, formatSize } from '../domain/format.ts';
import type { BlotterRow, DepthLevel } from '../domain/types.ts';

// Depth ladder: top of book from the feed, deeper levels modelled — and the
// distinction is labelled in the UI. Presenting modelled depth as
// received depth is the kind of small dishonesty a domain reader will not
// forgive.
function buildLadder(row: BlotterRow): { bids: DepthLevel[]; asks: DepthLevel[] } {
  const step = row.tickSize;
  const bids: DepthLevel[] = [{ price: row.bid, size: row.bidSize, fromFeed: true }];
  const asks: DepthLevel[] = [{ price: row.ask, size: row.askSize, fromFeed: true }];
  for (let k = 1; k < 5; k++) {
    const decay = 1 + k * 0.6;
    bids.push({ price: row.bid - k * step, size: Math.round(row.bidSize * decay), fromFeed: false });
    asks.push({ price: row.ask + k * step, size: Math.round(row.askSize * decay), fromFeed: false });
  }
  return { bids, asks };
}

interface Props {
  index: number;
}

export function DepthLadder({ index }: Props): React.JSX.Element {
  useSlowTick();
  const row = store.rowByIndex(index);
  if (!row) return <div className="depth-tag muted">No instrument selected</div>;
  const { bids, asks } = buildLadder(row);
  const maxSize = Math.max(1, ...bids.map((b) => b.size), ...asks.map((a) => a.size));

  return (
    <section aria-label={`Depth for ${row.symbol}`}>
      <div className="depth">
        {[...asks].reverse().map((lvl, i) => (
          <div key={`a${i}`} className={`depth-row depth-ask ${lvl.fromFeed ? '' : 'depth-modelled'}`}>
            <span className="depth-size-bar" style={{ width: `${(lvl.size / maxSize) * 45}%` }} />
            <span className="muted">{lvl.fromFeed ? 'TOB' : 'mdl'}</span>
            <span style={{ textAlign: 'center' }}>{formatSize(lvl.size)}</span>
            <span className="neg" style={{ textAlign: 'right' }}>
              {formatPrice(lvl.price, row.tickSize, row.priceFormat)}
            </span>
          </div>
        ))}
        {bids.map((lvl, i) => (
          <div key={`b${i}`} className={`depth-row depth-bid ${lvl.fromFeed ? '' : 'depth-modelled'}`}>
            <span className="depth-size-bar" style={{ width: `${(lvl.size / maxSize) * 45}%` }} />
            <span className="pos">{formatPrice(lvl.price, row.tickSize, row.priceFormat)}</span>
            <span style={{ textAlign: 'center' }}>{formatSize(lvl.size)}</span>
            <span className="muted" style={{ textAlign: 'right' }}>{lvl.fromFeed ? 'TOB' : 'mdl'}</span>
          </div>
        ))}
      </div>
      <div className="depth-tag">TOB = top of book (feed) · mdl = modelled levels</div>
    </section>
  );
}

export function SessionRange({ index }: Props): React.JSX.Element {
  useSlowTick();
  const row = store.rowByIndex(index);
  if (!row) return <div className="range muted">·</div>;
  const lo = Math.min(row.low, row.prevClose, row.last);
  const hi = Math.max(row.high, row.prevClose, row.last);
  const span = Math.max(hi - lo, row.tickSize);
  const pct = (v: number): number => ((v - lo) / span) * 100;
  const lastPct = pct(row.last);
  const prevPct = pct(row.prevClose);
  const valueText = `Last ${formatPrice(row.last, row.tickSize, row.priceFormat)} of session range ${formatPrice(lo, row.tickSize, row.priceFormat)} to ${formatPrice(hi, row.tickSize, row.priceFormat)}, previous close ${formatPrice(row.prevClose, row.tickSize, row.priceFormat)}`;

  return (
    <div className="range">
      <div
        role="meter"
        aria-label={`Session range for ${row.symbol}`}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={row.last}
        aria-valuetext={valueText}
      >
        <div className="range-rail">
          <div className="range-fill" style={{ left: `${Math.min(lastPct, prevPct)}%`, width: `${Math.abs(lastPct - prevPct)}%` }} />
          <div className="range-prev" style={{ left: `${prevPct}%` }} title="prev close" />
          <div className="range-last" style={{ left: `${lastPct}%` }} title="last" />
        </div>
      </div>
      <div className="range-labels">
        <span>{formatPrice(lo, row.tickSize, row.priceFormat)}</span>
        <span className="muted">L / H</span>
        <span>{formatPrice(hi, row.tickSize, row.priceFormat)}</span>
      </div>
    </div>
  );
}
