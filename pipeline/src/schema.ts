/**
 * The canonical `data/snowpack.json` contract (docs/PLAN.md task 4).
 *
 * This is the stable seam between the data pipeline and the UI: the
 * normalizer emits it, the app consumes it, and swapping data sources never
 * touches either side. All values are numbers (or null when the source
 * flagged them missing/invalid); display strings are the UI's job.
 */

/**
 * KSL's legend bands (docs/data-sources.md): red < 50%, orange 50-69%,
 * yellow 70-89%, green 90-109%, blue1 110-129%, blue2 130-149%, blue3 ≥ 150%.
 * The legend prints "> 150%" but the bands are otherwise inclusive pairs, so
 * 150 itself lands in blue3. `none` = no data to color.
 */
export type ColorBand =
  'red' | 'orange' | 'yellow' | 'green' | 'blue1' | 'blue2' | 'blue3' | 'none';

export const COLOR_BANDS: readonly ColorBand[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue1',
  'blue2',
  'blue3',
  'none',
] as const;

export function colorBand(swePctAvg: number | null): ColorBand {
  if (swePctAvg === null) return 'none';
  if (swePctAvg < 50) return 'red';
  if (swePctAvg < 70) return 'orange';
  if (swePctAvg < 90) return 'yellow';
  if (swePctAvg < 110) return 'green';
  if (swePctAvg < 130) return 'blue1';
  if (swePctAvg < 150) return 'blue2';
  return 'blue3';
}

/** Per-metric data-quality flags, e.g. `swe-missing`, `precip-avg-invalid`. */
export type SiteFlag =
  | 'swe-missing'
  | 'swe-invalid'
  | 'swe-avg-missing'
  | 'swe-avg-invalid'
  | 'swe-pct-missing'
  | 'swe-pct-invalid'
  | 'precip-missing'
  | 'precip-invalid'
  | 'precip-avg-missing'
  | 'precip-avg-invalid'
  | 'precip-pct-missing'
  | 'precip-pct-invalid';

export interface SnowpackSite {
  stationId: string;
  stationTriplet: string;
  /** Catalog (WCC) station name. */
  name: string;
  elevationFt: number;
  latitude: number;
  longitude: number;
  /** True when the station has a reading in today's WCC report. */
  reportedToday: boolean;
  /** Snow water equivalent, inches (null = missing/invalid, see `flags`). */
  sweIn: number | null;
  /** Long-term (median) SWE for the same day, inches. */
  sweAvgIn: number | null;
  /** SWE as percent of the long-term average (null = not computable). */
  swePctAvg: number | null;
  /** Water-year (Oct 1 - Sep 30) precipitation, inches. */
  precipIn: number | null;
  /** Long-term water-year precipitation average, inches. */
  precipAvgIn: number | null;
  /** Water-year precipitation as percent of average. */
  precipPctAvg: number | null;
  flags: SiteFlag[];
}

export interface SnowpackBasin {
  /** Stable slug, e.g. `bear_river` (the canonical 8 KSL basins). */
  id: string;
  /** Display name as KSL prints it, e.g. `BEAR RIVER`. */
  name: string;
  /**
   * Basin SWE as percent of average, the same way KSL computes it:
   * 100 × Σ SWE ÷ Σ SWE-avg over the stations that reported today.
   * Null when no reporting station has both values.
   */
  swePctAvg: number | null;
  colorBand: ColorBand;
  /** Sites with a reading today. */
  sitesReporting: number;
  /** All roster sites in the basin. */
  sitesTotal: number;
  /** KSL table order (elevation), registry order for sites KSL omitted. */
  sites: SnowpackSite[];
}

