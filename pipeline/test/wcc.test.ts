import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWccReport, type WccStation } from '../src/sources/wcc.js';
import {
  buildRegistry,
  convexHull,
  distanceToHullKm,
  kslStationName,
  normalizeStationName,
  resolveStation,
  type Baseline,
} from '../src/registry.js';

const FIXTURES = fileURLToPath(new URL('../../data/fixtures', import.meta.url));
const reportHtml = readFileSync(`${FIXTURES}/wcc-ut-snotel-report-2026-10-24.html`, 'latin1');
const catalog = JSON.parse(
  readFileSync(`${FIXTURES}/wcc-ut-stations-2026-10-24.json`, 'utf8'),
) as WccStation[];
const baseline = JSON.parse(
  readFileSync(`${FIXTURES}/../ksl-baseline-2026-10-24.json`, 'utf8'),
) as Baseline;

describe('parseWccReport', () => {
  const report = parseWccReport(reportHtml, 'fixture', '2026-10-24T00:00:00.000Z');

  it('parses all 17 basin groups in page order', () => {
    expect(report.groups.map((g) => g.name)).toEqual([
      'RAFT RIVER',
      'BEAR RIVER',
      'WEBER-OGDEN RIVERS',
      'PROVO R.-UTAH LAKE-JORDAN R.',
      'TOOELE VALLEY-VERNON CREEK',
      'DEEP CREEK MOUNTAINS',
      'NORTHEASTERN UINTAHS',
      'DUCHESNE RIVER',
      'PRICE-SAN RAFAEL',
      'DIRTY DEVIL',
      'SOUTH EASTERN UTAH',
      'UPPER SEVIER RIVER',
      'SAN PITCH RIVER',
      'LOWER SEVIER RIVER',
      'BEAVER RIVER',
      'ESCALANTE RIVER',
      'SOUTHWESTERN UTAH',
    ]);
  });

  it('parses 207 rows / 149 unique stations with values', () => {
    const rows = report.groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(207);
    expect(new Set(rows.map((r) => normalizeStationName(r.site)))).toHaveLength(149);
    const tony = report.groups[1].rows.find((r) => r.site === 'Tony Grove RS');
    expect(tony).toEqual({
      site: 'Tony Grove RS',
      elev: '6320',
      swe: '0.0',
      sweMedian: '0.0 (11)',
      peakSwe: '11.7 (11)',
      peakDate: 'Mar 09 (11)',
      pctMedian: '*',
      pctPeak: '0 *',
    });
  });

  it('carries the report timestamp', () => {
    expect(report.fetchedAt).toBe('2026-10-24T00:00:00.000Z');
  });

  it('parses the basin index rows', () => {
    expect(report.groups[0].basinIndex).toBe('230 *'); // RAFT RIVER
    expect(report.groups[1].basinIndex).toBe('84 *'); // BEAR RIVER
    const withIndex = report.groups.filter((g) => g.basinIndex !== null);
    expect(withIndex).toHaveLength(report.groups.length); // every group has one
  });
});

describe('kslStationName', () => {
  it('passes through clean rows', () => {
    expect(kslStationName({ site: 'Tony Grove RS', elev_ft: '6320' })).toEqual({
      name: 'Tony Grove RS',
      variant: false,
    });
  });

  it('appends a non-numeric elev cell as the name tail (cell shift)', () => {
    expect(kslStationName({ site: 'EF Blacks Fork', elev_ft: 'GS' })).toEqual({
      name: 'EF Blacks Fork GS',
      variant: true,
    });
  });

  it('strips missing-data flags from the name', () => {
    expect(kslStationName({ site: 'Chepeta M', elev_ft: '.7' })).toEqual({
      name: 'Chepeta',
      variant: true,
    });
    expect(kslStationName({ site: 'Chepeta -M', elev_ft: '7000' })).toEqual({
      name: 'Chepeta',
      variant: true,
    });
  });
});

