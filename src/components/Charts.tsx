import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import { store } from '../store/marketStore.ts';
import { formatInt } from '../domain/format.ts';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

// Price tape — uPlot canvas, 0.25s bars, 600-point ring buffer, y-axis on the
// right (finance convention), rebuilt on theme change via a MutationObserver
// scoped to data-theme and on resize via a ResizeObserver.
export function PriceChart({ index }: { index: number }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const xs = useRef<number[]>([]);
  const ys = useRef<number[]>([]);

  useEffect(() => {
    xs.current = [];
    ys.current = [];
  }, [index]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const make = (): void => {
      plotRef.current?.destroy();
      const opts: uPlot.Options = {
        width: host.clientWidth || 320,
        height: host.clientHeight || 180,
        padding: [8, 8, 4, 4],
        cursor: { show: false },
        legend: { show: false },
        scales: { x: { time: false } },
        axes: [
          {
            stroke: cssVar('--text-muted'),
            grid: { stroke: cssVar('--border-subtle'), width: 1 },
            ticks: { stroke: cssVar('--border-subtle') },
            font: '10px JetBrains Mono, monospace',
          },
          {
            side: 1, // right
            stroke: cssVar('--text-muted'),
            grid: { stroke: cssVar('--border-subtle'), width: 1 },
            ticks: { stroke: cssVar('--border-subtle') },
            font: '10px JetBrains Mono, monospace',
          },
        ],
        series: [
          {},
          {
            stroke: cssVar('--accent'),
            width: 2,
            fill: `${cssVar('--accent')}24`, // ~14% alpha area under the line
            points: { show: false },
          },
        ],
      };
      plotRef.current = new uPlot(opts, [xs.current, ys.current], host);
    };

    make();

    const ro = new ResizeObserver(() => {
      const p = plotRef.current;
      if (p) p.setSize({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);

    const mo = new MutationObserver(() => make());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const timer = setInterval(() => {
      const row = store.rowByIndex(index);
      if (!row) return;
      const t = (xs.current[xs.current.length - 1] ?? 0) + 1;
      xs.current.push(t);
      ys.current.push(row.last);
      if (xs.current.length > 600) {
        xs.current.shift();
        ys.current.shift();
      }
      plotRef.current?.setData([xs.current, ys.current]);
    }, 250);

    return () => {
      clearInterval(timer);
      ro.disconnect();
      mo.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [index]);

  return <div className="chart-host" ref={hostRef} aria-label="Price tape (synthetic)" role="img" />;
}

function polyline(values: number[], w: number, h: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ');
}

// Throughput sparklines — messages in/sec and tick-to-screen p95, at 4 Hz, with
// a caption stating the live conflation ratio. The most persuasive image in the
// project: a domain reader sees at once that you know why conflation exists.
export function ThroughputChart(): React.JSX.Element {
  const msgs = useRef<number[]>([]);
  const lat = useRef<number[]>([]);
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const t = store.getTelemetry();
      msgs.current.push(t.msgsInPerSec);
      lat.current.push(t.t2sP95);
      if (msgs.current.length > 120) msgs.current.shift();
      if (lat.current.length > 120) lat.current.shift();
      tick((x) => x + 1);
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const t = store.getTelemetry();
  const W = 300;
  const H = 40;

  return (
    <div className="spark-wrap">
      <div className="spark">
        <span className="spark-caption">
          Messages in/sec · {formatInt(t.msgsInPerSec)}
        </span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Messages in per second">
          <polyline points={polyline(msgs.current, W, H)} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="spark">
        <span className="spark-caption">Tick-to-screen p95 · {t.t2sP95.toFixed(1)} ms</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tick to screen p95 latency">
          <polyline points={polyline(lat.current, W, H)} fill="none" stroke="var(--status-warning)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="spark-caption">
        Conflation {t.conflationRatio.toFixed(1)}:1 · {formatInt(t.msgsInPerSec)} in over{' '}
        {formatInt(t.rowsOutPerSec)} out
      </div>
    </div>
  );
}
