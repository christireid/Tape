// Fills the bench tables in README.md, docs/adr/004-*.md and docs/scorecard.md
// from the most recent bench/results/*.json. Run after `npm run bench`.
//   node bench/fill-tables.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RESULTS = join(HERE, 'results');

const files = readdirSync(RESULTS).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('no results');
  process.exit(1);
}
const latest = JSON.parse(readFileSync(join(RESULTS, files[files.length - 1]), 'utf8'));

const rows = latest.readings.map(
  (r) =>
    `| ${r.engine} | ${r.universe.toLocaleString()} | ${r.rate >= 1000 ? r.rate / 1000 + 'k' : r.rate} | ${r.msgsInPerSec.toLocaleString()} | ${r.rowsOutPerSec.toLocaleString()} | ${r.fps} | ${r.t2sP50} / ${r.t2sP95} / ${r.t2sP99} ms |`,
);

const readmeTable = [
  '| Engine | Universe | Rate | msgs/sec in | rows/sec out | FPS | tick-to-screen p50 / p95 / p99 |',
  '|---|---|---|---|---|---|---|',
  ...rows,
].join('\n');

const adrTable = [
  '| Engine | Universe | Rate | msgs/sec | rows/sec | FPS | t2s p50 / p95 / p99 |',
  '|---|---|---|---|---|---|---|',
  ...rows,
].join('\n');

function replaceBetween(path, start, end, content) {
  const src = readFileSync(path, 'utf8');
  const re = new RegExp(`(${start})[\\s\\S]*?(${end})`);
  writeFileSync(path, src.replace(re, `$1\n${content}\n$2`));
}

replaceBetween(join(ROOT, 'README.md'), '<!-- BENCH_TABLE_START -->', '<!-- BENCH_TABLE_END -->', readmeTable);
replaceBetween(join(ROOT, 'docs/adr/004-build-or-buy-the-grid.md'), '<!-- ADR_BENCH_TABLE_START -->', '<!-- ADR_BENCH_TABLE_END -->', adrTable);
replaceBetween(
  join(ROOT, 'docs/scorecard.md'),
  '<!-- SCORECARD_BENCH_TABLE_START -->',
  '<!-- SCORECARD_BENCH_TABLE_END -->',
  `Captured ${latest.capturedAt}, ${latest.viewport}.\n\n${readmeTable}`,
);

// eslint-disable-next-line no-console
console.log(`filled tables from ${files[files.length - 1]} (${latest.readings.length} rows)`);
