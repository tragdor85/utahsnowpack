import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadRegistry,
  normalizeStationName,
  type Baseline,
  type Registry,
  type RegistrySite,
} from '../src/registry.js';
import {
  kslStampToIso,
  normalize,
  parseElevation,
  parseMetric,
  reconstructKslRow,
  wccReportDateToIso,
  waterYearOf,
} from '../src/normalize.js';
import { validateSnowpack } from '../src/schema.js';
import { KSL_URL } from '../src/fetch.js';
import { parseKslHtml, type KslRow, type KslSnapshot } from '../src/sources/ksl.js';
import { parseWccReport, WCC_REPORT_URL, type WccSnapshot } from '../src/sources/wcc.js';

const FETCHED_AT = '2026-10-25T00:00:00.000Z';

const FIXTURES = fileURLToPath(new URL('../../data/fixtures', import.meta.url));
const KSL_FIXTURE = readFileSync(`${FIXTURES}/ksl-2026-10-24.html`, 'utf8');
const WCC_FIXTURE = readFileSync(`${FIXTURES}/wcc-ut-snotel-report-2026-10-24.html`, 'latin1');
const REGISTRY = loadRegistry();

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

describe('parseMetric', () => {
  it('parses plain numbers, including leading-dot decimals', () => {
    expect(parseMetric('.0')).toEqual({ value: 0, missing: false, invalid: false });
    expect(parseMetric('1.1')).toEqual({ value: 1.1, missing: false, invalid: false });
    expect(parseMetric('400')).toEqual({ value: 400, missing: false, invalid: false });
  });

  it('treats -M / M / N-A / empty as missing', () => {
    expect(parseMetric('-M')).toEqual({ value: null, missing: true, invalid: false });
    expect(parseMetric('M')).toEqual({ value: null, missing: true, invalid: false });
    expect(parseMetric('N/A')).toEqual({ value: null, missing: true, invalid: false });
    expect(parseMetric('')).toEqual({ value: null, missing: true, invalid: false });
  });

  it('treats * as invalid and keeps the number', () => {
    expect(parseMetric('*')).toEqual({ value: null, missing: false, invalid: true });
    expect(parseMetric('120*')).toEqual({ value: 120, missing: false, invalid: true });
  });

  it('accepts the WCC year-count suffix "1.0 (10)"', () => {
    expect(parseMetric('0.0(10)')).toEqual({ value: 0, missing: false, invalid: false });
    expect(parseMetric('12.4(10)')).toEqual({ value: 12.4, missing: false, invalid: false });
    expect(parseMetric('0*')).toEqual({ value: 0, missing: false, invalid: true });
  });
});

