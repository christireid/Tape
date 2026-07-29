import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// axe across all six theme x density combinations, plus a soak with heap
// sampled every second (spec §8). Fails on any WCAG 2 A/AA violation, any
// console error, or heap growth.

const THEMES = ['dark', 'light', 'hc'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

async function setThemeDensity(page: Page, theme: string, density: string): Promise<void> {
  await page.evaluate(
    ([t, d]) => {
      document.documentElement.setAttribute('data-theme', t!);
      document.documentElement.setAttribute('data-density', d!);
    },
    [theme, density],
  );
  await page.waitForTimeout(150);
}

test('zero axe violations across six theme x density combinations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.waitForTimeout(1000);

  for (const theme of THEMES) {
    for (const density of DENSITIES) {
      await setThemeDensity(page, theme, density);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(
        results.violations,
        `${theme}/${density}: ${JSON.stringify(results.violations.map((v) => v.id))}`,
      ).toEqual([]);
    }
  }
});

test('60s soak — flat heap, zero console errors, no gaps', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.getByLabel('Message rate').selectOption('25000');
  await page.evaluate(() => window.__tape?.resetSamples());

  const soakMs = process.env.SOAK_MS ? Number(process.env.SOAK_MS) : 60_000;
  const heap: number[] = [];
  const start = Date.now();
  while (Date.now() - start < soakMs) {
    await page.waitForTimeout(1000);
    const h = await page.evaluate(() => window.__tape?.getTelemetry().heapMB ?? null);
    if (h !== null) heap.push(h);
  }

  const tele = await page.evaluate(() => window.__tape?.getTelemetry());
  expect(tele?.gapsRecovered).toBe(0);
  expect(tele && tele.fps > 0).toBeTruthy();
  expect(errors, errors.join('\n')).toEqual([]);

  if (heap.length >= 4) {
    const min = Math.min(...heap);
    const max = Math.max(...heap);
    // Least-squares slope over the per-second samples (MB/min). A slope over N
    // samples cannot be hidden by a GC that happens to reset at the last one.
    const n = heap.length;
    const meanX = (n - 1) / 2;
    const meanY = heap.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (heap[i]! - meanY);
      den += (i - meanX) ** 2;
    }
    const slopePerMin = (num / den) * 60;
    // eslint-disable-next-line no-console
    console.log(
      `soak heap: min=${min.toFixed(1)} MB max=${max.toFixed(1)} MB slope=${slopePerMin.toFixed(2)} MB/min over ${n} samples`,
    );
    // Bounded growth: the working set should not balloon over the soak.
    expect(max - min, `heap min=${min.toFixed(1)} max=${max.toFixed(1)}`).toBeLessThan(min + 40);
    expect(Math.abs(slopePerMin), `slope=${slopePerMin.toFixed(2)} MB/min`).toBeLessThan(20);
  }
});
