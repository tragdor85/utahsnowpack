/**
 * `pnpm fetch:all` — fetch all live sources and write date-stamped raw
 * captures to data/fixtures/ (the audit trail the daily pipeline commits —
 * docs/PLAN.md task 5).
 *
 *   KSL snowpack page   → data/fixtures/ksl-<YYYY-MM-DD>.html
 *   WCC SNOTEL report   → data/fixtures/wcc-ut-snotel-report-<YYYY-MM-DD>.html
 *   WCC station catalog → data/fixtures/wcc-ut-stations-<YYYY-MM-DD>.json
 *   AWDB daily series   → data/fixtures/awdb-series-<YYYY-MM-DD>.json
 *
 * The KSL page and the WCC report are REQUIRED: if either is unreachable or
 * unrecognizable the run fails loudly (non-zero exit, nothing written) so
 * the daily workflow never commits unparseable data. The station catalog and
 * the AWDB series are best-effort — they feed registry refreshes and the
 * time series chart, so a failure there warns but does not block the
 * snowpack build.
 *
 * Usage:
 *   pnpm fetch:all [capture-date]
 *
 * `capture-date` (YYYY-MM-DD) labels the capture files; default is today (UTC).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { KSL_URL, fetchKslHtml, guardKsl } from './fetch.js';
import { coverageReport } from './coverage.js';
import {
  WCC_REPORT_URL,
  fetchWccReport,
  fetchWccStations,
  parseWccReport,
  type WccSnapshot,
  type WccStation,
} from './sources/wcc.js';
import { parseKslHtml, type KslSnapshot } from './sources/ksl.js';
import {
  fetchAwdbSeries,
  waterYearOf,
  waterYearStart,
  type AwdbSeriesEntry,
} from './sources/awdb.js';
import { loadRegistry } from './registry.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Structural guards for a WCC report snapshot. Errors mean "unrecognizable
 * page"; warnings mean "suspicious but usable".
 */
export function guardWccReport(snapshot: WccSnapshot): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!snapshot.reportDate)
    errors.push('no report date found — WCC report layout may have changed');
  if (snapshot.rowCount === 0)
    errors.push('no site rows parsed — WCC report layout may have changed');
  if (snapshot.rowCount > 0 && (snapshot.rowCount < 150 || snapshot.rowCount > 300)) {
    warnings.push(`unexpected WCC row count ${snapshot.rowCount} (expected ~200)`);
  }
  return { warnings, errors };
}

export interface FetchAllOptions {
  /** Capture directory. Default: <repo>/data/fixtures. */
  outDir?: string;
  /** Capture date (YYYY-MM-DD) used in the file names. Default: today (UTC). */
  date?: string;
  /** Injectable for tests; defaults to the live fetchers. */
  fetchKslHtml?: () => Promise<string>;
  fetchWccReportHtml?: () => Promise<string>;
  fetchWccStations?: (names: string[]) => Promise<WccStation[]>;
  fetchAwdbSeries?: (
    triplets: string[],
    beginDate: string,
    endDate: string,
  ) => Promise<AwdbSeriesEntry[]>;
}

export interface FetchAllResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
  /** Captures actually written (empty when ok is false). */
  files: string[];
  ksl: KslSnapshot | null;
  wcc: WccSnapshot | null;
  awdb: AwdbSeriesEntry[] | null;
}

