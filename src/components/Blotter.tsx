import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererComp,
  type ICellRendererParams,
} from 'ag-grid-community';
import type { BlotterRow } from '../domain/types.ts';
import { store } from '../store/marketStore.ts';
import { COLUMNS, changeBarWidthPct } from './columns.ts';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Change-bar cell renderer — a plain class that writes to two DOM nodes
 * directly. No React reconciliation on the hot path (§5.3). The largest visual
 * gain per line in the app: the blotter becomes pre-attentively scannable.
 */
class ChangeBarRenderer implements ICellRendererComp<BlotterRow> {
  private eGui!: HTMLDivElement;
  private fill!: HTMLDivElement;

  init(params: ICellRendererParams<BlotterRow>): void {
    this.eGui = document.createElement('div');
    this.eGui.className = 'cb';
    this.fill = document.createElement('div');
    this.fill.className = 'cb-fill';
    const mid = document.createElement('div');
    mid.className = 'cb-mid';
    this.eGui.appendChild(this.fill);
    this.eGui.appendChild(mid);
    this.paint(params.data);
  }
  getGui(): HTMLElement {
    return this.eGui;
  }
  refresh(params: ICellRendererParams<BlotterRow>): boolean {
    this.paint(params.data);
    return true;
  }
  private paint(row: BlotterRow | undefined): void {
    if (!row) return;
    const w = changeBarWidthPct(row.changePct);
    const up = row.changePct >= 0;
    this.fill.style.width = `${w}%`;
    this.fill.style.left = up ? '50%' : `${50 - w}%`;
    this.fill.style.background = up ? 'var(--bar-positive)' : 'var(--bar-negative)';
  }
}

function buildColDefs(): ColDef<BlotterRow>[] {
  return COLUMNS.map((c): ColDef<BlotterRow> => {
    if (c.id === 'changebar') {
      return {
        colId: c.id,
        headerName: c.label,
        width: c.width,
        valueGetter: (p) => p.data?.changePct ?? 0,
        cellRenderer: ChangeBarRenderer,
        sortable: false,
        cellClass: 'num',
      };
    }
    const def: ColDef<BlotterRow> = {
      colId: c.id,
      headerName: c.label,
      width: c.width,
      valueGetter: (p) => (p.data ? c.text(p.data) : ''),
      cellClass: c.numeric ? 'ag-right-aligned-cell num' : c.id === 'symbol' ? 'sym-cell' : undefined,
    };
    if (c.pinned) def.pinned = 'left';
    if (c.id === 'bid' || c.id === 'ask' || c.id === 'last') def.enableCellChangeFlash = true;
    if (c.id === 'change' || c.id === 'changePct' || c.id === 'last') {
      def.cellClassRules = {
        pos: (p) => (p.data ? (c.sign?.(p.data) === 'up') : false),
        neg: (p) => (p.data ? (c.sign?.(p.data) === 'down') : false),
      };
    }
    return def;
  });
}

interface Props {
  onSelect: (index: number) => void;
  filter: string;
  rowHeight: number;
}

export function Blotter({ onSelect, filter, rowHeight }: Props): React.JSX.Element {
  const apiRef = useRef<GridApi<BlotterRow> | null>(null);
  const genRef = useRef(-1);
  const colDefs = useMemo(() => buildColDefs(), []);

  const seed = (api: GridApi<BlotterRow>): void => {
    genRef.current = store.generation;
    api.flushAsyncTransactions(); // drain queued transactions first (§5.3)
    api.setGridOption('rowData', store.rows.slice());
  };

  const onGridReady = (e: GridReadyEvent<BlotterRow>): void => {
    apiRef.current = e.api;
    // Remount sentinel for the conformance check: a theme/density switch must
    // not increment this (the grid is re-styled via CSS, never re-instantiated).
    window.__gridReadyCount = (window.__gridReadyCount ?? 0) + 1;
    seed(e.api);
  };

  // Hot path: apply the worker's changed rows as an async transaction.
  useEffect(() => {
    const unsub = store.onFrame((changed) => {
      const api = apiRef.current;
      if (!api) return;
      if (genRef.current !== store.generation) {
        seed(api); // universe changed → reseed, drop stale transactions
        return;
      }
      const update: BlotterRow[] = [];
      for (let i = 0; i < changed.length; i++) {
        const row = store.rows[changed[i]!];
        if (row) update.push(row);
      }
      if (update.length) api.applyTransactionAsync({ update });
    });
    return unsub;
  }, []);

  useEffect(() => {
    apiRef.current?.setGridOption('quickFilterText', filter);
  }, [filter]);

  // Density change → update row height without remounting the grid (§6.2).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setGridOption('rowHeight', rowHeight);
    api.resetRowHeights();
  }, [rowHeight]);

  return (
    <div className="grid-host ag-theme-quartz" role="region" aria-label="Blotter (AG Grid engine)">
      <AgGridReact<BlotterRow>
        theme="legacy"
        columnDefs={colDefs}
        getRowId={(p) => p.data.id}
        rowHeight={rowHeight}
        asyncTransactionWaitMillis={32}
        animateRows={false}
        suppressScrollOnNewData
        rowSelection={{ mode: 'singleRow', enableClickSelection: true }}
        onGridReady={onGridReady}
        onAsyncTransactionsFlushed={() => {
          requestAnimationFrame(() => store.recordPaint());
        }}
        onRowClicked={(e) => {
          if (e.data) onSelect(e.data.index);
        }}
        defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
      />
    </div>
  );
}