export interface SnowpackData {
  schemaVersion: 1;
  source: {
    ksl: string;
    wcc: string;
  };
  /** When the pipeline fetched the sources (ISO 8601). */
  fetchedAt: string;
  lastUpdated: {
    /** KSL page stamp verbatim, e.g. "10:10am Sat 24 October 2026". */
    ksl: string | null;
    /** The stamp as a calendar date (America/Denver), e.g. "2026-10-24". */
    kslDate: string | null;
    /** WCC report date verbatim, e.g. "Saturday, October 24, 2026". */
    wcc: string | null;
    /** The report date as a calendar date, e.g. "2026-10-24". */
    wccDate: string | null;
  };
  /** Water year the precipitation totals belong to (Oct 1 - Sep 30). */
  waterYear: number | null;
  basins: SnowpackBasin[];
  /** Non-fatal anomalies found while normalizing (surfaced in the UI). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Runtime validation (the "schema test" half of task 4 acceptance)
// ---------------------------------------------------------------------------

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNumOrNull(v: unknown): v is number | null {
  return v === null || isNum(v);
}

const METRIC_KEYS = [
  'sweIn',
  'sweAvgIn',
  'swePctAvg',
  'precipIn',
  'precipAvgIn',
  'precipPctAvg',
] as const;

export function validateSnowpack(data: unknown): string[] {
  const errors: string[] = [];
  const d = data as Partial<SnowpackData> | null;
  if (d === null || typeof d !== 'object') return ['not an object'];
  if (d.schemaVersion !== 1) errors.push(`schemaVersion must be 1, got ${String(d.schemaVersion)}`);
  if (!d.source || !isStr(d.source.ksl) || !isStr(d.source.wcc))
    errors.push('source.ksl/wcc must be non-empty strings');
  if (!isStr(d.fetchedAt) || Number.isNaN(Date.parse(d.fetchedAt)))
    errors.push('fetchedAt must be an ISO timestamp');
  const lu = d.lastUpdated;
  if (!lu || typeof lu !== 'object') {
    errors.push('lastUpdated missing');
  } else {
    for (const k of ['ksl', 'kslDate', 'wcc', 'wccDate'] as const) {
      if (lu[k] !== null && !isStr(lu[k])) errors.push(`lastUpdated.${k} must be a string or null`);
    }
  }
  if (
    d.waterYear != null &&
    (!Number.isInteger(d.waterYear) || d.waterYear < 1950 || d.waterYear > 2100)
  ) {
    errors.push(`waterYear must be an integer year, got ${String(d.waterYear)}`);
  }
  if (!Array.isArray(d.basins) || d.basins.length === 0)
    errors.push('basins must be a non-empty array');
  if (!Array.isArray(d.warnings)) errors.push('warnings must be an array');

  const basinIds = new Set<string>();
  for (const [bi, b] of (d.basins ?? []).entries()) {
    const p = `basins[${bi}]`;
    if (!isStr(b.id) || !isStr(b.name)) errors.push(`${p}.id/.name must be non-empty strings`);
    if (isStr(b.id) && basinIds.has(b.id)) errors.push(`${p}.id "${b.id}" duplicated`);
    if (isStr(b.id)) basinIds.add(b.id);
    if (!isNumOrNull(b.swePctAvg)) errors.push(`${p}.swePctAvg must be a number or null`);
    if (!(COLOR_BANDS as readonly string[]).includes(b.colorBand))
      errors.push(`${p}.colorBand invalid: ${String(b.colorBand)}`);
    if (!isNum(b.sitesReporting) || !Number.isInteger(b.sitesReporting) || b.sitesReporting < 0)
      errors.push(`${p}.sitesReporting must be a non-negative integer`);
    if (!isNum(b.sitesTotal) || !Number.isInteger(b.sitesTotal) || b.sitesTotal < b.sitesReporting)
      errors.push(`${p}.sitesTotal must be an integer ≥ sitesReporting`);
    if (!Array.isArray(b.sites) || b.sites.length !== b.sitesTotal)
      errors.push(`${p}.sites must have sitesTotal entries`);
    if (
      isNumOrNull(b.swePctAvg) &&
      b.swePctAvg !== null &&
      b.colorBand !== colorBand(b.swePctAvg)
    ) {
      errors.push(`${p}.colorBand ${b.colorBand} does not match swePctAvg ${b.swePctAvg}`);
    }
    const triplets = new Set<string>();
    for (const [si, s] of (b.sites ?? []).entries()) {
      const sp = `${p}.sites[${si}]`;
      if (!isStr(s.stationId) || !isStr(s.stationTriplet))
        errors.push(`${sp}.stationId/.stationTriplet must be strings`);
      if (isStr(s.stationTriplet)) {
        if (triplets.has(s.stationTriplet))
          errors.push(`${sp}.stationTriplet ${s.stationTriplet} duplicated in basin`);
        triplets.add(s.stationTriplet);
      }
      if (!isStr(s.name)) errors.push(`${sp}.name must be a non-empty string`);
      if (!isNum(s.elevationFt) || s.elevationFt <= 0)
        errors.push(`${sp}.elevationFt must be a positive number`);
      if (!isNum(s.latitude) || !isNum(s.longitude))
        errors.push(`${sp}.latitude/longitude must be numbers`);
      if (typeof s.reportedToday !== 'boolean')
        errors.push(`${sp}.reportedToday must be a boolean`);
      for (const k of METRIC_KEYS) {
        if (!isNumOrNull(s[k])) errors.push(`${sp}.${k} must be a number or null`);
      }
      if (!Array.isArray(s.flags) || s.flags.some((f) => typeof f !== 'string'))
        errors.push(`${sp}.flags must be an array of strings`);
    }
  }
  return errors;
}
