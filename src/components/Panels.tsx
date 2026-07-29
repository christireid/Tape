import { store } from '../store/marketStore.ts';
import { useSlowTick } from '../store/hooks.ts';
import {
  formatMoney,
  formatPrice,
  formatQty,
  formatSignedMoney,
  signClassMoney,
} from '../domain/format.ts';
import type { Order } from '../domain/types.ts';

export function PositionsPanel(): React.JSX.Element {
  useSlowTick();
  const positions = store.positions;
  return (
    <section className="panel" aria-label="Positions">
      <div className="panel-head">
        <span className="panel-title">Positions</span>
        <span className="panel-count mono">{positions.length}</span>
      </div>
      <div className="panel-body" tabIndex={0} aria-label="Positions table region">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Net</th>
              <th scope="col">Avg</th>
              <th scope="col">Mkt Val</th>
              <th scope="col">Unreal.</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'left' }}>
                  No positions. Place an order with <kbd>B</kbd> / <kbd>S</kbd>
                </td>
              </tr>
            )}
            {positions.map((p) => {
              const row = store.rowById(p.instrumentId);
              const fmt = row?.priceFormat ?? 'decimal';
              const tick = row?.tickSize ?? 0.01;
              return (
                <tr key={p.instrumentId}>
                  <td className="sym" style={{ textAlign: 'left' }}>{p.symbol}</td>
                  <td className={p.netQty >= 0 ? 'pos' : 'neg'}>{formatQty(p.netQty)}</td>
                  <td>{formatPrice(p.avgCost, tick, fmt)}</td>
                  <td>{formatMoney(p.marketValue)}</td>
                  <td className={signClassMoney(p.unrealizedPnl)}>
                    {formatSignedMoney(p.unrealizedPnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const STATUS_CLASS: Record<Order['status'], string> = {
  PENDING: 'tag tag-pending',
  WORKING: 'tag tag-working',
  PARTIAL: 'tag tag-partial',
  FILLED: 'tag tag-filled',
  CANCELLED: 'tag tag-cancelled',
  REJECTED: 'tag tag-rejected',
};

export function OrdersPanel(): React.JSX.Element {
  useSlowTick();
  const orders = store.orders;
  const open = (o: Order): boolean =>
    o.status === 'PENDING' || o.status === 'WORKING' || o.status === 'PARTIAL';
  return (
    <section className="panel" aria-label="Orders">
      <div className="panel-head">
        <span className="panel-title">Orders</span>
        <span className="panel-count mono">{orders.length}</span>
      </div>
      <div className="panel-body" tabIndex={0} aria-label="Orders table region">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Side</th>
              <th scope="col">Qty</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Action"></th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'left' }}>
                  No orders yet. Set a side with <kbd>B</kbd> / <kbd>S</kbd>, submit from the ticket
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="sym" style={{ textAlign: 'left' }}>{o.symbol}</td>
                <td className={o.side === 'BUY' ? 'pos' : 'neg'}>{o.side}</td>
                <td>
                  {o.filledQty > 0 ? `${o.filledQty}/${o.qty}` : o.qty}
                </td>
                <td>{o.type === 'LIMIT' && o.limitPrice !== null ? o.limitPrice : o.type}</td>
                <td style={{ textAlign: 'left' }}>
                  <span className={STATUS_CLASS[o.status]}>{o.status}</span>
                </td>
                <td>
                  {open(o) && (
                    <button className="link-btn" onClick={() => store.cancelOrder(o.id)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
