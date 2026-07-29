// Design conformance. The visual bar is enforced the same way the type system
// is — checks that pass or fail. Static checks read the token layer; DOM checks
// drive a real Chromium against the built app. Exits non-zero on any failure.
//
//   node bench/conformance.mjs

import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const URL = process.env.CONFORMANCE_URL || 'http://127.0.0.1:5180';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  // eslint-disable-next-line no-console
  console.log(`${tag}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ── Static: no raw colour / no primitives outside the token layer ────────────
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
function staticColourCheck() {
  const files = ['src/styles/app.css', 'src/styles/aggrid.css'];
  const primitives = /var\(--(?:ink|blue|green|red|amber|violet|white)\b/;
  const rawHex = /#[0-9a-fA-F]{3,8}\b/;
  let offenders = [];
  for (const f of files) {
    const css = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (rawHex.test(css)) offenders.push(`${f}: raw hex`);
    if (primitives.test(css)) offenders.push(`${f}: primitive var`);
  }
  check('No raw colour outside the token layer', offenders.length === 0, offenders.join('; '));
}

// ── DOM checks ───────────────────────────────────────────────────────────────
async function domChecks(page) {
  await page.goto(URL);
  await page.getByText('Synthetic data').waitFor();
  await page.waitForTimeout(2500);

  // tabular figures on numeric leaves
  const tab = await page.evaluate(() => {
    const sel = '.num, .vcell.n, .metric-value, .stat .v, .tbl td, .ag-right-aligned-cell';
    const nodes = Array.from(document.querySelectorAll(sel));
    let bad = 0;
    for (const n of nodes) {
      const v = getComputedStyle(n).fontVariantNumeric;
      if (!v.includes('tabular-nums')) bad++;
    }
    return { total: nodes.length, bad };
  });
  check(
    'Numeric text uses tabular figures',
    tab.bad === 0 && tab.total > 0,
    `${tab.total} numeric leaves, ${tab.bad} non-tabular`,
  );

  // direction glyph, not colour alone
  const glyph = await page.evaluate(() => {
    const re = /[▲▼·+−]/;
    const nodes = Array.from(document.querySelectorAll('.ag-cell.pos, .ag-cell.neg, .vcell.pos, .vcell.neg'));
    let withGlyph = 0;
    for (const n of nodes) if (re.test(n.textContent || '')) withGlyph++;
    return { total: nodes.length, withGlyph };
  });
  check(
    'Sign carried by glyph, not colour alone',
    glyph.total === 0 || glyph.withGlyph > 0,
    `${glyph.withGlyph} cells carry a direction glyph`,
  );

  // prices on the tick grid (from the live snapshot)
  const grid = await page.evaluate(() => {
    const s = window.__tape;
    if (!s) return { checked: 0, off: 1 };
    let checked = 0;
    let off = 0;
    for (const r of s.rows) {
      for (const p of [r.bid, r.ask, r.last, r.high, r.low]) {
        checked++;
        const n = p / r.tickSize;
        if (Math.abs(n - Math.round(n)) > 1e-6) off++;
      }
    }
    return { checked, off };
  });
  check('Prices render on the tick grid', grid.off === 0, `${grid.checked} prices checked, ${grid.off} off grid`);

  // modelled depth labelled
  const modelled = await page.getByText(/modelled/i).count();
  check('Modelled depth labelled as modelled', modelled > 0);

  // synthetic disclosed
  const synth = await page.getByText('Synthetic data').count();
  check('Synthetic data disclosed in the interface', synth > 0);

  // theme + density switch without remounting the grid
  const before = await page.evaluate(() => window.__gridReadyCount ?? 0);
  await page.keyboard.press('t');
  await page.keyboard.press('t');
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__gridReadyCount ?? 0);
  check('Theme and density switch without remounting the grid', before === after, `ready count ${before} → ${after}`);

  // density token drives row height (comfortable = 30px). Driven through the
  // real control (keyboard 'd'), which moves React state + attribute together.
  const density = () => page.evaluate(() => document.documentElement.getAttribute('data-density'));
  if ((await density()) !== 'comfortable') {
    await page.keyboard.press('d');
    await page.waitForTimeout(300);
  }
  const rowHeight = () =>
    page.evaluate(() => {
      const row = document.querySelector('.ag-row');
      return row ? Math.round(row.getBoundingClientRect().height) : -1;
    });
  const hComfortable = await rowHeight();
  await page.keyboard.press('d'); // → compact
  await page.waitForTimeout(300);
  const hCompact = await rowHeight();
  await page.keyboard.press('d'); // restore comfortable
  check(
    'Density token drives row height',
    Math.abs(hComfortable - 30) <= 1 && Math.abs(hCompact - 22) <= 1,
    `comfortable ${hComfortable}px, compact ${hCompact}px`,
  );

  // conflation ratio self-consistent with the displayed counters
  const ratio = await page.evaluate(() => {
    const s = window.__tape;
    if (!s) return { ok: false };
    const t = s.getTelemetry();
    const recomputed = t.rowsOutPerSec > 0 ? t.msgsInPerSec / t.rowsOutPerSec : 1;
    return { ok: Math.abs(recomputed - t.conflationRatio) < 0.05, shown: t.conflationRatio, recomputed };
  });
  check(
    'Conflation ratio derived from the displayed counters',
    ratio.ok,
    `shown ${ratio.shown?.toFixed(1)} vs ${ratio.recomputed?.toFixed(1)}`,
  );
}

async function main() {
  staticColourCheck();

  // Reuse a server if one is already listening; otherwise build + preview.
  let alreadyUp = false;
  try {
    const r = await fetch(URL);
    alreadyUp = r.ok;
  } catch {
    alreadyUp = false;
  }

  let server = null;
  if (!alreadyUp) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
      spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
    }
    server = spawn('npx', ['vite', 'preview', '--port', '5180', '--strictPort', '--host', '127.0.0.1'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(URL);
        if (r.ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
    await domChecks(page);
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length - failed.length}/${results.length} conformance checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
