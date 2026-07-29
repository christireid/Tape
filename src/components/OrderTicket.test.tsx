import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderTicket } from './OrderTicket.tsx';
import { store } from '../store/marketStore.ts';
import type { BlotterRow } from '../domain/types.ts';

function eurusd(): BlotterRow {
  return {
    id: 'EURUSD',
    index: 0,
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    sector: 'FX',
    tickSize: 0.00001,
    lotSize: 1000,
    priceFormat: 'decimal',
    prevClose: 1.1,
    bid: 1.09995,
    ask: 1.10005,
    bidSize: 1000,
    askSize: 1000,
    last: 1.1,
    change: 0,
    changePct: 0,
    spread: 0.0001,
    high: 1.101,
    low: 1.099,
    volume: 1000,
    seq: 5,
  };
}

describe('OrderTicket consequence gates', () => {
  beforeEach(() => {
    store.rows = [eurusd()];
    store.instruments = [];
    store.orders = [];
  });

  it('names the lot size when quantity is not a multiple', async () => {
    const user = userEvent.setup();
    render(<OrderTicket index={0} side="BUY" setSide={() => {}} />);
    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '1500');
    expect(screen.getByText(/multiple of the lot size \(1000\)/)).toBeInTheDocument();
  });

  it('names the tick size when the limit price is off grid', async () => {
    const user = userEvent.setup();
    render(<OrderTicket index={0} side="BUY" setSide={() => {}} />);
    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '1000');
    const limit = screen.getByLabelText('Limit price');
    await user.clear(limit);
    await user.type(limit, '1.123456789');
    expect(screen.getByText(/tick grid \(tick size 0.00001\)/)).toBeInTheDocument();
  });

  it('requires typed CONFIRM above the fat-finger threshold', async () => {
    const user = userEvent.setup();
    render(<OrderTicket index={0} side="BUY" setSide={() => {}} />);
    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '1000'); // ~1.1M notional
    const submit = screen.getByRole('button', { name: /BUY EURUSD/ });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Type CONFIRM to arm submit'), 'CONFIRM');
    expect(submit).toBeEnabled();
  });
});
