import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailPanel } from './DetailPanel';
import { MOCK_SNOWPACK } from '../data/mock';
import type { SnowpackBasin, SnowpackSite } from '../types';

function basin(id: string): SnowpackBasin {
  const b = MOCK_SNOWPACK.basins.find((x) => x.id === id);
  if (!b) throw new Error(`mock basin ${id} missing`);
  return b;
}

function makeSite(partial: Partial<SnowpackSite>): SnowpackSite {
  return {
    stationId: '9999',
    stationTriplet: '0805999999',
    name: 'TEST SITE',
    elevationFt: 5000,
    latitude: 40,
    longitude: -111,
    reportedToday: true,
    sweIn: null,
    sweAvgIn: null,
    swePctAvg: null,
    precipIn: null,
    precipAvgIn: null,
    precipPctAvg: null,
    flags: [],
    ...partial,
  };
}

function singleBasin(sites: SnowpackSite[]): SnowpackBasin {
  return {
    ...basin('raft_river'),
    sites,
    sitesTotal: sites.length,
    sitesReporting: sites.filter((s) => s.reportedToday).length,
  };
}

function rowCells(name: string): string[] {
  const row = screen
    .getAllByText(name)
    .map((n) => n.closest('tr'))
    .find(Boolean);
  if (!row) throw new Error(`row for ${name} not found`);
  return Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? '');
}

describe('DetailPanel: KSL table parity', () => {
  it('renders the two-row KSL header (column labels, then group labels)', () => {
    render(<DetailPanel basin={basin('raft_river')} />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      'Site',
      'Elev.',
      'SWE',
      'Avg',
      '% Avg',
      'Precip',
      'Avg',
      '% Avg',
      'Site',
      'SWE % Avg',
      'Precip % Avg',
    ]);
  });

  it('formats value cells KSL-style: one decimal, no leading zero, -M when missing', () => {
    render(
      <DetailPanel
        basin={singleBasin([
          makeSite({ name: 'A', sweIn: 6.4, sweAvgIn: 0.7, precipIn: 10.0, precipAvgIn: 1.6 }),
          makeSite({ name: 'B', reportedToday: false, flags: ['swe-missing'], sweAvgIn: 0.7 }),
        ])}
      />,
    );
    expect(rowCells('A')).toEqual(['A', '5000', '6.4', '.7', '-M', '10.0', '1.6', '-M']);
    expect(rowCells('B')).toEqual(['B', '5000', '-M', '.7', '-M', '-M', '-M', '-M']);
  });

  it('puts the asterisk in the % Avg column when the percent is invalid', () => {
    render(
      <DetailPanel
        basin={singleBasin([
          // value present + invalid pct → "120*"
          makeSite({
            name: 'A',
            sweIn: 1.2,
            sweAvgIn: 1.0,
            swePctAvg: 120,
            flags: ['swe-pct-invalid'],
          }),
          // no value + invalid pct → bare "*"
          makeSite({
            name: 'B',
            reportedToday: false,
            flags: ['swe-missing', 'swe-pct-invalid'],
            sweAvgIn: 1.0,
          }),
          // missing pct, not invalid → "-M"
          makeSite({ name: 'C', sweIn: 1.0, sweAvgIn: 1.0, flags: ['swe-pct-missing'] }),
        ])}
      />,
    );
    expect(rowCells('A')[4]).toBe('120*');
    expect(rowCells('B')[4]).toBe('*');
    expect(rowCells('C')[4]).toBe('-M');
    // asterisks never appear in value columns
    expect(rowCells('A').slice(2, 5)).not.toContain('1.2*');
  });

  it('sorts sites by elevation, highest first (KSL order)', () => {
    render(
      <DetailPanel
        basin={singleBasin([
          makeSite({ name: 'LOW', elevationFt: 3000 }),
          makeSite({ name: 'HIGH', elevationFt: 9000 }),
          makeSite({ name: 'MID', elevationFt: 6000 }),
        ])}
      />,
    );
    const names = screen
      .getAllByRole('row')
      .slice(2)
      .map((r) => r.querySelector('td')?.textContent);
    expect(names).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('searches by site name and station ID', async () => {
    const user = userEvent.setup();
    render(
      <DetailPanel
        basin={singleBasin([
          makeSite({ name: 'CREEK 1 N', stationId: '1234', stationTriplet: '0805123401' }),
          makeSite({ name: 'PEAK 2 S', stationId: '5678', stationTriplet: '0805567802' }),
        ])}
      />,
    );
    const input = screen.getByRole('searchbox');
    await user.type(input, 'creek');
    expect(screen.getByText('CREEK 1 N')).toBeInTheDocument();
    expect(screen.queryByText('PEAK 2 S')).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '5678');
    expect(screen.getByText('PEAK 2 S')).toBeInTheDocument();
    expect(screen.queryByText('CREEK 1 N')).not.toBeInTheDocument();
  });

  it('shows an empty result row when nothing matches', async () => {
    const user = userEvent.setup();
    render(<DetailPanel basin={basin('bear_river')} />);
    const input = screen.getByRole('searchbox');
    await user.type(input, 'zzz-no-match');
    expect(screen.getByText(/No sites match/)).toBeInTheDocument();
  });

  it('dims non-reporting rows and announces their status via aria-label', () => {
    render(
      <DetailPanel
        basin={singleBasin([
          makeSite({
            name: 'STALE 1 N',
            reportedToday: false,
            flags: ['swe-missing', 'precip-missing'],
          }),
        ])}
      />,
    );
    const row = screen
      .getAllByText('STALE 1 N')
      .map((n) => n.closest('tr'))
      .find(Boolean);
    expect(row).toHaveClass('detail-table__row--stale');
    expect(row?.getAttribute('aria-label')).toMatch(/did not report today/);
    expect(row?.getAttribute('aria-label')).toMatch(/SWE missing/);
  });

  it('renders the KSL footnote explaining -M and *', () => {
    render(<DetailPanel basin={basin('raft_river')} />);
    const footnote = screen.getByText(/missing data/);
    expect(footnote).toHaveTextContent(/valid measure of conditions/);
  });

  it('shows the per-basin summary: rollup, reporting count, and totals', () => {
    render(<DetailPanel basin={basin('bear_river')} />);
    const panel = screen.getByRole('complementary', { name: /basin detail/i });
    expect(panel).toHaveTextContent('54%');
    expect(panel).toHaveTextContent('1/2');
    // Σ SWE over reporting sites: 1.1 (SUNNYSIDE only; CORTEZ has no SWE)
    expect(panel).toHaveTextContent('1.1');
  });

  it('renders an empty state when no basin is selected', async () => {
    render(<DetailPanel basin={null} />);
    expect(screen.getByRole('complementary', { name: /basin detail/i })).toHaveTextContent(
      'Select a basin',
    );
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
  });
});

