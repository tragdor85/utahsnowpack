/**
 * Build `data/snowpack.json` (docs/PLAN.md task 4).
 *
 * Reads the pinned fixtures (data/fixtures/ksl-*.html, wcc-ut-snotel-report-*.html)
 * and the site registry (data/sites.json), runs the normalizer, validates the
 * result against the schema, and writes data/snowpack.json (git-ignored;
 * task 5's CI job rebuilds and commits it daily).
 *
 * Usage: pnpm --filter @utahsnowpack/pipeline build:snowpack
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './registry.js';
import { normalize } from './normalize.js';
import { validateSnowpack } from './schema.js';
import { KSL_URL } from './fetch.js';
import { parseKslHtml } from './sources/ksl.js';
import { parseWccReport, WCC_REPORT_URL } from './sources/wcc.js';

const root = join(import.meta.dirname, '..', '..');
const fixtures = join(root, 'data', 'fixtures');

const kslPath = findFixture('ksl-*.html');
const wccPath = findFixture('wcc-ut-snotel-report-*.html');
if (!kslPath || !wccPath) {
  console.error('fatal: KSL and WCC report fixtures are required in data/fixtures (see fetch.ts)');
  process.exit(1);
}

const fetchedAt = new Date().toISOString();
const ksl = parseKslHtml(readFileSync(kslPath, 'utf8'), KSL_URL, fetchedAt);
const wcc = parseWccReport(readFileSync(wccPath, 'latin1'), WCC_REPORT_URL, fetchedAt);
const registry = loadRegistry();

const data = normalize(ksl, wcc, registry, { fetchedAt });
const errors = validateSnowpack(data);
if (errors.length > 0) {
  console.error(`fatal: snowpack.json failed validation:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const outPath = join(root, 'data', 'snowpack.json');
mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');

const reporting = data.basins.reduce((n, b) => n + b.sitesReporting, 0);
console.log(
  `wrote ${outPath}\n` +
    `  water year ${data.waterYear}, ${data.basins.length} basins, ${reporting} reported-today site entries\n` +
    data.basins
      .map(
        (b) =>
          `  ${b.id.padEnd(14)} ${String(b.swePctAvg ?? '—').padStart(4)}%  ${b.sitesReporting}/${b.sitesTotal} reporting`,
      )
      .join('\n'),
);
if (data.warnings.length > 0) {
  console.log(`  ${data.warnings.length} warning(s):`);
  for (const w of data.warnings) console.log(`    ! ${w}`);
}

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