export async function runFetchAll(opts: FetchAllOptions = {}): Promise<FetchAllResult> {
  const outDir = opts.outDir ?? resolvePath(REPO_ROOT, 'data', 'fixtures');
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Fetch everything first; only write once all required sources parsed.
  let kslHtml: string | undefined;
  try {
    kslHtml = await (opts.fetchKslHtml ?? fetchKslHtml)();
  } catch (err) {
    errors.push(`KSL fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let wccHtml: string | undefined;
  try {
    wccHtml = await (opts.fetchWccReportHtml ?? fetchWccReport)();
  } catch (err) {
    errors.push(`WCC report fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Best-effort catalog: names come from the pinned registry.
  let stations: WccStation[] | null = null;
  try {
    const registry = loadRegistry();
    const names = registry.sites.map((s) => s.name);
    stations = await (opts.fetchWccStations ?? fetchWccStations)(names);
    const got = new Set(stations.map((s) => s.name));
    const missing = names.filter((n) => !got.has(n));
    if (missing.length > 0) {
      warnings.push(
        `WCC station catalog missing ${missing.length} registry station(s): ` +
          `${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
      );
    }
  } catch (err) {
    warnings.push(
      `WCC station catalog fetch failed (skipping catalog capture): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Best-effort daily series for the current water year (task 9): the charts
  // degrade to "no history" if this fails, so it never blocks the capture.
  let awdb: AwdbSeriesEntry[] | null = null;
  try {
    const registry = loadRegistry();
    const triplets = registry.sites.map((s) => s.stationTriplet);
    awdb = await (opts.fetchAwdbSeries ?? fetchAwdbSeries)(
      triplets,
      waterYearStart(waterYearOf(date)),
      date,
    );
  } catch (err) {
    warnings.push(
      `AWDB series fetch failed (skipping time series): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Parse + guard the required sources.
  let ksl: KslSnapshot | null = null;
  if (kslHtml !== undefined) {
    try {
      ksl = parseKslHtml(kslHtml, KSL_URL, fetchedAt);
    } catch (err) {
      errors.push(`KSL parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (ksl) {
    const g = guardKsl(ksl);
    warnings.push(...g.warnings);
    errors.push(...g.errors);
    const cov = coverageReport(ksl);
    if (cov.pct < 95) {
      errors.push(
        `KSL roster coverage ${cov.pct.toFixed(1)}% is below the 95% gate ` +
          `(missing ${cov.missing.length}: ${cov.missing.slice(0, 10).join(', ')}${cov.missing.length > 10 ? '…' : ''})`,
      );
    }
  }

  let wcc: WccSnapshot | null = null;
  if (wccHtml !== undefined) {
    try {
      wcc = parseWccReport(wccHtml, WCC_REPORT_URL, fetchedAt);
    } catch (err) {
      errors.push(`WCC parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (wcc) {
    const g = guardWccReport(wcc);
    warnings.push(...g.warnings);
    errors.push(...g.errors);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    console.error('fetch:all FAILED — nothing written');
    return { ok: false, warnings, errors, files: [], ksl, wcc, awdb: null };
  }

  // 3. Write the captures.
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  const kslPath = resolvePath(outDir, `ksl-${date}.html`);
  writeFileSync(kslPath, kslHtml!);
  files.push(kslPath);
  const wccPath = resolvePath(outDir, `wcc-ut-snotel-report-${date}.html`);
  writeFileSync(wccPath, wccHtml!);
  files.push(wccPath);
  if (stations) {
    const catPath = resolvePath(outDir, `wcc-ut-stations-${date}.json`);
    writeFileSync(catPath, JSON.stringify(stations, null, 2) + '\n');
    files.push(catPath);
  }
  if (awdb) {
    if (awdb.length > 0) {
      const seriesPath = resolvePath(outDir, `awdb-series-${date}.json`);
      writeFileSync(seriesPath, JSON.stringify(awdb, null, 2) + '\n');
      files.push(seriesPath);
    } else {
      warnings.push('AWDB series returned no data (skipping capture)');
    }
  }

  console.log(`capture date:  ${date}`);
  console.log(`ksl:           ${ksl!.rowCount} rows (last updated ${ksl!.lastUpdated ?? '?'})`);
  console.log(`wcc report:    ${wcc!.rowCount} rows (${wcc!.reportDate})`);
  console.log(`wcc stations:  ${stations ? `${stations.length} catalog entries` : 'skipped'}`);
  console.log(`awdb series:   ${awdb ? `${awdb.length} station entries` : 'skipped'}`);
  for (const f of files) console.log(`wrote:         ${f}`);
  for (const w of warnings) console.warn(`warn: ${w}`);
  console.log('fetch:all OK');
  return { ok: true, warnings, errors, files, ksl: ksl!, wcc: wcc!, awdb };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const result = await runFetchAll({ date: argv[0] });
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('ERROR:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
