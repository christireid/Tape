// Measures cold-cache first paint against a running production build.
//   node bench/first-paint.mjs
// Fresh browser context per run (no cache); reports FCP and the time to a live
// blotter (first row of real data) across N runs.

import { chromium } from '@playwright/test';

const URL = process.env.FIRST_PAINT_URL || 'http://127.0.0.1:5180';
const RUNS = Number(process.env.FIRST_PAINT_RUNS || 5);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});

const fcps = [];
const interactives = [];
for (let i = 0; i < RUNS; i++) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 940 } });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load' });
  const fcp = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const existing = performance
          .getEntriesByType('paint')
          .find((e) => e.name === 'first-contentful-paint');
        if (existing) return resolve(existing.startTime);
        const po = new PerformanceObserver((list) => {
          const e = list.getEntries().find((x) => x.name === 'first-contentful-paint');
          if (e) {
            po.disconnect();
            resolve(e.startTime);
          }
        });
        po.observe({ type: 'paint', buffered: true });
        setTimeout(() => {
          po.disconnect();
          resolve(null);
        }, 5000);
      }),
  );
  await page.getByText('Synthetic data').waitFor();
  // "interactive" here = the synthetic feed is live and the blotter has data.
  await page.waitForFunction(() => (window.__tape?.rows.some((r) => r.seq > 0) ?? false));
  const live = Date.now() - t0;
  if (fcp !== null) fcps.push(fcp);
  interactives.push(live);
  await context.close();
}
await browser.close();

const stats = (a) => {
  if (a.length === 0) return 'n/a';
  return {
    min: Math.min(...a).toFixed(0),
    median: a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(0),
    max: Math.max(...a).toFixed(0),
  };
};
// eslint-disable-next-line no-console
console.log(
  JSON.stringify({ runs: RUNS, fcpMs: stats(fcps), liveBlotterMs: stats(interactives) }, null, 2),
);
