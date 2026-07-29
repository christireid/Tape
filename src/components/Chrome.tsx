import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../store/marketStore.ts';
import { useSlowTick } from '../store/hooks.ts';
import { formatAge, formatInt, formatSignedMoney } from '../domain/format.ts';
import type {
  ConflationWindow,
  EngineKind,
  MessageRate,
  UniverseSize,
} from '../domain/types.ts';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

// ── Top bar ──────────────────────────────────────────────────────────────────

export function TopBar({
  onPalette,
  onHelp,
}: {
  onPalette: () => void;
  onHelp: () => void;
}): React.JSX.Element {
  useSlowTick();
  const totals = store.getTotals();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">TAPE</span>
        <span className="brand-sub">synthetic blotter</span>
      </div>
      <span className="synthetic-badge">Synthetic data</span>

      <div className="topbar-metrics">
        <div className="metric">
          <span className="metric-label">Realised</span>
          <span className={`metric-value ${totals.realized >= 0 ? 'pos' : 'neg'}`}>
            {formatSignedMoney(totals.realized)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Unrealised</span>
          <span className={`metric-value ${totals.unrealized >= 0 ? 'pos' : 'neg'}`}>
            {formatSignedMoney(totals.unrealized)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Net P&amp;L</span>
          <span className={`metric-value dominant ${totals.net >= 0 ? 'pos' : 'neg'}`}>
            {formatSignedMoney(totals.net)}
          </span>
        </div>
        <button className="icon-btn" onClick={onPalette} aria-label="Open command palette">
          ⌘K
        </button>
        <button className="icon-btn" onClick={onHelp} aria-label="Keyboard reference">
          ?
        </button>
      </div>
    </header>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

const RATES: MessageRate[] = [1000, 8000, 25000, 50000];
const UNIVERSES: UniverseSize[] = [500, 1200, 5000];
const CONFLATE: ConflationWindow[] = [0, 16, 50, 100];

export function Toolbar({
  engine,
  setEngine,
  filter,
  setFilter,
  filterRef,
}: {
  engine: EngineKind;
  setEngine: (e: EngineKind) => void;
  filter: string;
  setFilter: (s: string) => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const [universe, setUniverse] = useState<UniverseSize>(store.config.universe);
  const [rate, setRate] = useState<MessageRate>(store.config.rate);
  const [conflate, setConflate] = useState<ConflationWindow>(store.config.conflateMs);

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <span className="field-label">Universe</span>
        <select
          aria-label="Universe size"
          value={universe}
          onChange={(e) => {
            const v = Number(e.target.value) as UniverseSize;
            setUniverse(v);
            store.setUniverse(v);
          }}
        >
          {UNIVERSES.map((u) => (
            <option key={u} value={u}>
              {formatInt(u)}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <span className="field-label">Rate/s</span>
        <select
          aria-label="Message rate"
          value={rate}
          onChange={(e) => {
            const v = Number(e.target.value) as MessageRate;
            setRate(v);
            store.setRate(v);
          }}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {formatInt(r)}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <span className="field-label">Conflate</span>
        <select
          aria-label="Conflation window"
          value={conflate}
          onChange={(e) => {
            const v = Number(e.target.value) as ConflationWindow;
            setConflate(v);
            store.setConflate(v);
          }}
        >
          {CONFLATE.map((c) => (
            <option key={c} value={c}>
              {c === 0 ? 'off (raw)' : `${c} ms`}
            </option>
          ))}
        </select>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <span className="field-label">Engine</span>
        <div className="seg" role="group" aria-label="Rendering engine">
          <button aria-pressed={engine === 'aggrid'} onClick={() => setEngine('aggrid')}>
            AG Grid
          </button>
          <button aria-pressed={engine === 'virtual'} onClick={() => setEngine('virtual')}>
            Virtual
          </button>
        </div>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <span className="field-label">Fault</span>
        <button className="icon-btn" onClick={() => store.injectFault('gap')}>
          Gap
        </button>
        <button className="icon-btn" onClick={() => store.injectFault('disconnect')}>
          Disconnect
        </button>
        <button className="icon-btn" onClick={() => store.injectFault('burst')}>
          Burst
        </button>
      </div>

      <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
        <input
          ref={filterRef}
          className="filter-input"
          placeholder="Filter  /"
          aria-label="Filter blotter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Status bar / perf strip ──────────────────────────────────────────────────

export function StatusBar(): React.JSX.Element {
  useSlowTick();
  const t = store.getTelemetry();
  const heap = t.heapMB === null ? 'n/a' : `${t.heapMB.toFixed(1)} MB`;
  const longTasks = t.longTaskSupported ? formatInt(t.longTasks) : 'n/a';
  return (
    <footer className="statusbar" aria-label="Status and performance">
      <div className="stat">
        <span className={`health-dot health-${t.health}`} aria-hidden="true" />
        <span className="k">Feed</span>
        <span className="v">{t.health}</span>
      </div>
      <div className="stat">
        <span className="k">Age</span>
        <span className="v">{formatAge(t.dataAgeMs)}</span>
      </div>
      <div className="stat">
        <span className="k">Engine</span>
        <span className="v">{store.engine === 'aggrid' ? 'AG Grid' : 'Virtual'}</span>
      </div>
      <div className="stat">
        <span className="k">In/s</span>
        <span className="v">{formatInt(t.msgsInPerSec)}</span>
      </div>
      <div className="stat">
        <span className="k">Out/s</span>
        <span className="v">{formatInt(t.rowsOutPerSec)}</span>
      </div>
      <div className="stat">
        <span className="k">Conflate</span>
        <span className="v">{t.conflationRatio.toFixed(1)}:1</span>
      </div>
      <div className="stat">
        <span className="k">FPS</span>
        <span className="v">{t.fps}</span>
      </div>
      <div className="stat">
        <span className="k">t2s p50/95/99</span>
        <span className="v">
          {t.t2sP50.toFixed(1)}/{t.t2sP95.toFixed(1)}/{t.t2sP99.toFixed(1)} ms
        </span>
      </div>
      <div className="stat">
        <span className="k">Long tasks</span>
        <span className="v">{longTasks}</span>
      </div>
      <div className="stat">
        <span className="k">Gaps</span>
        <span className="v">{formatInt(t.gapsRecovered)}</span>
      </div>
      <div className="stat">
        <span className="k">Heap</span>
        <span className="v">{heap}</span>
      </div>
    </footer>
  );
}

// ── Command palette ──────────────────────────────────────────────────────────

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      (restoreRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = (i: number): void => {
    const cmd = filtered[i];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command…"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(active);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul id="palette-list" role="listbox" aria-label="Commands">
          {filtered.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(i)}
            >
              <span>{c.label}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
          {filtered.length === 0 && <li className="muted">No matching command</li>}
        </ul>
      </div>
    </div>
  );
}

// ── Help sheet ───────────────────────────────────────────────────────────────

const KEYS: Array<[string, string]> = [
  ['⌘K / Ctrl+K', 'Command palette'],
  ['/', 'Focus blotter filter'],
  ['B / S', 'Buy / sell selected instrument'],
  ['D', 'Toggle density'],
  ['T', 'Cycle theme'],
  ['G / X', 'Inject sequence gap / disconnect'],
  ['?', 'Keyboard reference sheet'],
  ['Esc', 'Dismiss overlay'],
];

export function HelpSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="help-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard reference"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Keyboard reference</h2>
        <div className="help-grid">
          {KEYS.map(([k, v]) => (
            <Fragment key={k}>
              <kbd>{k}</kbd>
              <span>{v}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
