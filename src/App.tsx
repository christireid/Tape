import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { store } from './store/marketStore.ts';
import type { EngineKind, Side } from './domain/types.ts';
import { Blotter } from './components/Blotter.tsx';
import { VirtualBlotter } from './components/VirtualBlotter.tsx';
import { OrdersPanel, PositionsPanel } from './components/Panels.tsx';
import { OrderTicket } from './components/OrderTicket.tsx';
import { PriceChart, ThroughputChart } from './components/Charts.tsx';
import { DepthLadder } from './components/Depth.tsx';
import {
  CommandPalette,
  HelpSheet,
  StatusBar,
  Toolbar,
  TopBar,
  type Command,
} from './components/Chrome.tsx';
import { useSlowTick } from './store/hooks.ts';

type Theme = 'dark' | 'light' | 'hc';
type Density = 'comfortable' | 'compact';

const THEMES: Theme[] = ['dark', 'light', 'hc'];

function isTextTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function App(): React.JSX.Element {
  const version = useSlowTick(); // 4 Hz re-render for chrome + engine/generation
  const [selected, setSelected] = useState(0);
  const [side, setSide] = useState<Side>('BUY');
  const [engine, setEngineState] = useState<EngineKind>('aggrid');
  const [filter, setFilter] = useState('');
  const [theme, setTheme] = useState<Theme>('dark');
  const [density, setDensity] = useState<Density>('comfortable');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  // Store lifecycle — created outside React; started once, StrictMode-safe.
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const setEngine = useCallback((e: EngineKind) => {
    setEngineState(e);
    store.setEngine(e);
  }, []);
  const cycleTheme = useCallback(() => {
    setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]!);
  }, []);
  const toggleDensity = useCallback(() => {
    setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'));
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'buy', label: 'Buy selected instrument', hint: 'B', run: () => setSide('BUY') },
      { id: 'sell', label: 'Sell selected instrument', hint: 'S', run: () => setSide('SELL') },
      { id: 'engine-aggrid', label: 'Engine: AG Grid', run: () => setEngine('aggrid') },
      { id: 'engine-virtual', label: 'Engine: Virtual (hand-built)', run: () => setEngine('virtual') },
      { id: 'density', label: 'Toggle density', hint: 'D', run: toggleDensity },
      { id: 'theme', label: 'Cycle theme', hint: 'T', run: cycleTheme },
      { id: 'fault-gap', label: 'Inject sequence gap', hint: 'G', run: () => store.injectFault('gap') },
      { id: 'fault-disc', label: 'Inject disconnect', hint: 'X', run: () => store.injectFault('disconnect') },
      { id: 'fault-burst', label: 'Inject burst', run: () => store.injectFault('burst') },
      { id: 'filter', label: 'Focus blotter filter', hint: '/', run: () => filterRef.current?.focus() },
      { id: 'help', label: 'Keyboard reference', hint: '?', run: () => setHelpOpen(true) },
      { id: 'flatten', label: 'Flatten all positions (destructive)', run: () => store.flatten() },
    ],
    [setEngine, toggleDensity, cycleTheme],
  );

  // Keyboard model. Shortcuts suppressed while a text input has focus (§5.8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setHelpOpen(false);
        return;
      }
      if (isTextTarget(e.target)) return;
      switch (e.key) {
        case '/':
          e.preventDefault();
          filterRef.current?.focus();
          break;
        case 'b':
        case 'B':
          setSide('BUY');
          break;
        case 's':
        case 'S':
          setSide('SELL');
          break;
        case 'd':
        case 'D':
          toggleDensity();
          break;
        case 't':
        case 'T':
          cycleTheme();
          break;
        case 'g':
        case 'G':
          store.injectFault('gap');
          break;
        case 'x':
        case 'X':
          store.injectFault('disconnect');
          break;
        case '?':
          setHelpOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDensity, cycleTheme]);

  const rowHeight = density === 'comfortable' ? 30 : 22;

  return (
    <div className="app">
      <TopBar onPalette={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} />
      <Toolbar
        engine={engine}
        setEngine={setEngine}
        filter={filter}
        setFilter={setFilter}
        filterRef={filterRef}
      />

      <div className="app-body">
        <div className="col col-main">
          <section className="panel" style={{ flex: '1 1 auto', minHeight: 0 }} aria-label="Blotter">
            <div className="panel-head">
              <span className="panel-title">Blotter</span>
              <span className="panel-count mono">
                {store.rows.length} · {engine === 'aggrid' ? 'AG Grid' : 'Virtual'}
              </span>
            </div>
            <div className="panel-body" style={{ overflow: 'hidden' }}>
              {engine === 'aggrid' ? (
                <Blotter onSelect={setSelected} filter={filter} rowHeight={rowHeight} />
              ) : (
                <VirtualBlotter
                  onSelect={setSelected}
                  filter={filter}
                  rowHeight={rowHeight}
                  generation={store.generation}
                />
              )}
            </div>
          </section>

          <div style={{ display: 'flex', gap: 1, flex: '0 0 232px', minHeight: 0 }}>
            <div className="col" style={{ flex: '1 1 0' }}>
              <PositionsPanel />
            </div>
            <div className="col" style={{ flex: '1 1 0' }}>
              <OrdersPanel />
            </div>
            <div className="col" style={{ flex: '1 1 0' }}>
              <section className="panel" aria-label="Price tape">
                <div className="panel-head">
                  <span className="panel-title">Price tape</span>
                  <span className="panel-count mono">{store.rowByIndex(selected)?.symbol}</span>
                </div>
                <div className="panel-body" tabIndex={0} aria-label="Price tape chart region">
                  <PriceChart index={selected} />
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="col col-side">
          <OrderTicket index={selected} side={side} setSide={setSide} />
          <section className="panel" aria-label="Depth ladder" style={{ flex: '0 0 auto' }}>
            <div className="panel-head">
              <span className="panel-title">Depth</span>
            </div>
            <div className="panel-body" style={{ overflow: 'visible' }}>
              <DepthLadder index={selected} />
            </div>
          </section>
          <section className="panel" aria-label="Throughput" style={{ flex: '1 1 auto' }}>
            <div className="panel-head">
              <span className="panel-title">Throughput</span>
            </div>
            <div className="panel-body" tabIndex={0} aria-label="Throughput charts region">
              <ThroughputChart />
            </div>
          </section>
        </div>
      </div>

      <StatusBar />

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}

      <span className="vh">build {version}</span>
    </div>
  );
}
