/**
 * Time series data access (docs/PLAN.md task 9).
 *
 * `timeseries.json` (served at /timeseries.json, committed and updated by
 * the daily pipeline) holds the current water year's daily SWE + WY
 * precipitation for every registry station. The multi-year context is
 * fetched on demand from the WCC AWDB API (open CORS) — see history.ts.
 */
import type { TimeseriesData, TimeseriesStation } from '../types';

/**
 * Fetch the committed current-WY series. Returns null (not a throw) when the
 * file is missing or malformed — the charts degrade to an empty state and
 * the dashboard itself is unaffected.
 */
export async function fetchTimeseries(): Promise<TimeseriesData | null> {
  try {
    const res = await fetch('/timeseries.json');
    if (!res.ok) return null;
    const data = (await res.json()) as TimeseriesData;
    if (data.schemaVersion !== 1 || !Array.isArray(data.dates) || !Array.isArray(data.stations)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Look up one station's arrays; undefined when the station is absent. */
export function stationSeries(data: TimeseriesData | null, triplet: string): TimeseriesStation | undefined {
  return data?.stations.find((s) => s.t === triplet);
}

/** Chart-ready rows for one station: date + SWE + daily precip. */
export interface DailyPoint {
  date: string;
  /** SWE, inches (null where missing). */
  swe: number | null;
  /** Daily precip, inches (delta of the WY cumulative series). */
  precip: number | null;
}

/**
 * Convert a station's cumulative PREC series into daily increments.
 * The first day's increment is its own value (the WY started Oct 1); a gap
 * (null before) makes the delta unknowable → null.
 */
export function dailyPoints(station: TimeseriesStation, dates: string[]): DailyPoint[] {
  let prev: number | null = null;
  return dates.map((date, i) => {
    const cum = station.p[i] ?? null;
    let precip: number | null = null;
    if (cum !== null) {
      precip = prev === null ? cum : Math.max(0, cum - prev);
      prev = cum;
    }
    return { date, swe: station.w[i] ?? null, precip };
  });
}

/**
 * Basin aggregate for a date: mean SWE over the basin's sites that have a
 * value that day, and sum of daily precip over the same sites. Sites with no
 * series data at all are simply absent.
 */
export function basinDailyPoints(
  data: TimeseriesData | null,
  sites: { stationTriplet: string }[],
  dates: string[],
): DailyPoint[] {
  const byTriplet = new Map<string, TimeseriesStation>();
  for (const s of data?.stations ?? []) byTriplet.set(s.t, s);
  const series = sites
    .map((s) => byTriplet.get(s.stationTriplet))
    .filter((s): s is TimeseriesStation => s !== undefined);

  const prev = new Map<string, number | null>();
  return dates.map((date, i) => {
    let sweSum = 0;
    let sweN = 0;
    let precipSum = 0;
    let precipN = 0;
    for (const st of series) {
      const swe = st.w[i] ?? null;
      if (swe !== null) {
        sweSum += swe;
        sweN++;
      }
      const cum = st.p[i] ?? null;
      const last = prev.get(st.t) ?? null;
      prev.set(st.t, cum);
      if (cum !== null) {
        const inc = last === null ? cum : Math.max(0, cum - last);
        precipSum += inc;
        precipN++;
      }
    }
    return {
      date,
      swe: sweN > 0 ? Math.round((sweSum / sweN) * 10) / 10 : null,
      precip: precipN > 0 ? Math.round(precipSum * 10) / 10 : null,
    };
  });
}
