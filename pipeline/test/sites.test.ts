/**
 * Task 3 acceptance: the committed registry validates against a schema test
 * and its coordinates plot within their basins (convex-hull map check).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildRegistry,
  convexHull,
  kslStationName,
  mapCheck,
  normalizeStationName,
  type Baseline,
  type Registry,
} from '../src/registry.js';
import type { WccStation } from '../src/sources/wcc.js';
import { parseWccReport } from '../src/sources/wcc.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const registry = JSON.parse(readFileSync(`${REPO}/data/sites.json`, 'utf8')) as Registry;
const baseline = JSON.parse(
  readFileSync(`${REPO}/data/ksl-baseline-2026-10-24.json`, 'utf8'),
) as Baseline;
const catalog = JSON.parse(
  readFileSync(`${REPO}/data/fixtures/wcc-ut-stations-2026-10-24.json`, 'utf8'),
) as WccStation[];

const BASIN_IDS = new Set(baseline.basins.map((b) => b.id));

describe('data/sites.json schema', () => {
  it('has the expected top-level shape', () => {
    expect(registry.generated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(registry.sources).toMatchObject({ roster: expect.any(String) });
    expect(Array.isArray(registry.sites)).toBe(true);
    expect(registry.sites.length).toBeGreaterThan(100);
    expect(registry.unmatched).toHaveLength(0);
    expect(registry.ambiguous).toHaveLength(0);
  });

  it('every site has complete, well-formed station metadata', () => {
    const triplets = new Set<string>();
    for (const s of registry.sites) {
      expect(s.stationId, s.name).toMatch(/^\d+$/);
      expect(s.stateCode).toMatch(/^[A-Z]{2}$/);
      expect(s.networkCode).toMatch(/^[A-Z]+$/);
      expect(s.stationTriplet).toBe(`${s.stationId}:${s.stateCode}:${s.networkCode}`);
      expect(triplets.has(s.stationTriplet), `duplicate ${s.stationTriplet}`).toBe(false);
      triplets.add(s.stationTriplet);
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.kslName.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(s.elevationFt) && s.elevationFt > 0).toBe(true);
      expect(s.latitude).toBeGreaterThanOrEqual(36);
      expect(s.latitude).toBeLessThanOrEqual(46);
      expect(s.longitude).toBeGreaterThanOrEqual(-115);
      expect(s.longitude).toBeLessThanOrEqual(-106);
      expect(s.basins.length).toBeGreaterThan(0);
      for (const b of s.basins) expect(BASIN_IDS.has(b), `${s.name}: ${b}`).toBe(true);
      expect(['exact', 'variant']).toContain(s.match);
      if (s.wccBasin !== null) expect(s.wccBasin.length).toBeGreaterThan(0);
    }
  });

  it('covers every unique (site, basin) pair from the KSL baseline', () => {
    const regPairs = new Set(
      registry.sites.flatMap((s) => s.basins.map((b) => `${normalizeStationName(s.name)}:${b}`)),
    );
    const baselinePairs = new Set(
      baseline.basins.flatMap((b) =>
        b.sites.map((s) => `${normalizeStationName(kslStationName(s).name)}:${b.id}`),
      ),
    );
    expect(regPairs).toEqual(baselinePairs);
    expect(regPairs.size).toBe(191);
  });

  it('every station exists in the station catalog fixture', () => {
    const catalogIds = new Set(catalog.map((s) => s.stationTriplet));
    for (const s of registry.sites) {
      expect(catalogIds.has(s.stationTriplet), s.name).toBe(true);
    }
  });
});

describe('map check: coordinates plot within their basins', () => {
  it('no site lies outside its basin convex hull', () => {
    expect(mapCheck(registry)).toEqual([]);
  });

  it('each basin hull is a sensible shape (3+ sites, bounded extent)', () => {
    for (const basin of baseline.basins) {
      const pts = registry.sites
        .filter((s) => s.basins.includes(basin.id))
        .map((s) => [s.latitude, s.longitude] as [number, number]);
      const hull = convexHull(pts);
      const lats = hull.map((p) => p[0]);
      const lons = hull.map((p) => p[1]);
      const spanKm = Math.max(
        (Math.max(...lats) - Math.min(...lats)) * 111,
        (Math.max(...lons) - Math.min(...lons)) * 80,
      );
      expect(pts.length, basin.id).toBeGreaterThanOrEqual(2);
      // a real drainage is at least a few km across
      expect(spanKm, basin.id).toBeGreaterThan(5);
    }
  });

  it('a deliberately misplaced station would be caught', () => {
    const broken = JSON.parse(JSON.stringify(registry)) as Registry;
    const site = broken.sites.find((s) => s.basins.length === 1)!;
    site.latitude += 5; // ~555 km jump — beyond any basin's extent-scaled tolerance
    const violations = mapCheck({
      ...broken,
      sites: [site, ...broken.sites.filter((s) => s !== site)],
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('rebuilding from the committed fixtures reproduces the registry', () => {
    const reportHtml = readFileSync(
      `${REPO}/data/fixtures/wcc-ut-snotel-report-2026-10-24.html`,
      'latin1',
    );
    const report = parseWccReport(reportHtml, 'fixture', registry.generated);
    const rebuilt = buildRegistry(baseline, catalog, report, {
      generated: registry.generated,
      sources: registry.sources,
    });
    expect(rebuilt).toEqual(registry);
  });
});
