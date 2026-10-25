import { describe, expect, it } from 'vitest';
import {
  AWDB_DATA_URL,
  buildTimeseries,
  fetchAwdbSeries,
  waterYearOf,
  waterYearStart,
  type AwdbSeriesEntry,
} from '../src/sources/awdb.js';

function entry(
  triplet: string,
  element: string,
  values: { date: string; value: number | null }[],
): AwdbSeriesEntry {
  return {
    stationTriplet: triplet,
    data: [
      {
        stationElement: {
          elementCode: element,
          durationName: 'DAILY',
          beginDate: values[0]?.date ?? '',
          endDate: values[values.length - 1]?.date ?? '',
        },
        values,
      },
    ],
  };
}

describe('waterYearOf / waterYearStart', () => {
  it('maps calendar dates to water years (Oct boundary)', () => {
    expect(waterYearOf('2026-10-01')).toBe(2027);
    expect(waterYearOf('2026-12-31')).toBe(2027);
    expect(waterYearOf('2027-09-30')).toBe(2027);
    expect(waterYearOf('2027-10-01')).toBe(2028);
    expect(waterYearOf('2026-03-15')).toBe(2026);
  });

  it('waterYearStart returns Oct 1 of the previous calendar year', () => {
    expect(waterYearStart(2027)).toBe('2026-10-01');
    expect(waterYearStart(2026)).toBe('2025-10-01');
  });
});

describe('buildTimeseries', () => {
  const registry = ['1113:UT:SNTL', '1114:UT:SNTL', '1115:UT:SNTL'];

  it('aligns per-station values to a shared sorted date axis', () => {
    const data = buildTimeseries(
      [
        // The API returns one entry per station with one series per element.
        {
          stationTriplet: '1113:UT:SNTL',
          data: [
            {
              stationElement: {
                elementCode: 'WTEQ',
                durationName: 'DAILY',
                beginDate: '',
                endDate: '',
              },
              values: [
                { date: '2026-10-02', value: 1.23 },
                { date: '2026-10-01', value: 0.5 },
              ],
            },
            {
              stationElement: {
                elementCode: 'PREC',
                durationName: 'DAILY',
                beginDate: '',
                endDate: '',
              },
              values: [{ date: '2026-10-02', value: 2.7 }],
            },
          ],
        },
        entry('1114:UT:SNTL', 'WTEQ', [{ date: '2026-10-01', value: 0.05 }]),
      ],
      {
        waterYear: 2027,
        fetchedAt: '2026-10-25T00:00:00.000Z',
        registryTriplets: registry,
        endDate: '2026-10-25',
      },
    );
    expect(data.dates).toEqual(['2026-10-01', '2026-10-02']);
    const a = data.stations.find((s) => s.t === '1113:UT:SNTL')!;
    expect(a.w).toEqual([0.5, 1.2]);
    expect(a.p).toEqual([null, 2.7]);
    const b = data.stations.find((s) => s.t === '1114:UT:SNTL')!;
    expect(b.w).toEqual([0.1, null]);
    expect(b.p).toEqual([null, null]);
    // 1115 is in the registry but has no data: warned, not silently dropped.
    expect(data.warnings).toEqual([
      'no 2027 series data for 1115:UT:SNTL (station returned no values)',
    ]);
  });

  it('merges duplicate entries for the same station', () => {
    const data = buildTimeseries(
      [
        entry('1113:UT:SNTL', 'WTEQ', [{ date: '2026-10-01', value: 1 }]),
        entry('1113:UT:SNTL', 'PREC', [{ date: '2026-10-01', value: 2 }]),
      ],
      {
        waterYear: 2027,
        fetchedAt: 'x',
        registryTriplets: ['1113:UT:SNTL'],
        endDate: '2026-10-25',
      },
    );
    expect(data.stations[0].w).toEqual([1]);
    expect(data.stations[0].p).toEqual([2]);
  });

  it('clamps the axis to the water-year window', () => {
    const data = buildTimeseries(
      [
        entry('1113:UT:SNTL', 'WTEQ', [
          { date: '2026-09-30', value: 9.9 }, // previous WY — excluded
          { date: '2026-10-01', value: 1 },
          { date: '2026-10-26', value: 2 }, // past endDate — excluded
        ]),
      ],
      {
        waterYear: 2027,
        fetchedAt: 'x',
        registryTriplets: ['1113:UT:SNTL'],
        endDate: '2026-10-25',
      },
    );
    expect(data.dates).toEqual(['2026-10-01']);
    expect(data.stations[0].w).toEqual([1]);
  });

  it('warns when a registry station returned no values', () => {
    const data = buildTimeseries(
      [entry('1113:UT:SNTL', 'WTEQ', [{ date: '2026-10-01', value: 1 }])],
      { waterYear: 2027, fetchedAt: 'x', registryTriplets: registry, endDate: '2026-10-25' },
    );
    expect(data.warnings.join(' ')).toContain('no 2027 series data for 1114:UT:SNTL');
    expect(data.warnings.join(' ')).toContain('no 2027 series data for 1115:UT:SNTL');
    // The empty stations are still present with all-null arrays.
    expect(data.stations).toHaveLength(3);
    const missing = data.stations.find((s) => s.t === '1114:UT:SNTL')!;
    expect(missing.w).toEqual([null]);
  });

  it('warns about API entries outside the registry but does not include them', () => {
    const data = buildTimeseries(
      [
        entry('1113:UT:SNTL', 'WTEQ', [{ date: '2026-10-01', value: 1 }]),
        entry('9999:UT:SNTL', 'WTEQ', [{ date: '2026-10-01', value: 5 }]),
      ],
      {
        waterYear: 2027,
        fetchedAt: 'x',
        registryTriplets: ['1113:UT:SNTL'],
        endDate: '2026-10-25',
      },
    );
    expect(data.stations).toHaveLength(1);
    expect(data.warnings.join(' ')).toContain('9999:UT:SNTL');
  });

  it('keeps null values in the raw response as null', () => {
    const data = buildTimeseries(
      [entry('1113:UT:SNTL', 'WTEQ', [{ date: '2026-10-01', value: null }])],
      {
        waterYear: 2027,
        fetchedAt: 'x',
        registryTriplets: ['1113:UT:SNTL'],
        endDate: '2026-10-25',
      },
    );
    expect(data.stations[0].w).toEqual([null]);
    expect(data.warnings.join(' ')).toContain('no 2027 series data');
  });
});

