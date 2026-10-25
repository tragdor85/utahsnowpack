/**
 * WCC AWDB REST API — daily time series for SNOTEL stations
 * (docs/data-sources.md, docs/PLAN.md task 9).
 *
 * `GET /awdbRestApi/services/v1/data?stationTriplets=…&elements=WTEQ,PREC&duration=DAILY&beginDate=…&endDate=…`
 *
 * Discovered 2026-10-25 via the API's OpenAPI spec
 * (`/awdbRestApi/v3/api-docs`). One batched request returns, per station,
 * per element, an array of `{ date, value }` (daily) or
 * `{ month, year, value }` (monthly) rows. Values are inches; missing days
 * are simply absent (not null) in the raw response.
 *
 * Cross-checked against the WCC report: Tony Grove RS (1113:UT:SNTL)
 * PREC last value 2.7 / WTEQ 0.0 == snowpack.json for the same day.
 * CORS is open (`access-control-allow-origin: *`), so the app can also
 * fetch multi-year context client-side.
 */
import { wccFetch } from './wcc.js';

export const AWDB_DATA_URL = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data';

/** Raw API value row: daily rows carry `date`; monthly rows carry month/year. */
export interface AwdbValue {
  date?: string;
  month?: number;
  year?: number;
  value: number | null;
}

export interface AwdbSeriesEntry {
  stationTriplet: string;
  data: {
    stationElement: {
      elementCode: string;
      durationName: string;
      beginDate: string;
      endDate: string;
    };
    values: AwdbValue[];
  }[];
}

/** One station's compact series, aligned to the shared `dates` axis. */
export interface TimeseriesStation {
  /** Station triplet, e.g. "1113:UT:SNTL". */
  t: string;
  /** Daily SWE, inches (1 decimal); null where missing. */
  w: (number | null)[];
  /** Daily water-year accumulated precipitation, inches; null where missing. */
  p: (number | null)[];
}

export interface TimeseriesData {
  schemaVersion: 1;
  source: string;
  /** Water year the `dates` axis belongs to (Oct 1 – Sep 30). */
  waterYear: number;
  /** When the pipeline fetched the API (ISO 8601). */
  fetchedAt: string;
  /** Shared date axis (YYYY-MM-DD), ascending; series arrays align to it. */
  dates: string[];
  stations: TimeseriesStation[];
  warnings: string[];
}

/** WCC element codes: WTEQ = SWE (in), PREC = water-year accumulated precip (in). */
const ELEMENTS = 'WTEQ,PREC';

/**
 * Fetch daily series for the given station triplets between two dates
 * (inclusive). Batched to keep URLs short; the API accepts a
 * comma-separated list.
 */
export async function fetchAwdbSeries(
  triplets: string[],
  beginDate: string,
  endDate: string,
  opts: { batchSize?: number; fetchText?: (url: string) => Promise<string> } = {},
): Promise<AwdbSeriesEntry[]> {
  const { batchSize = 60, fetchText = wccFetch } = opts;
  const all: AwdbSeriesEntry[] = [];
  for (let i = 0; i < triplets.length; i += batchSize) {
    const batch = triplets.slice(i, i + batchSize).join(',');
    const url =
      `${AWDB_DATA_URL}?stationTriplets=${encodeURIComponent(batch)}` +
      `&elements=${ELEMENTS}&duration=DAILY&beginDate=${beginDate}&endDate=${endDate}`;
    const text = await fetchText(url);
    const parsed = JSON.parse(text) as AwdbSeriesEntry[];
    if (!Array.isArray(parsed)) {
      throw new Error('AWDB data API returned a non-array response');
    }
    all.push(...parsed);
  }
  return all;
}

/** Water year of a calendar date: Oct 1 of (wy-1) – Sep 30 of wy. */
export function waterYearOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 10 ? year + 1 : year;
}

/** First day of the water year, e.g. 2027 → "2026-10-01". */
export function waterYearStart(waterYear: number): string {
  return `${waterYear - 1}-10-01`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Convert the raw API response into the compact `TimeseriesData` contract:
 * a shared ascending date axis plus per-station arrays (1-decimal inches,
 * null where the API returned no value for that day).
 *
 * `registryTriplets` is the expected station set; stations absent from the
 * response (or present but with no values) produce warnings rather than
 * silent gaps.
 */
export function buildTimeseries(
  raw: AwdbSeriesEntry[],
  opts: {
    waterYear: number;
    fetchedAt: string;
    registryTriplets: string[];
    /** Upper bound for the date axis (inclusive, YYYY-MM-DD). */
    endDate: string;
  },
): TimeseriesData {
  const begin = waterYearStart(opts.waterYear);
  const warnings: string[] = [];

  // Collect every date the API returned, clamped to the water-year window.
  const dateSet = new Set<string>();
  for (const entry of raw) {
    for (const series of entry.data) {
      for (const v of series.values) {
        if (!v.date) continue;
        if (v.date >= begin && v.date <= opts.endDate) dateSet.add(v.date);
      }
    }
  }
  const dates = [...dateSet].sort();
  const index = new Map(dates.map((d, i) => [d, i]));

  const byTriplet = new Map<string, AwdbSeriesEntry[]>();
  for (const entry of raw) {
    const list = byTriplet.get(entry.stationTriplet) ?? [];
    list.push(entry);
    byTriplet.set(entry.stationTriplet, list);
  }

  const stations: TimeseriesStation[] = [];
  for (const triplet of opts.registryTriplets) {
    const entries = byTriplet.get(triplet) ?? [];
    const w: (number | null)[] = dates.map(() => null);
    const p: (number | null)[] = dates.map(() => null);
    let valuesSeen = 0;
    for (const entry of entries) {
      for (const series of entry.data) {
        const arr = series.stationElement.elementCode === 'WTEQ' ? w : p;
        for (const v of series.values) {
          if (!v.date || v.value === null) continue;
          const i = index.get(v.date);
          if (i === undefined) continue;
          arr[i] = round1(v.value);
          valuesSeen++;
        }
      }
    }
    stations.push({ t: triplet, w, p });
    if (valuesSeen === 0) {
      warnings.push(`no ${opts.waterYear} series data for ${triplet} (station returned no values)`);
    }
  }

  // API entries for stations outside the registry: note, don't include.
  const registry = new Set(opts.registryTriplets);
  const extras = [...byTriplet.keys()].filter((t) => !registry.has(t));
  if (extras.length > 0) {
    warnings.push(
      `AWDB returned ${extras.length} station(s) not in the registry: ` +
        `${extras.slice(0, 5).join(', ')}${extras.length > 5 ? '…' : ''}`,
    );
  }

  return {
    schemaVersion: 1,
    source: AWDB_DATA_URL,
    waterYear: opts.waterYear,
    fetchedAt: opts.fetchedAt,
    dates,
    stations,
    warnings,
  };
}
