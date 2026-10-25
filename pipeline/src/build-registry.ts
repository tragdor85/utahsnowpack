/**
 * `pnpm build:registry` — docs/PLAN.md task 3: build `data/sites.json`,
 * the pinned site registry (KSL baseline sites → WCC station metadata).
 *
 * Usage:
 *   pnpm build:registry                 # live: WCC report + station catalog
 *   pnpm build:registry --fixture <dir> # offline from committed fixtures
 *
 * The committed `data/sites.json` is a pinned mapping (risk R2): re-running
 * the build against the committed fixtures must reproduce it byte-for-byte
 * (except `generated`), and live drift surfaces as review entries.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  fetchWccReport,
  fetchWccStations,
  parseWccReport,
  WCC_REPORT_URL,
  type WccStation,
} from './sources/wcc.js';
import {
  buildRegistry,
  kslStationName,
  mapCheck,
  normalizeStationName,
  type Baseline,
} from './registry.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASELINE_PATH = fileURLToPath(
  new URL('../../data/ksl-baseline-2026-10-24.json', import.meta.url),
);
const SITES_PATH = fileURLToPath(new URL('../../data/sites.json', import.meta.url));

export function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

/**
 * Live catalog fetch: the report's station names, plus a first-token wildcard
 * probe for any baseline name the exact query missed (the catalog stores
 * "Smith  Morehouse" with a double space, which exact name matching skips).
 */
export async function fetchCatalog(
  baseline: Baseline,
  reportNames: string[],
): Promise<WccStation[]> {
  const stations = await fetchWccStations(reportNames);
  const have = new Set(stations.map((s) => normalizeStationName(s.name)));
  const probes = new Set<string>();
  for (const basin of baseline.basins) {
    for (const row of basin.sites) {
      const { name } = kslStationName(row);
      if (!have.has(normalizeStationName(name))) {
        probes.add(`${name.split(/\s+/)[0]}*`);
      }
    }
  }
  if (probes.size > 0) {
    const extra = await fetchWccStations([...probes]);
    const seen = new Set(stations.map((s) => s.stationTriplet));
    for (const s of extra) {
      if (!seen.has(s.stationTriplet)) {
        seen.add(s.stationTriplet);
        stations.push(s);
      }
    }
  }
  return stations;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const generated = new Date().toISOString();
  const baseline = loadBaseline();

  let report: ReturnType<typeof parseWccReport>;
  let catalog: WccStation[];
  let sources: { roster: string; report: string; catalog: string };

  const fixtureIdx = argv.indexOf('--fixture');
  const fixtureDir = fixtureIdx >= 0 ? argv[fixtureIdx + 1] : undefined;

  if (fixtureDir) {
    const dir = [resolve(process.cwd(), fixtureDir), resolve(REPO_ROOT, fixtureDir)].find((p) => {
      try {
        readFileSync(resolve(p, 'wcc-ut-snotel-report-2026-10-24.html'));
        readFileSync(resolve(p, 'wcc-ut-stations-2026-10-24.json'));
        return true;
      } catch {
        return false;
      }
    });
    if (!dir)
      throw new Error(`fixture dir not found: ${fixtureDir} (expected the two WCC fixture files)`);
    const reportHtml = readFileSync(resolve(dir, 'wcc-ut-snotel-report-2026-10-24.html'), 'latin1');
    catalog = JSON.parse(
      readFileSync(resolve(dir, 'wcc-ut-stations-2026-10-24.json'), 'utf8'),
    ) as WccStation[];
    report = parseWccReport(reportHtml, `fixture:${fixtureDir}`, generated);
    sources = {
      roster: 'data/ksl-baseline-2026-10-24.json',
      report: `data/fixtures/wcc-ut-snotel-report-2026-10-24.html`,
      catalog: `data/fixtures/wcc-ut-stations-2026-10-24.json`,
    };
  } else {
    const reportHtml = await fetchWccReport();
    report = parseWccReport(reportHtml, WCC_REPORT_URL, generated);
    const reportNames = report.groups.flatMap((g) => g.rows.map((r) => r.site));
    catalog = await fetchCatalog(baseline, reportNames);
    sources = {
      roster: 'data/ksl-baseline-2026-10-24.json',
      report: WCC_REPORT_URL,
      catalog: 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations',
    };
  }

  const registry = buildRegistry(baseline, catalog, report, { generated, sources });
  mkdirSync(resolve(SITES_PATH, '..'), { recursive: true });
  writeFileSync(SITES_PATH, JSON.stringify(registry, null, 2) + '\n');

  const rows = baseline.basins.reduce((n, b) => n + b.sites.length, 0);
  const resolved =
    rows -
    registry.unmatched.reduce((n, u) => n + u.basins.length, 0) -
    registry.ambiguous.reduce((n, a) => n + a.basins.length, 0);
  console.log(
    `baseline rows: ${rows}  unique stations: ${registry.sites.length}  resolved: ${resolved}`,
  );
  console.log(
    `unmatched: ${registry.unmatched.length}  ambiguous: ${registry.ambiguous.length}  warnings: ${registry.warnings.length}`,
  );
  for (const u of registry.unmatched)
    console.log(`  UNMATCHED ${u.kslName} (${u.basins.join(', ')})`);
  for (const a of registry.ambiguous)
    console.log(`  AMBIGUOUS ${a.kslName} -> ${a.candidates?.join(' | ')}`);
  for (const w of registry.warnings) console.warn(`  warn: ${w}`);
  const violations = mapCheck(registry);
  console.log(`map check: ${violations.length} violation(s)`);
  for (const v of violations) console.warn(`  ${v}`);
  console.log(`wrote: ${SITES_PATH}`);
  return violations.length > 0 || registry.unmatched.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('ERROR:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
