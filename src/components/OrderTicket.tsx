import { useEffect, useRef, useState } from 'react';
import { store } from '../store/marketStore.ts';
import { useSlowTick } from '../store/hooks.ts';
import { formatMoney, formatPrice } from '../domain/format.ts';
import type { OrderType, Side } from '../domain/types.ts';
import { SessionRange } from './Depth.tsx';

const FAT_FINGER = 250_000;

interface Props {
  index: number;
  side: Side;
  setSide: (s: Side) => void;
}

/** On the tick grid within a tolerance of half a tick. */
function onTickGrid(price: number, tick: number): boolean {
  const n = price / tick;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

export function OrderTicket({ index, side, setSide }: Props): React.JSX.Element {
  useSlowTick();
  const row = store.rowByIndex(index);
  const tele = store.getTelemetry();
  const stale = tele.health !== 'live';

  const [qty, setQty] = useState('0');
  const [type, setType] = useState<OrderType>('LIMIT');
  const [limit, setLimit] = useState('');
  const [confirm, setConfirm] = useState('');
  const [announce, setAnnounce] = useState('');
  const lastIndex = useRef(index);

  // Prefill the limit with the marketable side when the instrument changes, or
  // when the row first becomes available (the store is empty for the first few
  // frames after mount).
  useEffect(() => {
    if (!row) return;
    if (lastIndex.current !== index || limit === '') {
      lastIndex.current = index;
      setLimit(formatPrice(side === 'BUY' ? row.ask : row.bid, row.tickSize, row.priceFormat).replace('−', '-'));
      setConfirm('');
    }
  }, [index, row?.id]);

  if (!row) return <div className="ticket muted">No instrument selected</div>;

  const qtyNum = Number(qty);
  const limitNum = Number(limit);
  const refPrice = type === 'LIMIT' && Number.isFinite(limitNum) && limitNum > 0 ? limitNum : row.last;
  const notional = qtyNum * refPrice * row.lotSize;

  const errors: string[] = [];
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    errors.push('Quantity must be greater than zero.');
  } else if (qtyNum % row.lotSize !== 0) {
    errors.push(`Quantity must be a multiple of the lot size (${row.lotSize}).`);
  }
  if (type === 'LIMIT') {
    if (!Number.isFinite(limitNum) || limitNum <= 0) {
      errors.push('Limit price is required.');
    } else if (!onTickGrid(limitNum, row.tickSize)) {
      errors.push(`Limit price must land on the tick grid (tick size ${row.tickSize}).`);
    }
  }

  const needsConfirm = Math.abs(notional) >= FAT_FINGER;
  const confirmArmed = !needsConfirm || confirm.trim().toUpperCase() === 'CONFIRM';
  const canSubmit = !stale && errors.length === 0 && confirmArmed;

  const submit = (): void => {
    if (!canSubmit) return;
    store.submitOrder({
      instrumentId: row.id,
      symbol: row.symbol,
      side,
      type,
      qty: qtyNum,
      limitPrice: type === 'LIMIT' ? limitNum : null,
    });
    setAnnounce(`Order submitted: ${side} ${qtyNum} ${row.symbol} ${type === 'LIMIT' ? `@ ${limit}` : 'at market'}`);
    setConfirm('');
  };

  return (
    <section className="ticket panel" aria-label="Order ticket">
      <div className="ticket-strip">
        <span className="ticket-sym">{row.symbol}</span>
        <span className="muted">{row.name}</span>
      </div>

      <div className="quote-strip">
        <div className={`quote-cell ${stale ? 'desat' : ''}`}>
          <div className="k">Bid</div>
          <div className="v pos">{formatPrice(row.bid, row.tickSize, row.priceFormat)}</div>
        </div>
        <div className={`quote-cell ${stale ? 'desat' : ''}`}>
          <div className="k">Last</div>
          <div className="v">{formatPrice(row.last, row.tickSize, row.priceFormat)}</div>
        </div>
        <div className={`quote-cell ${stale ? 'desat' : ''}`}>
          <div className="k">Ask</div>
          <div className="v neg">{formatPrice(row.ask, row.tickSize, row.priceFormat)}</div>
        </div>
      </div>

      <SessionRange index={index} />

      <div className="side-toggle" role="group" aria-label="Side">
        <button className="buy" aria-pressed={side === 'BUY'} onClick={() => setSide('BUY')}>
          Buy
        </button>
        <button className="sell" aria-pressed={side === 'SELL'} onClick={() => setSide('SELL')}>
          Sell
        </button>
      </div>

      <div className="row2">
        <div className="field">
          <label htmlFor="qty">Quantity</label>
          <input
            id="qty"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-describedby="qty-help"
          />
          <span id="qty-help" className="vh">
            Lot size {row.lotSize}
          </span>
        </div>
        <div className="field">
          <label htmlFor="otype">Type</label>
          <select id="otype" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
            <option value="LIMIT">Limit</option>
            <option value="MARKET">Market</option>
          </select>
        </div>
      </div>

      {type === 'LIMIT' && (
        <div className="field">
          <label htmlFor="limit">Limit price</label>
          <input id="limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
      )}

      <div className="notional">
        <span className="muted">Notional</span>
        <span>{formatMoney(Math.abs(notional))}</span>
      </div>

      {stale && (
        <div className="alert" role="alert">
          Feed is {tele.health}. Order entry disabled. Data age {(tele.dataAgeMs / 1000).toFixed(1)}s.
        </div>
      )}

      {errors.map((e) => (
        <div className="alert" role="alert" key={e}>
          {e}
        </div>
      ))}

      {needsConfirm && !stale && errors.length === 0 && (
        <div className="confirm-gate">
          <span className="warn">
            Notional {formatMoney(Math.abs(notional))} is at or above {formatMoney(FAT_FINGER)}. Type CONFIRM to arm.
          </span>
          <input
            aria-label="Type CONFIRM to arm submit"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="CONFIRM"
          />
        </div>
      )}

      <button className="submit" onClick={submit} disabled={!canSubmit}>
        {side} {row.symbol}
      </button>

      <div className="vh" role="status" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}
