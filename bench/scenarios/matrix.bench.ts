import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The benchmark matrix. Drives the real UI at each (engine, universe, rate),
// discards a warm-up, then reads live telemetry. Results are written to
// bench/results/<ISO-timestamp>.json and committed by CI.

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'results');

const SAMPLE_MS = process.env.BENCH_QUICK ? 3500 : 9000;

interface Cell {
  engine: 'AG Grid' | 'Virtual';
  universe: 500 | 1200 | 5000;
  rate: 1000 | 8000 | 25000 | 50000;
}

const MATRIX: Cell[] = process.env.BENCH_QUICK
  ? [
      { engine: 'AG Grid', universe: 1200, rate: 8000 },
      { engine: 'Virtual', universe: 1200, rate: 8000 },
    ]
  : [
      { engine: 'AG Grid', universe: 1200, rate: 8000 },
      { engine: 'AG Grid', universe: 1200, rate: 25000 },
      { engine: 'AG Grid', universe: 1200, rate: 50000 },
      { engine: 'AG Grid', universe: 5000, rate: 50000 },
      { engine: 'Virtual', universe: 1200, rate: 8000 },
      { engine: 'Virtual', universe: 1200, rate: 25000 },
      { engine: 'Virtual', universe: 1200, rate: 50000 },
      { engine: 'Virtual', universe: 5000, rate: 50000 },
    ];

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

async function configure(page: Page, cell: Cell): Promise<void> {
  await page.getByRole('button', { name: cell.engine, exact: true }).click();
  await page.getByLabel('Universe size').selectOption(String(cell.universe));
  await page.getByLabel('Message rate').selectOption(String(cell.rate));
  await page.getByLabel('Conflation window').selectOption('16');
  await page.evaluate(() => window.__tape?.resetSamples());
}

async function read(page: Page): Promise<Reading | null> {
  return page.evaluate(() => {
    const s = window.__tape;
    if (!s) return null;
    const t = s.getTelemetry();
    return {
      engine: s.engine,
      universe: s.config.universe,
      rate: s.config.rate,
      msgsInPerSec: Math.round(t.msgsInPerSec),
      rowsOutPerSec: Math.round(t.rowsOutPerSec),
      fps: t.fps,
      t2sP50: +t.t2sP50.toFixed(1),
      t2sP95: +t.t2sP95.toFixed(1),
      t2sP99: +t.t2sP99.toFixed(1),
      gaps: t.gapsRecovered,
    };
  });
}

test('benchmark matrix — both engines', async ({ page }) => {
  const readings: Reading[] = [];
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();

  for (const cell of MATRIX) {
    await configure(page, cell);
    await page.waitForTimeout(SAMPLE_MS);
    const r = await read(page);
    expect(r).not.toBeNull();
    if (r) {
      readings.push(r);
      // Sustains load: gap counter reads 0 in steady state.
      expect(r.gaps).toBe(0);
    }
  }

  mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = { capturedAt: new Date().toISOString(), viewport: '1600x940', readings };
  writeFileSync(join(RESULTS, `${stamp}.json`), JSON.stringify(out, null, 2));
  // eslint-disable-next-line no-console
  console.log('bench results:', JSON.stringify(readings, null, 2));
});
