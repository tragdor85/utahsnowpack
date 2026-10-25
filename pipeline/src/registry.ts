/**
 * Site registry (docs/PLAN.md task 3): maps every KSL baseline site to its
 * WCC station (ID, lat/lon, elevation, network) by matching name + elevation
 * against the station catalog, with the WCC report as a cross-check.
 *
 * The output `data/sites.json` is a _pinned_ mapping: once committed it is
 * not auto-rematched (risk R2) — re-running the build must reproduce it from
 * the committed fixtures, and drift shows up as review entries.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WccRow, WccSnapshot, WccStation } from './sources/wcc.js';

export interface BaselineSite {
  site: string;
  elev_ft: string;
  /** Verbatim KSL cells — the two display-quirk rows are still shifted. */
  swe_in: string;
  swe_avg_in: string;
  swe_pct_avg: string;
  precip_in: string;
  precip_avg_in: string;
  precip_pct_avg: string;
}

export interface BaselineBasin {
  id: string;
  name: string;
  /** KSL's published basin rollup, e.g. "230" (parity-test reference). */
  pct_avg?: string;
  /** KSL legend color, e.g. "blue3" (parity-test reference). */
  color?: string;
  sites: BaselineSite[];
}

export interface Baseline {
  basins: BaselineBasin[];
}

export type MatchKind = 'exact' | 'variant';

export interface RegistrySite {
  stationId: string;
  stateCode: string;
  networkCode: string;
  stationTriplet: string;
  /** Catalog (WCC) station name. */
  name: string;
  /** Name as displayed on the KSL page (first occurrence). */
  kslName: string;
  /** Catalog elevation, feet (integer). */
  elevationFt: number;
  latitude: number;
  longitude: number;
  /** Canonical 8-basin membership, as grouped by the KSL baseline. */
  basins: string[];
  /** WCC report basin group for the station (cross-check), if present. */
  wccBasin: string | null;
  match: MatchKind;
}

export interface RegistryReview {
  kslName: string;
  basins: string[];
  /** Ambiguous only: stationTriplets of the tied candidates. */
  candidates?: string[];
}

export interface Registry {
  generated: string;
  sources: {
    roster: string;
    report: string;
    catalog: string;
  };
  sites: RegistrySite[];
  unmatched: RegistryReview[];
  ambiguous: RegistryReview[];
  warnings: string[];
}

/** Load the pinned site registry (`data/sites.json`). */
export function loadRegistry(
  path = join(import.meta.dirname, '..', '..', 'data', 'sites.json'),
): Registry {
  return JSON.parse(readFileSync(path, 'utf8')) as Registry;
}

/** Strip everything but alphanumerics, lowercase: the catalog-join key. */
export function normalizeStationName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reconstruct the station name from a KSL row, undoing KSL's display quirks:
 *
 * - A non-numeric "elev" cell that is alphabetic is actually the tail of the
 *   station name (KSL shifts cells left when the name overflows, e.g.
 *   "EF Blacks Fork" + "GS").
 * - KSL appends missing-data flags to the name cell ("Chepeta  M"); a
 *   trailing `M`/`-M`/`*` is stripped. (When the elev cell is a shifted
 *   _numeric_ value like ".7", the name keeps no suffix — only the flag.)
 */
export function kslStationName(row: Pick<BaselineSite, 'site' | 'elev_ft'>): {
  name: string;
  variant: boolean;
} {
  let name = row.site;
  let variant = false;
  if (!/^\d+$/.test(row.elev_ft)) {
    if (/^[\d.]+$/.test(row.elev_ft)) {
      // shifted numeric value: the name may carry a missing-data flag
      name = name.replace(/\s*[-*]?\s?[M*]\s*$/, '').trim();
    } else {
      // non-numeric text in the elev cell: it is the name's tail
      name = `${name} ${row.elev_ft}`.trim();
      variant = true;
    }
  } else {
    name = name.replace(/\s*[-*]?\s?[M*]\s*$/, '').trim();
  }
  if (name !== row.site) variant = true;
  return { name, variant };
}

