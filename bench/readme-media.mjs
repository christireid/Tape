// Captures every visual asset in the README — animated GIFs and stills — from a
// running build, so the pixels in the README are reproducible from the code in
// the repo:  node bench/readme-media.mjs
// Frames are captured with Playwright, decoded with pngjs, and encoded with
// gifenc (pure JS — no ffmpeg dependency).
//
// Two classes of asset:
//   · full-frame  — the whole 1600x940 app, downscaled for README width
//   · region      — a single panel, cropped from its live bounding box
// Regions are where most of the density comes from: they are small enough to
// spend freely on, and they show a feature at the size a reader can actually
// read it at.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
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
// proxies every image on page open, so total weight is a feature.
const W = 1600;
const H = 940;
const FULL_SCALE = 0.55; // 880x517 in the README
const REGION_SCALE = 0.75; // regions are already small; keep more detail
const PALETTE_COLORS = 32; // a dark, flat UI needs nothing near 256

mkdirSync(OUT, { recursive: true });

/** Nearest-neighbour box downscale — keeps text crisp for GIF quantisation. */
function downscale(png, scale) {
  if (scale >= 0.999) return { width: png.width, height: png.height, data: png.data };
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

function encodeGif(frames, delayMs, name, scale = FULL_SCALE) {
  const gif = GIFEncoder();
  for (const buf of frames) {
    const png = downscale(PNG.sync.read(buf), scale);
    const palette = quantize(png.data, PALETTE_COLORS);
    const index = applyPalette(png.data, palette);
    gif.writeFrame(index, png.width, png.height, { palette, delay: delayMs });
  }
  gif.finish();
  writeFileSync(join(OUT, name), Buffer.from(gif.bytes()));
  console.error(`  ${name}  ${frames.length}f  ${(gif.bytes().length / 1e3).toFixed(0)} kB`);
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
const page = await browser.newPage({ viewport: { width: W, height: H }, locale: 'en-US' });

/**
 * Clip rectangle for a live element, optionally trimmed. `crop` values are in
 * CSS pixels taken off each edge; `height`/`width` override the measured size
 * so a region can show its first N rows rather than the whole scroller.
 */
async function region(selector, opts = {}) {
  const el = page.locator(selector).first();
  const b = await el.boundingBox();
  if (!b) throw new Error(`no bounding box for ${selector}`);
  const pad = opts.pad ?? 0;
  let { x, y, width, height } = b;
  x = Math.max(0, x - pad + (opts.left ?? 0));
  y = Math.max(0, y - pad + (opts.top ?? 0));
  width = (opts.width ?? width + pad * 2) - (opts.left ?? 0);
  height = (opts.height ?? height + pad * 2) - (opts.top ?? 0);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.min(width, W - x)),
    height: Math.round(Math.min(height, H - y)),
  };
}

async function still(name, clip) {
  writeFileSync(join(OUT, name), await page.screenshot(clip ? { clip } : {}));
  console.error(`  ${name}  ${(statSync(join(OUT, name)).size / 1e3).toFixed(0)} kB`);
}

async function buy(qty = '1000') {
  await page.getByLabel('Quantity').fill(qty);
  const confirm = page.getByLabel('Type CONFIRM to arm submit');
  if (await confirm.count()) await confirm.fill('CONFIRM');
  await page.getByRole('button', { name: /(BUY|SELL) / }).click();
}

await page.goto(URL);
await page.getByText('Synthetic data').waitFor();
await page.waitForTimeout(2500);

// Populate positions and P&L so every frame carries a live book. Three
// instruments, both sides, so the panels show real colour rather than one row.
await buy('1000');
await page.waitForTimeout(1200);
await page.locator('.ag-row').nth(3).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Sell', exact: true }).click();
await buy('2000'); // FX lot size is 1,000 — the ticket rejects anything else
await page.waitForTimeout(1200);
await page.locator('.ag-row').nth(7).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Buy', exact: true }).click();
await buy('50');
await page.waitForTimeout(1200);
await page.locator('.ag-row').nth(0).click();
await page.waitForTimeout(2500);