describe('resolveStation', () => {
  it('resolves an exact name', () => {
    const res = resolveStation('Tony Grove RS', 6320, catalog, 'exact');
    expect(res.station?.stationId).toBe('1113');
    expect(res.match).toBe('exact');
  });

  it('prefers the active SNTL station of a same-named set', () => {
    const res = resolveStation('Chepeta', 7000, catalog, 'variant');
    expect(res.station?.stationTriplet).toBe('396:UT:SNTL');
    expect(res.candidates).toHaveLength(3);
  });

  it('reports ties as ambiguous instead of guessing', () => {
    // two active SNTL Chepeta stations at the same elevation would tie;
    // simulate by forcing equal elevations
    const tied = catalog
      .filter((s) => normalizeStationName(s.name) === 'chepeta')
      .map((s) => ({
        ...s,
        elevation: 7000,
        endDate: '2100-01-01',
        networkCode: 'SNTL',
      }));
    const res = resolveStation('Chepeta', 7000, tied, 'exact');
    expect(res.station).toBeNull();
    expect(res.candidates).toHaveLength(3);
  });

  it('returns no candidates for unknown names', () => {
    const res = resolveStation('No Such Station', 5000, catalog, 'exact');
    expect(res.station).toBeNull();
    expect(res.candidates).toHaveLength(0);
  });
});

describe('convex hull / map check geometry', () => {
  it('computes a hull and classifies inside/outside', () => {
    const hull = convexHull([
      [40, -110],
      [40, -108],
      [42, -108],
      [42, -110],
      [41, -109], // interior point
    ]);
    expect(hull).toHaveLength(4);
    expect(distanceToHullKm(hull, [41, -109])).toBe(0);
    expect(distanceToHullKm(hull, [45, -109])).toBeGreaterThan(25);
  });

  it('handles degenerate hulls', () => {
    expect(distanceToHullKm([], [41, -109])).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToHullKm([[41, -109]], [41.1, -109])).toBeGreaterThan(10);
    expect(
      distanceToHullKm(
        [
          [41, -109],
          [41, -110],
        ],
        [41, -109.5],
      ),
    ).toBe(0);
  });
});

describe('buildRegistry (full fixture)', () => {
  const report = parseWccReport(reportHtml, 'fixture', '2026-10-24T00:00:00.000Z');
  const registry = buildRegistry(baseline, catalog, report, {
    generated: '2026-10-24T00:00:00.000Z',
    sources: { roster: 'x', report: 'y', catalog: 'z' },
  });

  it('resolves every baseline row to a station', () => {
    expect(registry.unmatched).toHaveLength(0);
    expect(registry.ambiguous).toHaveLength(0);
    expect(registry.warnings).toHaveLength(0);
  });

  it('produces 148 unique stations covering all 191 unique (site, basin) pairs', () => {
    expect(registry.sites).toHaveLength(148);
    const pairs = new Set(
      registry.sites.flatMap((s) => s.basins.map((b) => `${normalizeStationName(s.name)}:${b}`)),
    );
    const baselinePairs = new Set(
      baseline.basins.flatMap((b) =>
        b.sites.map((s) => {
          const { name } = kslStationName(s);
          return `${normalizeStationName(name)}:${b.id}`;
        }),
      ),
    );
    expect(pairs.size).toBe(191);
    expect(pairs).toEqual(baselinePairs);
  });

  it('flags the two KSL cell-shift rows as variant matches', () => {
    const variants = registry.sites.filter((s) => s.match === 'variant');
    expect(variants.map((s) => s.stationTriplet)).toEqual(
      expect.arrayContaining(['1163:UT:SNTL', '396:UT:SNTL']),
    );
    expect(variants).toHaveLength(2);
  });

  it('cross-checks every site against the WCC report basin group', () => {
    const withReport = registry.sites.filter((s) => s.wccBasin !== null);
    expect(withReport).toHaveLength(registry.sites.length); // all 148 appear in the report
    for (const site of withReport) {
      const inGroup = report.groups.find((g) => g.name === site.wccBasin);
      expect(
        inGroup?.rows.some((r) => normalizeStationName(r.site) === normalizeStationName(site.name)),
      ).toBe(true);
    }
  });
});
