import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardWccReport, runFetchAll } from '../src/fetch-all.js';
import type { WccSnapshot, WccStation } from '../src/sources/wcc.js';
import type { AwdbSeriesEntry } from '../src/sources/awdb.js';

const FIXTURES = fileURLToPath(new URL('../../data/fixtures/', import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function baseSnapshot(over: Partial<WccSnapshot> = {}): WccSnapshot {
  return {
    sourceUrl: 'wcc',
    fetchedAt: '2026-10-24T16:00:00.000Z',
    reportDate: 'Saturday, October 24, 2026',
    groups: [{ name: 'BEAR RIVER', rows: [], basinIndex: null }],
    rowCount: 200,
    ...over,
  };
}

describe('guardWccReport', () => {
  it('flags a missing report date as an error', () => {
    const g = guardWccReport(baseSnapshot({ reportDate: null }));
    expect(g.errors.join(' ')).toMatch(/no report date/);
  });

  it('flags zero rows as an error', () => {
    const g = guardWccReport(baseSnapshot({ rowCount: 0 }));
    expect(g.errors.join(' ')).toMatch(/no site rows/);
  });

  it('warns on an implausible row count but does not fail', () => {
    const g = guardWccReport(baseSnapshot({ rowCount: 100 }));
    expect(g.errors).toEqual([]);
    expect(g.warnings.join(' ')).toMatch(/row count 100/);
  });

  it('passes a healthy report', () => {
    const g = guardWccReport(baseSnapshot());
    expect(g.errors).toEqual([]);
    expect(g.warnings).toEqual([]);
  });
});

describe('runFetchAll', () => {
  function tempOutDir(): string {
    return mkdtempSync(join(tmpdir(), 'fetch-all-'));
  }

  const fixtureFetchers = {
    fetchKslHtml: async () => fixture('ksl-2026-10-24.html'),
    fetchWccReportHtml: async () => fixture('wcc-ut-snotel-report-2026-10-24.html'),
    fetchWccStations: async (): Promise<WccStation[]> =>
      JSON.parse(fixture('wcc-ut-stations-2026-10-24.json')) as WccStation[],
    fetchAwdbSeries: async (): Promise<AwdbSeriesEntry[]> => [],
  };

  it('writes the three date-stamped captures and returns the snapshots', async () => {
    const outDir = tempOutDir();
    const result = await runFetchAll({ ...fixtureFetchers, outDir, date: '2026-10-24' });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    // Empty AWDB responses are skipped (with a warning), not written.
    expect(result.files.map((f) => f.split('/').pop()!)).toEqual([
      'ksl-2026-10-24.html',
      'wcc-ut-snotel-report-2026-10-24.html',
      'wcc-ut-stations-2026-10-24.json',
    ]);
    expect(result.warnings.join(' ')).toMatch(/AWDB series returned no data/);
    // The captures are byte-identical to the injected source.
    expect(readFileSync(join(outDir, 'ksl-2026-10-24.html'), 'utf8')).toBe(
      fixture('ksl-2026-10-24.html'),
    );
    expect(readFileSync(join(outDir, 'wcc-ut-snotel-report-2026-10-24.html'), 'utf8')).toBe(
      fixture('wcc-ut-snotel-report-2026-10-24.html'),
    );
    expect(result.ksl).not.toBeNull();
    expect(result.ksl!.rowCount).toBe(206);
    expect(result.wcc).not.toBeNull();
    expect(result.wcc!.rowCount).toBe(207);
  });

  it('writes nothing and fails when a required source fetch throws', async () => {
    const outDir = tempOutDir();
    const result = await runFetchAll({
      ...fixtureFetchers,
      outDir,
      date: '2026-10-24',
      fetchWccReportHtml: async () => {
        throw new Error('WCC responded 503');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/WCC report fetch failed/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('treats a station-catalog failure as a warning, not a failure', async () => {
    const outDir = tempOutDir();
    const result = await runFetchAll({
      ...fixtureFetchers,
      outDir,
      date: '2026-10-24',
      fetchWccStations: async () => {
        throw new Error('stations API down');
      },
    });
    expect(result.ok).toBe(true);
    expect(result.files.map((f) => f.split('/').pop()!)).toEqual([
      'ksl-2026-10-24.html',
      'wcc-ut-snotel-report-2026-10-24.html',
    ]);
    expect(result.warnings.join(' ')).toMatch(/catalog fetch failed/);
  });

  it('writes the AWDB series capture when the API returns data', async () => {
    const outDir = tempOutDir();
    const awdb: AwdbSeriesEntry[] = [
      {
        stationTriplet: '1113:UT:SNTL',
        data: [
          {
            stationElement: {
              elementCode: 'WTEQ',
              durationName: 'DAILY',
              beginDate: '2026-10-01',
              endDate: '2026-10-24',
            },
            values: [{ date: '2026-10-24', value: 0.0 }],
          },
        ],
      },
    ];
    const result = await runFetchAll({
      ...fixtureFetchers,
      outDir,
      date: '2026-10-24',
      fetchAwdbSeries: async () => awdb,
    });
    expect(result.ok).toBe(true);
    expect(result.files.map((f) => f.split('/').pop()!)).toContain('awdb-series-2026-10-24.json');
    expect(JSON.parse(readFileSync(join(outDir, 'awdb-series-2026-10-24.json'), 'utf8'))).toEqual(
      awdb,
    );
  });

  it('treats an AWDB failure as a warning, not a failure', async () => {
    const outDir = tempOutDir();
    const result = await runFetchAll({
      ...fixtureFetchers,
      outDir,
      date: '2026-10-24',
      fetchAwdbSeries: async () => {
        throw new Error('awdb api down');
      },
    });
    expect(result.ok).toBe(true);
    expect(result.files.map((f) => f.split('/').pop()!)).not.toContain(
      'awdb-series-2026-10-24.json',
    );
    expect(result.warnings.join(' ')).toMatch(/AWDB series fetch failed/);
  });

  it('warns when the catalog is missing registry stations', async () => {
    const outDir = tempOutDir();
    const result = await runFetchAll({
      ...fixtureFetchers,
      outDir,
      date: '2026-10-24',
      fetchWccStations: async () => [],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/missing 148 registry station/);
  });
});
