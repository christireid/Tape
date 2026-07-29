import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { BlotterRow } from '../domain/types.ts';
import { store } from '../store/marketStore.ts';
import { COLUMNS, changeBarWidthPct, type ColSpec } from './columns.ts';

// The hand-built engine. Roughly 200 lines: a virtualizer, a column table, and
// cells whose text is written directly into spans on each frame. It touches
// only the rows on screen — the substantive reason it holds 60 fps where the
// grid, processing the whole transaction set, degrades (ADR 004).

interface MountedRow {
  el: HTMLElement;
  cells: HTMLElement[];
  fill: HTMLElement | null;
  index: number;
}

function cellClassFor(col: ColSpec): string {
  if (col.id === 'symbol') return 'vcell sym';
  return col.numeric ? 'vcell n' : 'vcell';
}

function writeRow(m: MountedRow, row: BlotterRow, flash: boolean): void {
  for (let c = 0; c < COLUMNS.length; c++) {
    const col = COLUMNS[c]!;
    const cell = m.cells[c]!;
    if (col.id === 'changebar') {
      if (m.fill) {
        const w = changeBarWidthPct(row.changePct);
        const up = row.changePct >= 0;
        m.fill.style.width = `${w}%`;
        m.fill.style.left = up ? '50%' : `${50 - w}%`;
        m.fill.style.background = up ? 'var(--bar-positive)' : 'var(--bar-negative)';
      }
      continue;
    }
    const text = col.text(row);
    if (cell.textContent !== text) cell.textContent = text;
    if (col.sign) {
      const s = col.sign(row);
      cell.classList.toggle('pos', s === 'up');
      cell.classList.toggle('neg', s === 'down');
    }
    if (flash && col.id === 'last') {
      const dir = row.change >= 0 ? 'flash-up' : 'flash-down';
      cell.classList.remove('flash-up', 'flash-down');
      void cell.offsetWidth; // restart the CSS animation
      cell.classList.add(dir);
    }
  }
}

interface Props {
  onSelect: (index: number) => void;
  filter: string;
  rowHeight: number;
  generation: number;
}

export function VirtualBlotter({ onSelect, filter, rowHeight, generation }: Props): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(new Map<number, MountedRow>());
  const [selected, setSelected] = useState(-1);

  const view = useMemo(() => {
    const rows = store.rows;
    if (!filter) return rows;
    const q = filter.toLowerCase();
    return rows.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.sector.toLowerCase().includes(q),
    );
    // generation forces a rebuild when the universe swaps.
  }, [filter, generation]);

  const totalWidth = useMemo(() => COLUMNS.reduce((s, c) => s + c.width, 0), []);

  const rowVirtualizer = useVirtualizer({
    count: view.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // Hot path: update only mounted rows, in place.
  useEffect(() => {
    const unsub = store.onFrame((changed, rows) => {
      const map = mounted.current;
      for (let i = 0; i < changed.length; i++) {
        const idx = changed[i]!;
        const m = map.get(idx);
        if (m) writeRow(m, rows[idx]!, true);
      }
      requestAnimationFrame(() => store.recordPaint());
    });
    return unsub;
  }, []);

  const registerRow = (el: HTMLDivElement | null, rowIndex: number): void => {
    const row = view[rowIndex];
    if (!el || !row) return;
    if (el.childElementCount === 0) {
      for (const col of COLUMNS) {
        const span = document.createElement('span');
        span.className = cellClassFor(col);
        // The a11y surface is hand-written (ADR 004): every cell must carry
        // its grid role or role="grid" fails aria-required-children.
        span.setAttribute('role', 'gridcell');
        span.style.width = `${col.width}px`;
        span.style.flex = `0 0 ${col.width}px`;
        if (col.id === 'changebar') {
          const bar = document.createElement('span');
          bar.className = 'chgbar';
          const fill = document.createElement('span');
          fill.className = 'chgbar-fill';
          const mid = document.createElement('span');
          mid.className = 'chgbar-mid';
          bar.appendChild(fill);
          bar.appendChild(mid);
          span.appendChild(bar);
          span.dataset.fill = '1';
        }
        el.appendChild(span);
      }
    }
    const cells = Array.from(el.children) as HTMLElement[];
    const fillHost = cells.find((c) => c.dataset.fill === '1');
    const m: MountedRow = {
      el,
      cells,
      fill: fillHost ? (fillHost.querySelector('.chgbar-fill') as HTMLElement) : null,
      index: row.index,
    };
    mounted.current.set(row.index, m);
    writeRow(m, row, false);
    el.setAttribute('aria-selected', String(row.index === selected));
  };

  return (
    <div
      className="vgrid"
      ref={parentRef}
      role="grid"
      tabIndex={0}
      aria-label="Blotter (hand-built virtual engine)"
      aria-rowcount={view.length}
    >
      <div className="vgrid-head" style={{ width: totalWidth }} role="row">
        {COLUMNS.map((c) => (
          <div
            key={c.id}
            className={c.numeric ? 'vgrid-hcell n' : 'vgrid-hcell'}
            style={{ width: c.width, flex: `0 0 ${c.width}px` }}
            role="columnheader"
          >
            {c.label}
          </div>
        ))}
      </div>
      <div
        role="rowgroup"
        style={{ height: rowVirtualizer.getTotalSize(), width: totalWidth, position: 'relative' }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = view[vi.index];
          if (!row) return null;
          return (
            <div
              key={row.id}
              className="vgrid-row"
              role="row"
              aria-rowindex={vi.index + 1}
              aria-selected={row.index === selected}
              style={{ transform: `translateY(${vi.start}px)`, width: totalWidth }}
              ref={(el) => {
                registerRow(el, vi.index);
                return () => {
                  mounted.current.delete(row.index);
                };
              }}
              onClick={() => {
                setSelected(row.index);
                onSelect(row.index);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