describe('parseElevation', () => {
  it('parses integer feet and rejects metric values', () => {
    expect(parseElevation('9360')).toBe(9360);
    expect(parseElevation('.7')).toBeNull();
    expect(parseElevation('GS')).toBeNull();
    expect(parseElevation('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KSL row reconstruction (the two display quirks)
// ---------------------------------------------------------------------------

const row = (
  site: string,
  elev: string,
  swe: string,
  sweAvg: string,
  swePct: string,
  precip: string,
  precipAvg: string,
  precipPct: string,
): KslRow => ({ site, elev, swe, sweAvg, swePct, precip, precipAvg, precipPct });

describe('reconstructKslRow', () => {
  it('leaves normal rows untouched', () => {
    const rec = reconstructKslRow(row('Tony Grove RS', '6320', '.0', '.0', '*', '.1', '.2', '*'));
    expect(rec.kind).toBe('normal');
    expect(rec.name).toBe('Tony Grove RS');
    expect(rec.elevationFt).toBe(6320);
    expect(rec.swe).toEqual({ value: 0, missing: false, invalid: false });
    expect(rec.swePct.invalid).toBe(true);
    expect(rec.precip.value).toBe(0.1);
    expect(rec.anomaly).toBeUndefined();
  });

  it('reconstructs the flag-shift row (Chepeta, as captured): SWE + elev dropped, flag on name', () => {
    const rec = reconstructKslRow(row('Chepeta  M', '.7', '*', '6.4', '1.6', '400', '', ''));
    expect(rec.kind).toBe('flag-shift');
    expect(rec.name).toBe('Chepeta');
    expect(rec.elevationFt).toBeNull();
    expect(rec.swe).toEqual({ value: null, missing: true, invalid: false });
    expect(rec.sweAvg.value).toBe(0.7);
    expect(rec.swePct.invalid).toBe(true);
    expect(rec.precip.value).toBe(6.4);
    expect(rec.precipAvg.value).toBe(1.6);
    expect(rec.precipPct.value).toBe(400);
    expect(rec.anomaly).toBeUndefined(); // k=2 is the verified shape
  });

  it('reconstructs the name-overflow row (EF Blacks Fork, as captured): name tail in elev cell', () => {
    const rec = reconstructKslRow(
      row('EF Blacks Fork', 'GS', '9360', '.0', '.0', '*', '1.7', '1.4'),
    );
    expect(rec.kind).toBe('name-overflow');
    expect(rec.name).toBe('EF Blacks Fork GS');
    expect(rec.elevationFt).toBe(9360);
    expect(rec.swe.value).toBe(0);
    expect(rec.sweAvg.value).toBe(0);
    expect(rec.swePct.invalid).toBe(true);
    expect(rec.precip.value).toBe(1.7);
    expect(rec.precipAvg.value).toBe(1.4);
    expect(rec.precipPct.missing).toBe(true); // dropped cell
    expect(rec.anomaly).toBeUndefined();
  });

  it('keeps a flagged-but-unshifted row normal and flags it for review', () => {
    const rec = reconstructKslRow(row('Foo M', '8000', '-M', '.5', '*', '1', '2', '3'));
    expect(rec.kind).toBe('normal');
    expect(rec.swe).toEqual({ value: null, missing: true, invalid: false });
    expect(rec.elevationFt).toBe(8000);
    expect(rec.anomaly).toMatch(/marker/);
  });
});

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

describe('kslStampToIso', () => {
  it('anchors the Mountain-Time wall clock to America/Denver (MDT in October)', () => {
    expect(kslStampToIso('10:10am Sat 24 October 2026')).toBe('2026-10-24T16:10:00.000Z');
  });

  it('uses MST (UTC-7) outside DST', () => {
    expect(kslStampToIso('8:00am Sun 1 January 2027')).toBe('2027-01-01T15:00:00.000Z');
  });

  it('returns null for unparseable stamps', () => {
    expect(kslStampToIso('garbage')).toBeNull();
  });
});

describe('wccReportDateToIso / waterYearOf', () => {
  it('parses the WCC report date', () => {
    expect(wccReportDateToIso('Saturday, October 24, 2026')).toBe('2026-10-24');
    expect(wccReportDateToIso('nope')).toBeNull();
  });

  it('computes the water year (WY N runs Oct 1 of N-1 to Sep 30 of N)', () => {
    expect(waterYearOf('2026-10-24')).toBe(2027);
    expect(waterYearOf('2027-03-01')).toBe(2027);
    expect(waterYearOf('2026-09-30')).toBe(2026);
    expect(waterYearOf(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full fixture integration
// ---------------------------------------------------------------------------

describe('normalize (2026-10-24 fixtures)', () => {
  const data = normalize(
    parseKslHtml(KSL_FIXTURE, KSL_URL, FETCHED_AT),
    parseWccReport(WCC_FIXTURE, WCC_REPORT_URL, FETCHED_AT),
    REGISTRY,
    {
      fetchedAt: FETCHED_AT,
    },
  );

  it('passes schema validation with no warnings', () => {
    expect(validateSnowpack(data)).toEqual([]);
    expect(data.warnings).toEqual([]);
  });

  it('emits the canonical 8 basins with the baseline rollups and colors', () => {
    const expected: Record<string, { pct: number; color: string }> = {
      raft_river: { pct: 230, color: 'blue3' },
      bear_river: { pct: 84, color: 'yellow' },
      weber_ogden: { pct: 191, color: 'blue3' },
      provo_river: { pct: 220, color: 'blue3' },
      green_river: { pct: 40, color: 'red' },
      duchesne: { pct: 194, color: 'blue3' },
      sevier_river: { pct: 120, color: 'blue1' },
      beaver_river: { pct: 73, color: 'yellow' },
    };
    expect(data.basins.map((b) => b.id)).toEqual(Object.keys(expected));
    for (const basin of data.basins) {
      expect(basin.swePctAvg, basin.id).toBe(expected[basin.id].pct);
      expect(basin.colorBand, basin.id).toBe(expected[basin.id].color);
    }
  });

  it('reports the WCC reported-today counts and registry totals per basin', () => {
    const expected: Record<string, [number, number]> = {
      raft_river: [2, 2],
      bear_river: [26, 26],
      weber_ogden: [23, 23],
      provo_river: [26, 29],
      green_river: [13, 13],
      duchesne: [15, 41],
      sevier_river: [23, 36],
      beaver_river: [3, 21],
    };
    for (const basin of data.basins) {
      expect([basin.sitesReporting, basin.sitesTotal], basin.id).toEqual(expected[basin.id]);
    }
  });

  it('covers every registry station and dedupes multi-basin stations', () => {
    const entries = data.basins.reduce((n, b) => n + b.sites.length, 0);
    expect(entries).toBe(191); // registry membership sum
    const unique = new Set(data.basins.flatMap((b) => b.sites.map((s) => s.stationTriplet)));
    expect(unique.size).toBe(REGISTRY.sites.length); // 148
  });

  it('carries the water year and both source dates', () => {
    expect(data.waterYear).toBe(2027); // Oct 24 2026 is in WY2027 (Oct 2026 - Sep 2027)
    expect(data.lastUpdated.ksl).toBe('10:10am Sat 24 October 2026');
    expect(data.lastUpdated.kslDate).toBe('2026-10-24');
    expect(data.lastUpdated.wcc).toBe('Saturday, October 24, 2026');
    expect(data.lastUpdated.wccDate).toBe('2026-10-24');
    expect(data.fetchedAt).toBe(FETCHED_AT);
  });

  it('keeps the reconstructed names and flags for the two corrupt KSL rows', () => {
    const duchesne = data.basins.find((b) => b.id === 'duchesne')!;
    const chepeta = duchesne.sites.find((s) => s.name === 'Chepeta')!;
    expect(chepeta.reportedToday).toBe(true);
    expect(chepeta.sweIn).toBeNull(); // -M
    expect(chepeta.sweAvgIn).toBe(0.7);
    expect(chepeta.flags).toContain('swe-missing');
    const greens = data.basins.find((b) => b.id === 'green_river')!;
    const ef = greens.sites.find((s) => s.name === 'EF Blacks Fork GS')!;
    expect(ef.elevationFt).toBe(9360);
    expect(ef.sweIn).toBe(0);
    expect(ef.flags).toContain('swe-pct-invalid');
    expect(ef.flags).toContain('precip-pct-missing');
  });

  it('keeps KSL precipitation (absent from the WCC report)', () => {
    const tony = data.basins
      .find((b) => b.id === 'bear_river')!
      .sites.find((s) => s.name === 'Tony Grove RS')!;
    expect(tony.precipIn).not.toBeNull();
    expect(tony.precipAvgIn).not.toBeNull();
  });

  // Plan task 4 acceptance: parity against the captured KSL baseline for all
  // 8 basin % values and ≥95% of site values (tolerance 1 pt / 0.1 in).
  it('matches the captured KSL baseline (all 8 basin %, ≥95% of site values)', () => {
    const baseline = JSON.parse(
      readFileSync(`${FIXTURES}/../ksl-baseline-2026-10-24.json`, 'utf8'),
    ) as Baseline;
    let compared = 0;
    let passed = 0;
    const failures: string[] = [];
    const check = (label: string, got: number | null, want: number | null, tol: number) => {
      compared++;
      if (got === null && want === null) return passed++;
      if (got === null || want === null || Math.abs(got - want) > tol) {
        failures.push(`${label}: got ${String(got)}, want ${String(want)}`);
      } else {
        passed++;
      }
    };
    for (const bb of baseline.basins) {
      const basin = data.basins.find((b) => b.id === bb.id);
      if (!basin) {
        compared++;
        failures.push(`missing basin ${bb.id}`);
        continue;
      }
      check(
        `basin ${bb.id} pct`,
        basin.swePctAvg,
        bb.pct_avg !== undefined ? Number(bb.pct_avg) : null,
        1,
      );
      const byName = new Map(basin.sites.map((s) => [normalizeStationName(s.name), s]));
      for (const row of bb.sites) {
        const rec = reconstructKslRow({
          site: row.site,
          elev: row.elev_ft,
          swe: row.swe_in,
          sweAvg: row.swe_avg_in,
          swePct: row.swe_pct_avg,
          precip: row.precip_in,
          precipAvg: row.precip_avg_in,
          precipPct: row.precip_pct_avg,
        });
        const out = byName.get(normalizeStationName(rec.name));
        if (!out) {
          compared++;
          failures.push(`${bb.id}: no output site for "${row.site}"`);
          continue;
        }
        // The baseline stores KSL's cells verbatim — including the two
        // display-quirk rows still shifted — so reconstruct the baseline side
        // too. The reconstruction itself is verified independently (unit tests
        // against the WCC report, the normalizer's KSL/WCC cross-check, and
        // the basin rollup parity above).
        const label = `${bb.id} ${row.site}`;
        check(`${label} swe`, out.sweIn, rec.swe.value, 0.1);
        check(`${label} sweAvg`, out.sweAvgIn, rec.sweAvg.value, 0.1);
        check(`${label} swePct`, out.swePctAvg, rec.swePct.value, 1);
        check(`${label} precip`, out.precipIn, rec.precip.value, 0.1);
        check(`${label} precipAvg`, out.precipAvgIn, rec.precipAvg.value, 0.1);
        check(`${label} precipPct`, out.precipPctAvg, rec.precipPct.value, 1);
      }
    }
    const rate = passed / compared;
    expect(
      rate,
      `parity ${Math.round(rate * 100)}% — ${failures.slice(0, 10).join(' | ')}`,
    ).toBeGreaterThanOrEqual(0.95);
  });
});

// ---------------------------------------------------------------------------
// Synthetic edge cases
// ---------------------------------------------------------------------------

function site(
  id: string,
  name: string,
  basins: string[],
  over: Partial<RegistrySite> = {},
): RegistrySite {
  return {
    stationId: id,
    stateCode: 'UT',
    networkCode: 'SNTL',
    stationTriplet: `${id}:UT:SNTL`,
    name,
    kslName: name,
    elevationFt: 8000,
    latitude: 40,
    longitude: -111,
    basins,
    wccBasin: null,
    match: 'exact',
    ...over,
  };
}

const registry = (sites: RegistrySite[]): Registry =>
  ({
    generated: 't',
    sources: { roster: 'r', report: 'r', catalog: 'c' },
    sites,
    unmatched: [],
    ambiguous: [],
    warnings: [],
  }) as Registry;

const kslOf = (sections: { name: string; rows: KslRow[] }[]): KslSnapshot =>
  ({
    sourceUrl: 'synthetic',
    fetchedAt: '2026-10-25T00:00:00.000Z',
    lastUpdated: '10:10am Sat 24 October 2026',
    sections,
    rowCount: sections.reduce((n, s) => n + s.rows.length, 0),
  }) as KslSnapshot;

const wccOf = (
  groups: { name: string; rows: { site: string; swe: string; median: string }[] }[],
): WccSnapshot =>
  ({
    sourceUrl: 'synthetic',
    fetchedAt: '2026-10-25T00:00:00.000Z',
    reportDate: 'Saturday, October 24, 2026',
    groups: groups.map((g) => ({
      name: g.name,
      rows: g.rows.map((r) => ({
        site: r.site,
        elev: '8000',
        swe: r.swe,
        sweMedian: r.median,
        peakSwe: '10',
        peakDate: 'Apr 01',
        pctMedian: '*',
        pctPeak: '*',
      })),
    })),
    rowCount: groups.reduce((n, g) => n + g.rows.length, 0),
  }) as WccSnapshot;

describe('normalize (synthetic)', () => {
  it('excludes -M SWE stations from the rollup but counts them as reporting', () => {
    const data = normalize(
      kslOf([
        {
          name: 'DUCHESNE',
          rows: [
            row('Alpha', '8000', '-M', '10', '*', '1', '1', '1'),
            row('Beta', '8000', '5', '10', '50', '1', '1', '1'),
          ],
        },
      ]),
      wccOf([
        {
          name: 'DUCHESNE RIVER',
          rows: [
            { site: 'Alpha', swe: '-M', median: '10' },
            { site: 'Beta', swe: '5', median: '10' },
          ],
        },
      ]),
      registry([site('1', 'Alpha', ['duchesne']), site('2', 'Beta', ['duchesne'])]),
    );
    const basin = data.basins.find((b) => b.id === 'duchesne')!;
    expect(basin.sitesReporting).toBe(2);
    expect(basin.swePctAvg).toBe(50); // 100 * 5 / 10 — Alpha's -M excluded from both sums
  });

  it('marks stations absent from the WCC report as not reporting and excludes them', () => {
    const data = normalize(
      kslOf([
        {
          name: 'DUCHESNE',
          rows: [
            row('Alpha', '8000', '5', '10', '50', '1', '1', '1'),
            row('Beta', '8000', '5', '10', '50', '1', '1', '1'),
          ],
        },
      ]),
      wccOf([{ name: 'DUCHESNE RIVER', rows: [{ site: 'Alpha', swe: '5', median: '10' }] }]),
      registry([site('1', 'Alpha', ['duchesne']), site('2', 'Beta', ['duchesne'])]),
    );
    const basin = data.basins.find((b) => b.id === 'duchesne')!;
    const alpha = basin.sites.find((s) => s.name === 'Alpha')!;
    const beta = basin.sites.find((s) => s.name === 'Beta')!;
    expect(alpha.reportedToday).toBe(true);
    expect(beta.reportedToday).toBe(false);
    expect(basin.sitesReporting).toBe(1);
    expect(basin.swePctAvg).toBe(50);
  });

  it('emits a null rollup and null band when nothing reported', () => {
    const data = normalize(
      kslOf([{ name: 'RAFT RIVER', rows: [row('Alpha', '8000', '5', '10', '50', '1', '1', '1')] }]),
      wccOf([{ name: 'RAFT RIVER', rows: [] }]),
      registry([site('1', 'Alpha', ['raft_river'])]),
    );
    const basin = data.basins.find((b) => b.id === 'raft_river')!;
    expect(basin.swePctAvg).toBeNull();
    expect(basin.colorBand).toBe('none');
    expect(basin.sitesReporting).toBe(0);
  });

  it('warns when a WCC group is missing from the report', () => {
    const data = normalize(
      kslOf([{ name: 'RAFT RIVER', rows: [row('Alpha', '8000', '5', '10', '50', '1', '1', '1')] }]),
      wccOf([]), // no groups at all
      registry([site('1', 'Alpha', ['raft_river'])]),
    );
    expect(data.warnings.some((w) => w.includes('no "RAFT RIVER" group'))).toBe(true);
  });

  it('warns on a KSL row that matches no registry station', () => {
    const data = normalize(
      kslOf([
        { name: 'DUCHESNE', rows: [row('Ghost Station', '8000', '5', '10', '50', '1', '1', '1')] },
      ]),
      wccOf([{ name: 'DUCHESNE RIVER', rows: [] }]),
      registry([site('1', 'Alpha', ['duchesne'])]),
    );
    expect(data.warnings.some((w) => w.includes('Ghost Station'))).toBe(true);
    const basin = data.basins.find((b) => b.id === 'duchesne')!;
    expect(basin.sites.map((s) => s.name)).toEqual(['Alpha']);
  });

  it('keeps first occurrence and warns when a multi-basin station disagrees across sections', () => {
    const rowsA = [row('Trial Lake', '8000', '5', '10', '50', '1', '1', '1')];
    const rowsB = [row('Trial Lake', '8000', '9', '10', '90', '1', '1', '1')];
    const data = normalize(
      kslOf([
        { name: 'BEAR RIVER', rows: rowsA },
        { name: 'DUCHESNE', rows: rowsB },
      ]),
      wccOf([
        { name: 'BEAR RIVER', rows: [{ site: 'Trial Lake', swe: '5', median: '10' }] },
        { name: 'DUCHESNE RIVER', rows: [{ site: 'Trial Lake', swe: '9', median: '10' }] },
      ]),
      registry([site('828', 'Trial Lake', ['bear_river', 'duchesne'])]),
    );
    const bear = data.basins.find((b) => b.id === 'bear_river')!;
    const duchesne = data.basins.find((b) => b.id === 'duchesne')!;
    expect(bear.sites[0].sweIn).toBe(5); // first occurrence kept
    expect(duchesne.sites[0].sweIn).toBe(5); // shared, not 9
    expect(data.warnings.some((w) => w.includes('multiple KSL sections'))).toBe(true);
  });
});
