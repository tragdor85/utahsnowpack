import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  basinDailyPoints,
  dailyPoints,
  fetchTimeseries,
  stationSeries,
} from './timeseries';
import type { TimeseriesData, TimeseriesStation } from '../types';

function station(t: string, w: (number | null)[], p: (number | null)[]): TimeseriesStation {
  return { t, w, p };
}

function data(dates: string[], stations: TimeseriesStation[]): TimeseriesData {
  return {
    schemaVersion: 1,
    source: 'test',
    waterYear: 2027,
    fetchedAt: '2026-10-25T00:00:00.000Z',
    dates,
    stations,
    warnings: [],
  };
}

describe('dailyPoints', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

  it('converts cumulative WY precip into daily increments', () => {
    const points = dailyPoints(station('a', [1, 2, 3, 4], [1, 3, 3, 6]), dates);
    expect(points.map((p) => p.precip)).toEqual([1, 2, 0, 3]);
    expect(points.map((p) => p.swe)).toEqual([1, 2, 3, 4]);
    expect(points[0].date).toBe('2026-10-01');
  });

  it('treats a gap in the cumulative series as an unknown increment', () => {
    const points = dailyPoints(station('a', [null, 1, 2, null], [1, null, 3, 4]), dates);
    // Day 1: first value is its own increment. Day 2: gap -> null.
    // Day 3: 3 - 1 (last known) = 2. Day 4: 4 - 3 = 1.
    expect(points.map((p) => p.precip)).toEqual([1, null, 2, 1]);
    expect(points.map((p) => p.swe)).toEqual([null, 1, 2, null]);
  });

  it('never emits a negative increment (a corrected cumulative total)', () => {
    const points = dailyPoints(station('a', [1, 2], [5, 4]), dates.slice(0, 2));
    expect(points.map((p) => p.precip)).toEqual([5, 0]);
  });
});

describe('basinDailyPoints', () => {
  const dates = ['2026-10-01', '2026-10-02'];
  const sites = [
    { stationTriplet: 'a' },
    { stationTriplet: 'b' },
    { stationTriplet: 'c' }, // absent from the series data
  ];
  const ts = data(dates, [
    station('a', [1, 2], [1, 3]),
    station('b', [3, null], [2, 2]),
  ]);

  it('averages SWE over sites with a value and sums daily precip', () => {
    const points = basinDailyPoints(ts, sites, dates);
    // Day 1: mean(1, 3) = 2; precip 1 + 2 = 3.
    expect(points[0]).toEqual({ date: '2026-10-01', swe: 2, precip: 3 });
    // Day 2: only a reports SWE (2); precip increments 2 + 0 = 2.
    expect(points[1]).toEqual({ date: '2026-10-02', swe: 2, precip: 2 });
  });

  it('returns nulls when nothing reports on a day', () => {
    const empty = data(dates, [station('a', [null, null], [null, null])]);
    const points = basinDailyPoints(empty, sites, dates);
    expect(points.every((p) => p.swe === null && p.precip === null)).toBe(true);
  });

  it('handles a missing timeseries file (null) gracefully', () => {
    const points = basinDailyPoints(null, sites, dates);
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.swe === null && p.precip === null)).toBe(true);
  });
});

describe('stationSeries', () => {
  const ts = data(['2026-10-01'], [station('a', [1], [1]), station('b', [2], [2])]);

  it('finds a station by triplet', () => {
    expect(stationSeries(ts, 'b')?.w).toEqual([2]);
  });

  it('returns undefined for an absent station', () => {
    expect(stationSeries(ts, 'z')).toBeUndefined();
    expect(stationSeries(null, 'a')).toBeUndefined();
  });
});

describe('fetchTimeseries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed file', async () => {
    const ts = data(['2026-10-01'], []);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ts })),
    );
    expect(await fetchTimeseries()).toEqual(ts);
  });

  it('returns null on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchTimeseries()).toBeNull();
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    expect(await fetchTimeseries()).toBeNull();
  });

  it('returns null when the schema version is unrecognized', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ schemaVersion: 99, dates: [], stations: [] }),
      })),
    );
    expect(await fetchTimeseries()).toBeNull();
  });
});