export interface Resolution {
  station: WccStation | null;
  match: MatchKind | null;
  /** Tied candidates (when ambiguous). */
  candidates: WccStation[];
}

/**
 * Resolve a station name against the catalog. Preference order: active
 * station, SNOTEL network, elevation agreement (±10 ft). A unique top
 * scorer wins; ties are reported as ambiguous, never guessed.
 */
export function resolveStation(
  name: string,
  elevFt: number | null,
  catalog: WccStation[],
  match: MatchKind,
): Resolution {
  const key = normalizeStationName(name);
  const candidates = catalog.filter((s) => normalizeStationName(s.name) === key);
  if (candidates.length === 0) return { station: null, match: null, candidates: [] };
  const score = (s: WccStation): number => {
    let sc = 0;
    if ((s.endDate ?? '').startsWith('2100')) sc += 4;
    if (s.networkCode === 'SNTL') sc += 2;
    if (elevFt !== null && s.elevation !== undefined && Math.abs(s.elevation - elevFt) <= 10)
      sc += 1;
    return sc;
  };
  const best = Math.max(...candidates.map(score));
  const top = candidates.filter((s) => score(s) === best);
  if (top.length === 1) return { station: top[0], match, candidates };
  return { station: null, match: null, candidates: top };
}

export interface BuildOptions {
  generated: string; // ISO timestamp
  sources: Registry['sources'];
}

/**
 * Build the registry: one entry per unique station, `basins` listing every
 * canonical basin the KSL baseline places it in.
 */
export function buildRegistry(
  baseline: Baseline,
  catalog: WccStation[],
  report: WccSnapshot | null,
  opts: BuildOptions,
): Registry {
  const warnings: string[] = [];
  const sites = new Map<string, RegistrySite>();
  const unmatched: RegistryReview[] = [];
  const ambiguous: RegistryReview[] = [];

  // Report lookup for the cross-check: normalized catalog name -> row/group.
  const reportByName = new Map<string, { row: WccRow; group: string }>();
  if (report) {
    for (const group of report.groups) {
      for (const row of group.rows) {
        reportByName.set(normalizeStationName(row.site), { row, group: group.name });
      }
    }
  }

  for (const basin of baseline.basins) {
    for (const row of basin.sites) {
      const { name, variant } = kslStationName(row);
      const elevFt = /^\d+$/.test(row.elev_ft) ? Number(row.elev_ft) : null;
      const res = resolveStation(name, elevFt, catalog, variant ? 'variant' : 'exact');

      if (res.station === null) {
        const existing = (res.candidates.length > 0 ? ambiguous : unmatched).find(
          (r) => r.kslName === row.site,
        );
        if (existing) {
          if (!existing.basins.includes(basin.id)) existing.basins.push(basin.id);
        } else {
          const entry: RegistryReview = { kslName: row.site, basins: [basin.id] };
          if (res.candidates.length > 0) {
            entry.candidates = res.candidates.map((c) => c.stationTriplet);
            ambiguous.push(entry);
          } else {
            unmatched.push(entry);
          }
        }
        continue;
      }

      const st = res.station;
      let site = sites.get(st.stationTriplet);
      if (!site) {
        if (st.latitude === undefined || st.longitude === undefined || st.elevation === undefined) {
          warnings.push(
            `station ${st.stationTriplet} (${st.name}) is missing lat/lon/elevation in the catalog`,
          );
        }
        const ref = report ? reportByName.get(normalizeStationName(st.name)) : undefined;
        site = {
          stationId: st.stationId,
          stateCode: st.stateCode,
          networkCode: st.networkCode,
          stationTriplet: st.stationTriplet,
          name: st.name,
          kslName: row.site,
          elevationFt: Math.round(st.elevation ?? 0),
          latitude: st.latitude ?? 0,
          longitude: st.longitude ?? 0,
          basins: [],
          wccBasin: ref?.group ?? null,
          match: res.match ?? 'exact',
        };
        sites.set(st.stationTriplet, site);
        // Cross-check: the report's elevation must agree with the catalog's.
        if (ref) {
          const reportElev = Number(ref.row.elev);
          if (Number.isFinite(reportElev) && Math.abs(reportElev - site.elevationFt) > 10) {
            warnings.push(
              `elevation disagreement for ${st.stationTriplet}: report ${ref.row.elev} vs catalog ${site.elevationFt}`,
            );
          }
        }
      }
      if (!site.basins.includes(basin.id)) site.basins.push(basin.id);
    }
  }

  const ordered = [...sites.values()].sort(
    (a, b) =>
      a.basins[0].localeCompare(b.basins[0]) ||
      a.elevationFt - b.elevationFt ||
      a.name.localeCompare(b.name),
  );

  return {
    generated: opts.generated,
    sources: opts.sources,
    sites: ordered,
    unmatched,
    ambiguous,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Map check (task 3 acceptance: "coordinates plot within their basins")
// ---------------------------------------------------------------------------

export type Point = [number, number]; // [lat, lon]

/** Andrew's monotone-chain convex hull. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...new Set(points.map((p) => JSON.stringify(p)))].map((j) => JSON.parse(j) as Point);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const KM_PER_DEG = 111;

function pointDistanceKm(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * KM_PER_DEG;
}

function segmentDistanceKm(a: Point, b: Point, p: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return pointDistanceKm(a, p);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return pointDistanceKm([a[0] + t * dx, a[1] + t * dy], p);
}

/** Distance from a point to a (possibly degenerate) convex hull, in km. */
export function distanceToHullKm(hull: Point[], p: Point): number {
  if (hull.length === 0) return Number.POSITIVE_INFINITY;
  if (hull.length === 1) return pointDistanceKm(hull[0], p);
  if (hull.length === 2) return segmentDistanceKm(hull[0], hull[1], p);
  let inside = false;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % n];
    if (y1 > p[1] !== y2 > p[1]) {
      const xint = ((x2 - x1) * (p[1] - y1)) / (y2 - y1) + x1;
      if (p[0] < xint) inside = !inside;
    }
  }
  if (inside) return 0;
  return Math.min(...hull.map((h, i) => segmentDistanceKm(h, hull[(i + 1) % n], p)));
}