const SIDE = '.col-side';
const GRID = '.grid-host';
const TICKET = 'section[aria-label="Order ticket"]';
const POSITIONS = 'section[aria-label="Positions"]';
const ORDERS = 'section[aria-label="Orders"]';
const TAPE = 'section[aria-label="Price tape"]';
const DEPTH = 'section[aria-label="Depth ladder"]';
const THROUGHPUT = 'section[aria-label="Throughput"]';
const STATUS = 'footer.statusbar';
const TOPBAR = 'header.topbar';

console.error('full-frame');

// ── The live tape (dark, 8k msgs/sec) ────────────────────────────────────────
encodeGif(await captureFrames(page, 20, 150), 15, 'live-tape.gif');

console.error('regions · the tick path');

// ── Cell flashes, close up ───────────────────────────────────────────────────
const gridTop = await region(GRID, { height: 300 });
encodeGif(await captureFrames(page, 18, 130, gridTop), 13, 'cell-flash.gif', REGION_SCALE);

// ── Live latency + throughput counters in the status bar ─────────────────────
const statusBox = await region(STATUS);
encodeGif(await captureFrames(page, 12, 400, statusBox), 40, 'status-bar.gif', 1);

// ── Throughput sparklines, price tape, depth ladder ──────────────────────────
encodeGif(await captureFrames(page, 14, 350, await region(THROUGHPUT)), 35, 'throughput.gif', REGION_SCALE);
encodeGif(await captureFrames(page, 14, 350, await region(TAPE)), 35, 'price-tape.gif', REGION_SCALE);
encodeGif(await captureFrames(page, 12, 400, await region(DEPTH)), 40, 'depth.gif', REGION_SCALE);

await still('positions.png', await region(POSITIONS, { height: 148 }));

console.error('regions · order entry');

// ── The fat-finger gate arming ───────────────────────────────────────────────
const ticketBox = await region(TICKET, { pad: 6 });
await page.getByLabel('Quantity').fill('1000');
const fTicket = await captureFrames(page, 3, 250, ticketBox);
await page.getByLabel('Quantity').fill('500000'); // trips the $250k notional gate
fTicket.push(...(await captureFrames(page, 5, 250, ticketBox)));
await page.getByLabel('Type CONFIRM to arm submit').fill('CONF');
fTicket.push(...(await captureFrames(page, 3, 250, ticketBox)));
await page.getByLabel('Type CONFIRM to arm submit').fill('CONFIRM');
fTicket.push(...(await captureFrames(page, 5, 250, ticketBox)));
encodeGif(fTicket, 30, 'fat-finger.gif', REGION_SCALE);

// ── Optimistic lifecycle: WORKING → PARTIAL → FILLED ─────────────────────────
const ordersBox = await region(ORDERS);
await page.getByLabel('Quantity').fill('4000');
const fOrders = [];
const submit = page.getByRole('button', { name: /(BUY|SELL) / });
fOrders.push(...(await captureFrames(page, 2, 150, ordersBox)));
await submit.click();
fOrders.push(...(await captureFrames(page, 16, 220, ordersBox)));
encodeGif(fOrders, 22, 'order-lifecycle.gif', REGION_SCALE);

console.error('regions · chrome');

// ── Filtering 1,200 instruments live ─────────────────────────────────────────
const filterBox = await region('.toolbar', { height: 360 });
const filterInput = page.getByLabel('Filter blotter');
const fFilter = await captureFrames(page, 2, 200, filterBox);
for (const s of ['E', 'U', 'R']) {
  await filterInput.type(s, { delay: 40 });
  fFilter.push(...(await captureFrames(page, 3, 180, filterBox)));
}
await filterInput.fill('');
fFilter.push(...(await captureFrames(page, 4, 180, filterBox)));
encodeGif(fFilter, 20, 'filter.gif', REGION_SCALE);

