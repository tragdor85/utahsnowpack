// Copy data/snowpack.json (and data/timeseries.json) into app/public/ so
// Vite serves them at /snowpack.json and /timeseries.json in dev and bundles
// them into dist/ at build time. (docs/PLAN.md tasks 6 + 9; task 11's
// deploy step does the same for the site.)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(appRoot, '../data');
const destDir = join(appRoot, 'public');

const snowpack = join(dataDir, 'snowpack.json');
if (!existsSync(snowpack)) {
  console.error(`snowpack.json not found at ${snowpack}`);
  console.error('Run `pnpm --filter @utahsnowpack/pipeline build:snowpack` first.');
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
cpSync(snowpack, join(destDir, 'snowpack.json'));
console.log(`copied ${snowpack} -> ${join(destDir, 'snowpack.json')}`);

// Time series is optional: without it the charts show an empty state, so a
// missing file warns rather than fails the build.
const timeseries = join(dataDir, 'timeseries.json');
if (existsSync(timeseries)) {
  cpSync(timeseries, join(destDir, 'timeseries.json'));
  console.log(`copied ${timeseries} -> ${join(destDir, 'timeseries.json')}`);
} else {
  console.warn(
    `timeseries.json not found at ${timeseries} — charts will show no history. ` +
      'Run `pnpm --filter @utahsnowpack/pipeline build:timeseries`.',
  );
}
