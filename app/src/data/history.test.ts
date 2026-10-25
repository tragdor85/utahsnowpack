import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchStationHistory } from './history';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The API's monthly shape: { month, year, value } instead of { date, value }. */
function rawResponse(triplet: string, wteq: [number, number, number | null][], prec: [number, number, number | null][]) {
  return JSON.stringify([
    {
      stationTriplet: triplet,
      data: [
        {
          stationElement: { elementCode: 'WTEQ' },
          values: wteq.map(([month, year, value]) => ({ month, year, value })),
        },
        {
          stationElement: { elementCode: 'PREC' },
          values: prec.map(([month, year, value]) => ({ month, year, value })),
        },
      ],
    },
  ]);
}

describe('fetchStationHistory', () => {
  it('parses monthly WTEQ + PREC into sorted month points', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () =>
          JSON.parse(
            rawResponse('stn-a', [
              [3, 2025, 15.4],
              [1, 2025, 6.9],
              [2, 2025, 10.9],
            ], [
              [1, 2025, 11.2],
              [2, 2025, 15.5],
              [3, 2025, 21.2],
            ]),
          ),
      })),
    );
    const points = await fetchStationHistory('stn-a');
    expect(points).toEqual([
      { key: '2025-01', swe: 6.9, precip: 11.2 },
      { key: '2025-02', swe: 10.9, precip: 15.5 },
      { key: '2025-03', swe: 15.4, precip: 21.2 },
    ]);
    // The request asks for the full record with monthly values.
    const url = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(url).toContain('stationTriplets=stn-a');
    expect(url).toContain('elements=WTEQ,PREC');
    expect(url).toContain('duration=MONTHLY');
  });

  it('keeps null values and sorts chronologically', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () =>
          JSON.parse(
            rawResponse('stn-b', [
              [5, 2026, null],
              [4, 2026, 5.6],
            ], [
              [4, 2026, 23.1],
              [5, 2026, 1.1],
            ]),
          ),
      })),
    );
    const points = await fetchStationHistory('stn-b');
    expect(points).toEqual([
      { key: '2026-04', swe: 5.6, precip: 23.1 },
      { key: '2026-05', swe: null, precip: 1.1 },
    ]);
  });

  it('resolves to an empty array when the station has no data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [] })),
    );
    expect(await fetchStationHistory('empty')).toEqual([]);
  });

  it('throws on HTTP failure so the caller can show an error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
    );
    await expect(fetchStationHistory('stn-e')).rejects.toThrow('HTTP 500');
  });

  it('caches per station (one network call for repeated fetches)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => JSON.parse(rawResponse('stn-d', [[1, 2025, 6.9]], [[1, 2025, 11.2]])),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchStationHistory('stn-d');
    await fetchStationHistory('stn-d');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
