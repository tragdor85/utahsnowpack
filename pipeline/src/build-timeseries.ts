/**
 * Build `data/timeseries.json` (docs/PLAN.md task 9) — the current water
 * year's daily SWE + water-year precipitation for every registry station,
 * in the compact shared-date-axis format the app charts from.
 *
 * Reads the pinned fixture (data/fixtures/awdb-series-*.json — the raw AWDB
 * API capture written by fetch:all) and the site registry (data/sites.json),
 * and writes data/timeseries.json (committed; the daily pipeline updates it).
 *
 * Usage: pnpm --filter @utahsnowpack/pipeline build:timeseries
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './registry.js';
import {
  buildTimeseries,
  waterYearOf,
  waterYearStart,
  type AwdbSeriesEntry,
} from './sources/awdb.js';

const root = join(import.meta.dirname, '..', '..');
const fixtures = join(root, 'data', 'fixtures');

function findFixture(pattern: string): string | null {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
  const files = readdirSync(fixtures)
    .filter((f) => regex.test(f))
    .sort()
    .reverse(); // newest capture wins
  return files[0] ? join(fixtures, files[0]) : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const fixturePath = findFixture('awdb-series-*.json');
if (!fixturePath) {
  console.error('fatal: no awdb-series-*.json fixture in data/fixtures (run fetch:all first)');
  process.exit(1);
}

// The capture date is the date-stamped file name (fetch:all convention).
const captureDate = fixturePath.match(/awdb-series-(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
if (!captureDate) {
  console.error(`fatal: cannot read capture date from ${fixturePath}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as AwdbSeriesEntry[];
if (!Array.isArray(raw)) {
  console.error('fatal: awdb fixture is not an array of series entries');
  process.exit(1);
}

const registry = loadRegistry();
const waterYear = waterYearOf(captureDate);
// The fixture's mtime is when fetch:all captured the API response.
const fetchedAt = statSync(fixturePath).mtime.toISOString();
const data = buildTimeseries(raw, {
  waterYear,
  fetchedAt,
  registryTriplets: registry.sites.map((s) => s.stationTriplet),
  endDate: captureDate,
});

const outPath = join(root, 'data', 'timeseries.json');
writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');

const withData = data.stations.filter((s) => s.w.some((v) => v !== null)).length;
console.log(
  `wrote ${outPath}\n` +
    `  water year ${waterYear} (${waterYearStart(waterYear)} .. ${captureDate}), ` +
    `${data.dates.length} days, ${data.stations.length} stations ` +
    `(${withData} with SWE data)\n` +
    `  ${Math.round(JSON.stringify(data).length / 1024)} KB`,
);
if (data.warnings.length > 0) {
  console.log(`  ${data.warnings.length} warning(s):`);
  for (const w of data.warnings) console.log(`    ! ${w}`);
}
