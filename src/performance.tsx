// The performance-trend page: reads the committed bench history from
// bench/results/ at build time and charts tick-to-screen p95 per engine across
// runs. Static — no live data, no backend; the history is the repo's.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { formatInt } from './domain/format.ts';

interface Reading {
  engine: string;
  universe: number;
  rate: number;
  msgsInPerSec: number;
  rowsOutPerSec: number;
  fps: number;
  t2sP50: number;
  t2sP95: number;
  t2sP99: number;
  gaps: number;
}
interface Run {
  capturedAt: string;
  viewport?: string;
  readings: Reading[];
}

const modules = import.meta.glob<Run>('../bench/results/*.json', {
  eager: true,
  import: 'default',
});

// Matrix runs only (ablation files have a different shape and their own table
// in ADR 004).
const runs: Array<{ file: string; run: Run }> = Object.entries(modules)
  .filter(([f]) => !f.includes('ablation'))
  .map(([file, run]) => ({ file, run }))
  .filter((x) => Array.isArray(x.run.readings))
  .sort((a, b) => a.run.capturedAt.localeCompare(b.run.capturedAt));

/** p95 of the heaviest cell (largest universe × rate) per engine, per run. */
function heaviest(run: Run, engine: string): Reading | undefined {
  return run.readings
    .filter((r) => r.engine === engine)
    .sort((a, b) => b.universe * b.rate - a.universe * a.rate)[0];
}

function Trend(): React.JSX.Element {
  const engines = ['aggrid', 'virtual'];
  const series = engines.map((e) => ({
    engine: e,
    points: runs
      .map(({ run }) => heaviest(run, e)?.t2sP95)
      .filter((v): v is number => typeof v === 'number'),
  }));
  const all = series.flatMap((s) => s.points);
  const max = Math.max(10, ...all);
  const W = 640;
  const H = 160;

  const path = (pts: number[]): string => {
    if (pts.length === 0) return '';
    if (pts.length === 1) {
      const y = H - (pts[0]! / max) * (H - 12);
      return `M 8 ${y.toFixed(1)} L ${W - 8} ${y.toFixed(1)}`;
    }
    const step = (W - 16) / (pts.length - 1);
    return pts
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(8 + i * step).toFixed(1)} ${(H - (v / max) * (H - 12)).toFixed(1)}`)
      .join(' ');
  };

  return (
    <div style={{ padding: 'var(--sp-24)', maxWidth: 900, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-12)' }}>
        <span className="brand-mark" style={{ fontSize: 'var(--fs-22)' }}>
          TAPE
        </span>
        <span className="muted">performance history · committed bench runs</span>
        <a href="./" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
          ← app
        </a>
      </header>

      <section className="panel" style={{ marginTop: 'var(--sp-16)', padding: 'var(--sp-16)' }}>
        <h1 style={{ fontSize: 'var(--fs-13)', margin: 0 }} className="panel-title">
          Tick-to-screen p95 · heaviest matrix cell per engine · {runs.length} run
          {runs.length === 1 ? '' : 's'}
        </h1>
        <svg
          viewBox={`0 0 ${W} ${H + 8}`}
          style={{ width: '100%', marginTop: 'var(--sp-12)' }}
          role="img"
          aria-label="Tick-to-screen p95 trend per engine across committed bench runs"
        >
          <line x1="8" y1={H} x2={W - 8} y2={H} stroke="var(--border-default)" />
          <path d={path(series[0]!.points)} fill="none" stroke="var(--accent)" strokeWidth="2" />
          <path d={path(series[1]!.points)} fill="none" stroke="var(--status-positive)" strokeWidth="2" />
        </svg>
        <div
          className="spark-caption"
          style={{ display: 'flex', gap: 'var(--sp-16)', alignItems: 'center' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-6)' }}>
            <span
              aria-hidden="true"
              style={{ width: 16, height: 2, background: 'var(--accent)', borderRadius: 'var(--r-2)' }}
            />
            AG Grid
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-6)' }}>
            <span
              aria-hidden="true"
              style={{ width: 16, height: 2, background: 'var(--status-positive)', borderRadius: 'var(--r-2)' }}
            />
            Virtual
          </span>
          <span className="muted">y-max {max.toFixed(0)} ms · one point per committed run</span>
        </div>
      </section>

      {runs.map(({ file, run }) => (
        <section key={file} className="panel" style={{ marginTop: 'var(--sp-16)', padding: 'var(--sp-16)' }}>
          <h2 className="panel-title" style={{ margin: 0, fontSize: 'var(--fs-12)' }}>
            {run.capturedAt} {run.viewport ? `· ${run.viewport}` : ''}
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ marginTop: 'var(--sp-8)' }}>
              <thead>
                <tr>
                  <th scope="col">Engine</th>
                  <th scope="col">Universe</th>
                  <th scope="col">Rate</th>
                  <th scope="col">In/s</th>
                  <th scope="col">Out/s</th>
                  <th scope="col">FPS</th>
                  <th scope="col">p50/p95/p99 ms</th>
                  <th scope="col">Gaps</th>
                </tr>
              </thead>
              <tbody>
                {run.readings.map((r, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'left' }}>{r.engine}</td>
                    <td>{formatInt(r.universe)}</td>
                    <td>{formatInt(r.rate)}</td>
                    <td>{formatInt(r.msgsInPerSec)}</td>
                    <td>{formatInt(r.rowsOutPerSec)}</td>
                    <td>{r.fps}</td>
                    <td>
                      {r.t2sP50} / {r.t2sP95} / {r.t2sP99}
                    </td>
                    <td>{r.gaps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('root element missing');
createRoot(el).render(
  <StrictMode>
    <Trend />
  </StrictMode>,
);
