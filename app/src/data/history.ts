/**
 * Multi-year history, fetched on demand from the WCC AWDB REST API
 * (docs/PLAN.md task 9; open CORS — no proxy needed).
 *
 * For a station, one request returns the full record of MONTHLY values
 * (WTEQ = end-of-month SWE, PREC = monthly total; both inches). ~20 KB per
 * station, cached in memory for the session.
 */

const AWDB_DATA_URL = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data';

export interface MonthlyPoint {
  /** "YYYY-MM" (month 1-12 from the API). */
  key: string;
  /** End-of-month SWE, inches (null where missing). */
  swe: number | null;
  /** Monthly total precipitation, inches (null where missing). */
  precip: number | null;
}

interface RawValue {
  month?: number;
  year?: number;
  value: number | null;
}

interface RawEntry {
  stationTriplet: string;
  data: {
    stationElement: { elementCode: string };
    values: RawValue[];
  }[];
}

const cache = new Map<string, MonthlyPoint[]>();

/**
 * Fetch a station's full monthly record (from its first reading to now).
 * Resolves to [] when the station has no monthly data; throws on network
 * failure so the caller can distinguish "no data" from "unavailable".
 */
export async function fetchStationHistory(triplet: string): Promise<MonthlyPoint[]> {
  const hit = cache.get(triplet);
  if (hit) return hit;

  const url =
    `${AWDB_DATA_URL}?stationTriplets=${encodeURIComponent(triplet)}` +
    '&elements=WTEQ,PREC&duration=MONTHLY&beginDate=1900-01-01';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AWDB history HTTP ${res.status ?? 'error'}`);
  const entries = (await res.json()) as RawEntry[];

  const months = new Map<string, MonthlyPoint>();
  const upsert = (v: RawValue, field: 'swe' | 'precip') => {
    if (v.month === undefined || v.year === undefined) return;
    const key = `${v.year}-${String(v.month).padStart(2, '0')}`;
    const point = months.get(key) ?? { key, swe: null, precip: null };
    point[field] = v.value === null ? null : Math.round(v.value * 10) / 10;
    months.set(key, point);
  };
  for (const entry of entries) {
    for (const series of entry.data) {
      const field = series.stationElement.elementCode === 'WTEQ' ? 'swe' : 'precip';
      for (const v of series.values) upsert(v, field);
    }
  }
  const points = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
  cache.set(triplet, points);
  return points;
}
