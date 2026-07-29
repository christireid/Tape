import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ADR 004's fairness ablations: isolate the async transaction queue's and the
// cell flash's contribution to the AG Grid latency figures. Baseline is the
// committed matrix cell (AG Grid, 1,200 × 25k, wait 32 ms, flash on).

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'results');
const SAMPLE_MS = 9000;

const VARIANTS = [
  { name: 'baseline (wait 32, flash on)', query: '' },
  { name: 'asyncTransactionWaitMillis: 0', query: '?ablate=wait0' },
  { name: 'cell flash disabled', query: '?ablate=noflash' },
];

interface Reading {
  variant: string;
  msgsInPerSec: number;
  rowsOutPerSec: number;
  fps: number;
  t2sP50: number;
  t2sP95: number;
  t2sP99: number;
  gaps: number;
}

async function measure(page: Page, variant: (typeof VARIANTS)[number]): Promise<Reading | null> {
  await page.goto(`/${variant.query}`);
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.getByRole('button', { name: 'AG Grid', exact: true }).click();
  await page.getByLabel('Universe size').selectOption('1200');
  await page.getByLabel('Message rate').selectOption('25000');
  await page.getByLabel('Conflation window').selectOption('16');
  await page.evaluate(() => window.__tape?.resetSamples());
  await page.waitForTimeout(SAMPLE_MS);
  return page.evaluate((name) => {
    const s = window.__tape;
    if (!s) return null;
    const t = s.getTelemetry();
    return {
      variant: name,
      msgsInPerSec: Math.round(t.msgsInPerSec),
      rowsOutPerSec: Math.round(t.rowsOutPerSec),
      fps: t.fps,
      t2sP50: +t.t2sP50.toFixed(1),
      t2sP95: +t.t2sP95.toFixed(1),
      t2sP99: +t.t2sP99.toFixed(1),
      gaps: t.gapsRecovered,
    };
  }, variant.name);
}

test('ablation — queue wait and cell flash isolated', async ({ page }) => {
  const readings: Reading[] = [];
  for (const v of VARIANTS) {
    const r = await measure(page, v);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.gaps).toBe(0);
      readings.push(r);
    }
  }
  mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(RESULTS, `ablation-${stamp}.json`),
    JSON.stringify({ capturedAt: new Date().toISOString(), cell: 'AG Grid 1200x25k', readings }, null, 2),
  );
  // eslint-disable-next-line no-console
  console.log('ablation:', JSON.stringify(readings, null, 2));
});
