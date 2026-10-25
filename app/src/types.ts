/**
 * The `snowpack.json` contract as consumed by the UI (docs/PLAN.md task 6).
 *
 * Mirrors `pipeline/src/schema.ts`. The pipeline is the source of truth for
 * the contract; the two copies are deliberately separate workspaces and are
 * kept in sync by the schema tests on both sides (pipeline/test/schema.test.ts
 * validates the emitted file, app tests validate the shape here).
 */

/**
 * KSL's legend bands (docs/data-sources.md): red < 50%, orange 50-69%,
 * yellow 70-89%, green 90-109%, blue1 110-129%, blue2 130-149%, blue3 ≥ 150%.
 * `none` = no data to color.
 */
export type ColorBand =
  'red' | 'orange' | 'yellow' | 'green' | 'blue1' | 'blue2' | 'blue3' | 'none';

/**
 * KSL legend band labels. The colors live in the design tokens
 * (`--band-*` in styles.css, mirroring KSL's exact palette); components
 * apply them via `.band-chip--<band>` classes.
 */
export const COLOR_BAND_META: Record<ColorBand, { label: string }> = {
  red: { label: '< 50%' },
  orange: { label: '50-69%' },
  yellow: { label: '70-89%' },
  green: { label: '90-109%' },
  blue1: { label: '110-129%' },
  blue2: { label: '130-149%' },
  blue3: { label: '> 150%' },
  none: { label: 'no data' },
};

/** Same banding rule as the pipeline (rounding happens in the pipeline). */
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

/** Display a percent-of-average value, or an em dash when missing. */
export function formatPct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

/** Display an inch value, or an em dash when missing. */
export function formatInches(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}