describe('DetailPanel: time series charts (task 9)', () => {
  function chartTimeseries() {
    return {
      schemaVersion: 1 as const,
      source: 'test',
      waterYear: 2027,
      fetchedAt: '2026-10-25T00:00:00.000Z',
      dates: ['2026-10-01', '2026-10-02', '2026-10-03'],
      stations: [
        { t: 'aaa', w: [1, 2, 3], p: [1, 3, 3] },
        { t: 'bbb', w: [3, null, 4], p: [2, 2, 5] },
        { t: 'ccc', w: [null, null, null], p: [null, null, null] },
      ],
      warnings: [],
    };
  }

  const sites = [
    makeSite({ stationTriplet: 'aaa', name: 'ALPHA', elevationFt: 8000 }),
    makeSite({ stationTriplet: 'bbb', name: 'BRAVO', elevationFt: 7000 }),
    makeSite({ stationTriplet: 'ccc', name: 'CHARLIE', elevationFt: 6000 }),
  ];

  it('renders the basin aggregate chart when a timeseries is provided', () => {
    render(<DetailPanel basin={singleBasin(sites)} timeseries={chartTimeseries()} />);
    const panel = screen.getByRole('complementary', { name: /basin detail/i });
    expect(panel).toHaveTextContent('basin');
    // The chart figure renders (SVG internals are covered in SeriesChart.test,
    // which uses a fixed width — ResponsiveContainer measures 0 in jsdom).
    expect(panel.querySelector('.chart')).not.toBeNull();
    expect(panel.querySelector('.chart__title')).toHaveTextContent(/basin/);
  });

  it('notes when the timeseries file is unavailable', () => {
    render(<DetailPanel basin={singleBasin(sites)} timeseries={null} />);
    expect(screen.getByText(/Time series unavailable/)).toBeInTheDocument();
  });

  it('selects a site from its name button and shows its own chart', async () => {
    const user = userEvent.setup();
    render(<DetailPanel basin={singleBasin(sites)} timeseries={chartTimeseries()} />);
    const nameButton = screen.getByRole('button', { name: /ALPHA — show time series/ });
    await user.click(nameButton);
    expect(nameButton).toHaveAttribute('aria-pressed', 'true');
    // The site chart appears with the station's name.
    const charts = screen.getAllByText('ALPHA');
    expect(charts.some((el) => el.closest('.chart'))).toBe(true);
    // Selecting again deselects.
    await user.click(nameButton);
    expect(nameButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the empty state for a site with no series data', async () => {
    const user = userEvent.setup();
    render(<DetailPanel basin={singleBasin(sites)} timeseries={chartTimeseries()} />);
    await user.click(screen.getByRole('button', { name: /CHARLIE — show time series/ }));
    // CHARLIE's series is all null → "No history yet."
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
  });

  it('fetches multi-year history when the toggle is pressed', async () => {
    const user = userEvent.setup();
    // Typed with an explicit signature (the impl ignores the arg) so the
    // recorded call argument stays a string for the URL assertions.
    const fetchMock = vi.fn<
      (input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
    >(async () => ({
      ok: true,
      json: async () => [
        {
          stationTriplet: 'aaa',
          data: [
            {
              stationElement: { elementCode: 'WTEQ' },
              values: [
                { month: 1, year: 2025, value: 6.9 },
                { month: 2, year: 2025, value: 10.9 },
              ],
            },
            {
              stationElement: { elementCode: 'PREC' },
              values: [
                { month: 1, year: 2025, value: 11.2 },
                { month: 2, year: 2025, value: 15.5 },
              ],
            },
          ],
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DetailPanel basin={singleBasin(sites)} timeseries={chartTimeseries()} />);
    await user.click(screen.getByRole('button', { name: /ALPHA — show time series/ }));
    await user.click(screen.getByRole('button', { name: 'Multi-year' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('stationTriplets=aaa');
    expect(fetchMock.mock.calls[0][0]).toContain('duration=MONTHLY');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'This water year' })).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('resets the selection when the basin changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DetailPanel basin={singleBasin(sites)} timeseries={chartTimeseries()} />,
    );
    await user.click(screen.getByRole('button', { name: /ALPHA — show time series/ }));
    expect(screen.getByRole('button', { name: /ALPHA — show time series/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const otherSites = [makeSite({ stationTriplet: 'zzz', name: 'ZULU', elevationFt: 9000 })];
    rerender(
      <DetailPanel
        basin={{ ...singleBasin(otherSites), id: 'other_basin', name: 'OTHER BASIN' }}
        timeseries={chartTimeseries()}
      />,
    );
    // No site selected in the new basin.
    expect(
      screen
        .queryByRole('button', { name: /ZULU — show time series/ })
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