/**
 * Each site must lie within the convex hull of its basin's _other_ sites
 * (leave-one-out — a hull always contains its own input points, so checking
 * against the full hull would never catch a misplaced station; the extent
 * used for the tolerance is likewise leave-one-out). The tolerance scales
 * with the basin's extent because legitimate peripheral stations (the far
 * end of a long drainage) sit outside the hull of the others by up to ~70 km
 * in the real data (and a two-station basin has no interior at all), while a
 * mis-resolution to a far-away same-named station would land hundreds of km
 * away.
 */
export function mapCheck(registry: Registry, minToleranceKm = 75, extentFactor = 1.5): string[] {
  const basinSites = new Map<string, RegistrySite[]>();
  for (const site of registry.sites) {
    for (const basin of site.basins) {
      const arr = basinSites.get(basin) ?? [];
      arr.push(site);
      basinSites.set(basin, arr);
    }
  }
  const violations: string[] = [];
  for (const [basin, sites] of basinSites) {
    if (sites.length < 2) continue; // nothing to compare against
    sites.forEach((site, i) => {
      // Leave-one-out everywhere, including the extent: the checked site must
      // not influence the tolerance it is judged against.
      const others = sites.filter((_, j) => j !== i).map((s) => [s.latitude, s.longitude] as Point);
      const lats = others.map((p) => p[0]);
      const lons = others.map((p) => p[1]);
      const diagKm = Math.max(
        (Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG,
        (Math.max(...lons) - Math.min(...lons)) * KM_PER_DEG * 0.8,
      );
      const toleranceKm = Math.max(minToleranceKm, extentFactor * diagKm);
      const d = distanceToHullKm(convexHull(others), [site.latitude, site.longitude]);
      if (d > toleranceKm) {
        violations.push(
          `${site.name} (${site.stationTriplet}) is ${d.toFixed(0)} km outside the ${basin} hull of its other ${others.length} sites (tolerance ${toleranceKm.toFixed(0)} km)`,
        );
      }
    });
  }
  return violations;
}
