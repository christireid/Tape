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
// Capture at the viewport the app is designed for (1600x940) so nothing is
// clipped, then downscale for README width. A README is a shop window: GitHub
// proxies every image on page open, so total weight is a feature. These settings
// keep the whole set near 3 MB rather than 10 — the motion is the message, and
// the crisp detail lives in the full-resolution hero screenshot.
const W = 1600;
const H = 940;
const SCALE = 0.55; // 880x517 in the README
const PALETTE_COLORS = 32; // a dark, flat UI needs nothing near 256

mkdirSync(OUT, { recursive: true });

/** Nearest-neighbour box downscale — keeps text crisp for GIF quantisation. */
function downscale(png, scale) {
  const w = Math.round(png.width * scale);
  const h = Math.round(png.height * scale);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(png.height - 1, Math.round(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(png.width - 1, Math.round(x / scale));
      out.set(png.data.subarray((sy * png.width + sx) * 4, (sy * png.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

function encodeGif(frames, delayMs, path) {
  const gif = GIFEncoder();
  for (const buf of frames) {
    const png = downscale(PNG.sync.read(buf), SCALE);
    const palette = quantize(png.data, PALETTE_COLORS);
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
encodeGif(await captureFrames(page, 20, 150), 15, join(OUT, 'live-tape.gif'));

// ── GIF 2 · 50k msgs/sec + engine switch ─────────────────────────────────────
await page.getByLabel('Message rate').selectOption('50000');
await page.waitForTimeout(1500);
const f50 = await captureFrames(page, 11, 150);
await page.getByRole('button', { name: 'Virtual', exact: true }).click();
await page.waitForTimeout(400);
f50.push(...(await captureFrames(page, 11, 150)));
encodeGif(f50, 15, join(OUT, 'fifty-k.gif'));
await page.getByRole('button', { name: 'AG Grid', exact: true }).click();
await page.getByLabel('Message rate').selectOption('8000');
await page.waitForTimeout(1200);

// ── GIF 3 · disconnect → stale gate → recovery ───────────────────────────────
const fFault = await captureFrames(page, 4, 200);
await page.keyboard.press('x');
fFault.push(...(await captureFrames(page, 24, 300)));
encodeGif(fFault, 25, join(OUT, 'fault-recovery.gif'));
await page.waitForTimeout(2000);

// ── GIF 4 · three themes × two densities, no remount ─────────────────────────
const fTheme = await captureFrames(page, 4, 180);
for (const key of ['t', 't', 't', 'd']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  fTheme.push(...(await captureFrames(page, 4, 180)));
}
await page.keyboard.press('d');
encodeGif(fTheme, 26, join(OUT, 'themes.gif'));
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