describe('fetchAwdbSeries', () => {
  it('batches triplets into comma-separated stationTriplets params', async () => {
    const urls: string[] = [];
    const result = await fetchAwdbSeries(
      ['1113:UT:SNTL', '1114:UT:SNTL', '1115:UT:SNTL'],
      '2026-10-01',
      '2026-10-25',
      {
        batchSize: 2,
        fetchText: async (url) => {
          urls.push(url);
          const triplets = new URL(url).searchParams.get('stationTriplets')!.split(',');
          return JSON.stringify(
            triplets.map((t) => entry(t, 'WTEQ', [{ date: '2026-10-01', value: 1 }])),
          );
        },
      },
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(
      `${AWDB_DATA_URL}?stationTriplets=1113%3AUT%3ASNTL%2C1114%3AUT%3ASNTL`,
    );
    expect(urls[0]).toContain('elements=WTEQ,PREC');
    expect(urls[0]).toContain('duration=DAILY');
    expect(urls[0]).toContain('beginDate=2026-10-01');
    expect(urls[0]).toContain('endDate=2026-10-25');
    expect(result).toHaveLength(3);
  });

  it('throws on a non-array response', async () => {
    await expect(
      fetchAwdbSeries(['1113:UT:SNTL'], '2026-10-01', '2026-10-25', {
        fetchText: async () => JSON.stringify({ error: 'boom' }),
      }),
    ).rejects.toThrow('non-array');
  });
});