// Blur the filter before any keyboard capture: shortcuts are suppressed while a
// text input has focus, so a stray '?' would be typed into the filter instead of
// opening the help sheet — and would leave the grid filtered for every frame
// captured after it.
await filterInput.blur();
await page.waitForTimeout(600);

// ── Command palette and keyboard reference ───────────────────────────────────
await page.keyboard.press('Control+k');
await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
await page.waitForTimeout(400);
await still('command-palette.png', { x: 380, y: 90, width: 840, height: 560 });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.keyboard.press('?');
const helpSheet = page.getByRole('dialog', { name: 'Keyboard reference' });
await helpSheet.waitFor();
await page.waitForTimeout(400);
await still('help-sheet.png', await region('.help-sheet', { pad: 10 }));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

console.error('full-frame · load and engines');

// ── 50k msgs/sec + a live engine swap ────────────────────────────────────────
await page.getByLabel('Message rate').selectOption('50000');
await page.waitForTimeout(1500);
const f50 = await captureFrames(page, 11, 150);
await page.getByRole('button', { name: 'Virtual', exact: true }).click();
await page.waitForTimeout(400);
f50.push(...(await captureFrames(page, 11, 150)));
encodeGif(f50, 15, 'fifty-k.gif');

// Same rows, same store, two independent renderers.
await page.waitForTimeout(800);
await still('engine-virtual.png', await region('[aria-label="Blotter (hand-built virtual engine)"]', { height: 260 }));
await page.getByRole('button', { name: 'AG Grid', exact: true }).click();
await page.waitForTimeout(1200);
await still('engine-aggrid.png', await region(GRID, { height: 260 }));
await page.getByLabel('Message rate').selectOption('8000');
await page.waitForTimeout(1200);

console.error('regions · faults');

// ── Sequence gap: detected, resynced, counted ────────────────────────────────
const topBox = await region(TOPBAR);
const fGap = await captureFrames(page, 3, 250, topBox);
await page.keyboard.press('g');
fGap.push(...(await captureFrames(page, 9, 250, topBox)));
encodeGif(fGap, 25, 'sequence-gap.gif', 1);
await page.waitForTimeout(1500);

// ── Disconnect → stale gate → recovery (full frame) ──────────────────────────
const fFault = await captureFrames(page, 4, 200);
await page.keyboard.press('x');
fFault.push(...(await captureFrames(page, 24, 300)));
encodeGif(fFault, 25, 'fault-recovery.gif');
await page.waitForTimeout(2000);

// ── The stale gate itself, close up ──────────────────────────────────────────
await page.keyboard.press('x');
await page.waitForTimeout(900);
await still('stale-gate.png', await region(SIDE, { height: 420 }));
await page.waitForTimeout(4500);

console.error('themes and density');

// ── Three themes × two densities, no remount ─────────────────────────────────
const fTheme = await captureFrames(page, 4, 180);
for (const key of ['t', 't', 't', 'd']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  fTheme.push(...(await captureFrames(page, 4, 180)));
}
await page.keyboard.press('d');
await page.waitForTimeout(400);
encodeGif(fTheme, 26, 'themes.gif');

// ── Density, side by side ────────────────────────────────────────────────────
const densityBox = await region(GRID, { height: 264 });
if ((await page.getAttribute('html', 'data-density')) !== 'comfortable') {
  await page.keyboard.press('d');
  await page.waitForTimeout(500);
}
await still('density-comfortable.png', densityBox);
await page.keyboard.press('d');
await page.waitForTimeout(500);
await still('density-compact.png', densityBox);
await page.keyboard.press('d');
await page.waitForTimeout(500);

// ── Stills · all three themes, full frame ────────────────────────────────────
for (const [theme, name] of [
  ['dark', 'theme-dark.png'],
  ['light', 'theme-light.png'],
  ['hc', 'theme-hc.png'],
]) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(700);
  await still(name, undefined);
}
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

const total = readdirSync(OUT).reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.error(`\nreadme media captured — ${readdirSync(OUT).length} files, ${(total / 1e6).toFixed(1)} MB`);
await browser.close();
