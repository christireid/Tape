// Captures the README's visual assets — animated GIFs and theme screenshots —
// from a running build, so the pixels in the README are reproducible from the
// code in the repo:  node bench/readme-media.mjs
// Frames are captured with Playwright, decoded with pngjs, and encoded with
// gifenc (pure JS — no ffmpeg dependency).

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { PNG } = require('pngjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'media');
const URL = process.env.README_MEDIA_URL || 'http://127.0.0.1:5180';
const W = 1200;
const H = 700;

mkdirSync(OUT, { recursive: true });

function encodeGif(frames, delayMs, path) {
  const gif = GIFEncoder();
  for (const buf of frames) {
    const png = PNG.sync.read(buf);
    const palette = quantize(png.data, 256);
    const index = applyPalette(png.data, palette);
    gif.writeFrame(index, png.width, png.height, { palette, delay: delayMs });
  }
  gif.finish();
  writeFileSync(path, Buffer.from(gif.bytes()));
  console.error(`${path} (${frames.length} frames, ${(gif.bytes().length / 1e6).toFixed(1)} MB)`);
}

async function captureFrames(page, count, intervalMs, clip) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push(await page.screenshot(clip ? { clip } : {}));
    await page.waitForTimeout(intervalMs);
  }
  return frames;
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(URL);
await page.getByText('Synthetic data').waitFor();
await page.waitForTimeout(2500);

// Populate positions and P&L so the frames carry a live book.
await page.getByLabel('Quantity').fill('1000');
const confirm = page.getByLabel('Type CONFIRM to arm submit');
if (await confirm.count()) await confirm.fill('CONFIRM');
await page.getByRole('button', { name: /BUY EURUSD/ }).click();
await page.waitForTimeout(3000);

// ── GIF 1 · the live tape (dark, 8k msgs/sec) ────────────────────────────────
encodeGif(await captureFrames(page, 28, 120), 12, join(OUT, 'live-tape.gif'));

// ── GIF 2 · 50k msgs/sec + engine switch ─────────────────────────────────────
await page.getByLabel('Message rate').selectOption('50000');
await page.waitForTimeout(1500);
const f50 = await captureFrames(page, 14, 120);
await page.getByRole('button', { name: 'Virtual', exact: true }).click();
await page.waitForTimeout(400);
f50.push(...(await captureFrames(page, 14, 120)));
encodeGif(f50, 12, join(OUT, 'fifty-k.gif'));
await page.getByRole('button', { name: 'AG Grid', exact: true }).click();
await page.getByLabel('Message rate').selectOption('8000');
await page.waitForTimeout(1200);

// ── GIF 3 · disconnect → stale gate → recovery ───────────────────────────────
const fFault = await captureFrames(page, 6, 150);
await page.keyboard.press('x');
fFault.push(...(await captureFrames(page, 30, 250)));
encodeGif(fFault, 20, join(OUT, 'fault-recovery.gif'));
await page.waitForTimeout(2000);

// ── GIF 4 · three themes × two densities, no remount ─────────────────────────
const fTheme = await captureFrames(page, 5, 150);
for (const key of ['t', 't', 't', 'd']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  fTheme.push(...(await captureFrames(page, 5, 150)));
}
await page.keyboard.press('d');
encodeGif(fTheme, 22, join(OUT, 'themes.gif'));
await page.waitForTimeout(500);

// ── Stills · light and high-contrast themes ──────────────────────────────────
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.waitForTimeout(600);
writeFileSync(join(OUT, 'theme-light.png'), await page.screenshot());
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'hc'));
await page.waitForTimeout(600);
writeFileSync(join(OUT, 'theme-hc.png'), await page.screenshot());
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

console.error('readme media captured');
await browser.close();
