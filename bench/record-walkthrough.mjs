// Records the ~90-second walkthrough (docs/walkthrough.webm) against a running
// build:  node bench/record-walkthrough.mjs
// Sequence: load → blotter live → engine switch → 5,000 × 50k load → fault
// injection (gap, disconnect + recovery) → order through the gates → theme and
// density switching → command palette.

import { chromium } from '@playwright/test';
import { renameSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'docs');
const URL = process.env.WALKTHROUGH_URL || 'http://127.0.0.1:5180';
const SIZE = { width: 1280, height: 752 };

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
const tmp = join(OUT, '_video-tmp');
mkdirSync(tmp, { recursive: true });
const context = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: tmp, size: SIZE },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(URL);
await page.getByText('Synthetic data').waitFor();
await pause(6000); // blotter live at defaults (1,200 × 8k, AG Grid)

// Engine switch → hand-built virtualizer
await page.getByRole('button', { name: 'Virtual', exact: true }).click();
await pause(6000);

// Scale to the heaviest cell: 5,000 instruments × 50k msgs/sec
await page.getByLabel('Universe size').selectOption('5000');
await page.getByLabel('Message rate').selectOption('50000');
await pause(9000);

// Back to AG Grid under the same load
await page.getByRole('button', { name: 'AG Grid', exact: true }).click();
await pause(8000);

// Fault injection: sequence gap, then disconnect + recovery
await page.keyboard.press('g');
await pause(2500);
await page.keyboard.press('x');
await pause(6500); // stale banner, desaturated quotes, submit disabled
await pause(4000); // recovery

// Order through the gates
await page.getByLabel('Message rate').selectOption('8000');
await page.getByLabel('Universe size').selectOption('1200');
await pause(2500);
await page.getByLabel('Quantity').fill('1000');
await pause(1200);
const confirm = page.getByLabel('Type CONFIRM to arm submit');
if (await confirm.count()) {
  await confirm.fill('CONFIRM');
  await pause(1200);
}
await page.getByRole('button', { name: /BUY EURUSD/ }).click();
await pause(5000); // fills land, positions + P&L populate

// Theme cycle and density
await page.keyboard.press('t');
await pause(2500);
await page.keyboard.press('t');
await pause(2500);
await page.keyboard.press('t');
await pause(2000);
await page.keyboard.press('d');
await pause(2500);
await page.keyboard.press('d');
await pause(1500);

// Command palette
await page.keyboard.press('Control+k');
await pause(1800);
await page.getByPlaceholder('Type a command…').fill('flatten');
await pause(1500);
await page.keyboard.press('Enter');
await pause(4000); // flatten fills, P&L realises

const video = page.video();
await context.close();
const path = await video.path();
await browser.close();

const target = join(OUT, 'walkthrough.webm');
renameSync(path, target);
for (const f of readdirSync(tmp)) {
  // leftover files, if any
  console.error('leftover video file:', f);
}
// eslint-disable-next-line no-console
console.log('recorded', target);
