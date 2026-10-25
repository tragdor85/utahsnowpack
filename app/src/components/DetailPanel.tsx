import { useEffect, useMemo, useState } from 'react';
import {
  COLOR_BAND_META,
  formatElevCell,
  formatInches,
  formatInchesCell,
  formatPct,
  formatPctCell,
  type SiteFlag,
  type SnowpackBasin,
  type SnowpackSite,
  type TimeseriesData,
} from '../types';
import { basinDailyPoints, dailyPoints, stationSeries } from '../data/timeseries';
import { fetchStationHistory, type MonthlyPoint } from '../data/history';
import { SeriesChart } from './SeriesChart';

/** Human-readable explanation for each data-quality flag (screen-reader text). */
const FLAG_TITLES: Record<SiteFlag, string> = {
  'swe-missing': 'SWE missing (station has not reported)',
  'swe-invalid': 'SWE value failed validation',
  'swe-avg-missing': 'SWE average missing',
  'swe-avg-invalid': 'SWE average failed validation',
  'swe-pct-missing': 'SWE percent of average not computable',
  'swe-pct-invalid': 'SWE percent of average may not be valid',
  'precip-missing': 'precipitation missing',
  'precip-invalid': 'precipitation value failed validation',
  'precip-avg-missing': 'precipitation average missing',
  'precip-avg-invalid': 'precipitation average failed validation',
  'precip-pct-missing': 'precipitation percent of average not computable',
  'precip-pct-invalid': 'precipitation percent of average may not be valid',
};

function siteAriaLabel(site: SnowpackSite): string {
  const parts = [site.name, `station ${site.stationId}`];
  if (!site.reportedToday) parts.push('did not report today');
  for (const flag of site.flags) parts.push(FLAG_TITLES[flag]);
  return parts.join(', ');
}

/**
 * Basin/site detail panel (docs/PLAN.md tasks 8 + 9).
 *
 * The site table matches KSL's column-for-column: Site, Elev., SWE, SWE
 * Avg, SWE % Avg, Precip, Precip Avg, Precip % Avg — with KSL's cell
 * conventions ("-M" missing, "*" in the % Avg column for invalid data)
 * and its two-row header. Verified against the 10-24 capture: 192 of 194
 * matched sites cell-for-cell (the 2 exceptions are KSL's own column-shift
 * bug), all 8 basins' rollups identical.
 *
 * Task 9 adds the time series charts: a basin aggregate (mean SWE over
 * reporting sites + summed daily precip) and, for the selected site, its
 * own SWE curve + WY precip, with an on-demand multi-year monthly context
 * fetched from the WCC AWDB API.
 */
export function DetailPanel({
  basin,
  timeseries = null,
}: {
  basin: SnowpackBasin | null;
  timeseries?: TimeseriesData | null;
}) {
  const [query, setQuery] = useState('');
  const [selectedTriplet, setSelectedTriplet] = useState<string | null>(null);
  const [historyMode, setHistoryMode] = useState<'wy' | 'multi'>('wy');
  const [history, setHistory] = useState<MonthlyPoint[] | null>(null);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');

  // A new basin means a new site selection context.
  useEffect(() => {
    setSelectedTriplet(null);
    setHistoryMode('wy');
    setHistory(null);
    setHistoryState('idle');
  }, [basin?.id]);

  // Multi-year context is fetched on demand (open CORS, ~20 KB, cached in
  // data/history.ts) when the user toggles it for the selected site.
  const selectedSite = basin?.sites.find((s) => s.stationTriplet === selectedTriplet) ?? null;
  useEffect(() => {
    if (historyMode !== 'multi' || selectedSite === null) return;
    let cancelled = false;
    setHistoryState('loading');
    fetchStationHistory(selectedSite.stationTriplet)
      .then((points) => {
        if (cancelled) return;
        setHistory(points);
        setHistoryState('idle');
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [historyMode, selectedSite]);

  // KSL orders sites by elevation, highest first.
  const visibleSites = useMemo(() => {
    if (basin === null) return [];
    const sorted = [...basin.sites].sort((a, b) => (b.elevationFt ?? -1) - (a.elevationFt ?? -1));
    const q = query.trim().toLowerCase();
    if (q === '') return sorted;
    return sorted.filter((s) => s.name.toLowerCase().includes(q) || s.stationId === q);
  }, [basin, query]);

  // Time series (task 9): basin aggregate always; the selected site's own
  // series when a row is chosen. `timeseries` is null when the file could
  // not be loaded — the chart section then shows a note, not a blank.
  // (Hooks stay above the early return below.)
  const dates = useMemo(() => timeseries?.dates ?? [], [timeseries]);
  const basinSites = useMemo(() => basin?.sites ?? [], [basin]);
  const basinPoints = useMemo(
    () => basinDailyPoints(timeseries, basinSites, dates),
    [timeseries, basinSites, dates],
  );
  const selectedSeries =
    selectedSite !== null ? stationSeries(timeseries, selectedSite.stationTriplet) : undefined;
  const sitePoints = useMemo(
    () => (selectedSeries !== undefined ? dailyPoints(selectedSeries, dates) : []),
    [selectedSeries, dates],
  );

  if (basin === null) {
    return (
      <aside className="panel" aria-label="Basin detail">
        <p className="panel__empty">Select a basin to see its sites.</p>
      </aside>
    );
  }

  const meta = COLOR_BAND_META[basin.colorBand];
  const reporting = basin.sites.filter((s) => s.reportedToday).length;
  const sum = (
    pick: (s: SnowpackSite) => number | null,
    predicate: (s: SnowpackSite) => boolean = (s) => s.reportedToday,
  ) => {
    let total = 0;
    let any = false;
    for (const s of basin.sites) {
      if (!predicate(s)) continue;
      const v = pick(s);
      if (v !== null) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  };
  const sweTotal = sum((s) => s.sweIn);
  const precipTotal = sum((s) => s.precipIn);

  const selectSite = (site: SnowpackSite) => {
    setSelectedTriplet((cur) => (cur === site.stationTriplet ? null : site.stationTriplet));
    setHistoryMode('wy');
    setHistory(null);
    setHistoryState('idle');
  };

  const chartSection =
    timeseries === null ? (
      <p className="chart__note">Time series unavailable for this capture.</p>
    ) : (
      <div className="panel__charts">
        <SeriesChart
          title={`${basin.name} basin`}
          label={`Snow water equivalent for the ${basin.name} basin, mean of reporting sites, water year ${timeseries.waterYear}`}
          points={basinPoints}
          history={null}
          historyMode="wy"
          historyState="idle"
        />
        {selectedSite !== null && (
          <SeriesChart
            title={selectedSite.name}
            label={`Snow water equivalent and water-year precipitation for ${selectedSite.name}, station ${selectedSite.stationId}`}
            points={sitePoints}
            history={history}
            historyMode={historyMode}
            historyState={historyState}
            onToggleHistory={() => setHistoryMode((m) => (m === 'wy' ? 'multi' : 'wy'))}
          />
        )}
      </div>
    );

  return (
    <aside className="panel" aria-label={`Basin detail: ${basin.name}`}>
      <header className="panel__header">
        <h2 className="panel__name">{basin.name}</h2>
        <span className="panel__band">
          <span className={`band-chip band-chip--${basin.colorBand}`} aria-hidden="true" />
          <span>{meta.label}</span>
        </span>
      </header>

      <dl className="panel__stats">
        <div className="panel__stat">
          <dt>SWE vs avg</dt>
          <dd className={`band-text band-text--${basin.colorBand}`}>
            {formatPct(basin.swePctAvg)}
          </dd>
        </div>
        <div className="panel__stat">
          <dt>Sites reporting</dt>
          <dd>
            {reporting}/{basin.sitesTotal}
          </dd>
        </div>
        <div className="panel__stat">
          <dt>Σ SWE (reporting)</dt>
          <dd>{formatInches(sweTotal)}</dd>
        </div>
        <div className="panel__stat">
          <dt>WY precip (reporting)</dt>
          <dd>{formatInches(precipTotal)}</dd>
        </div>
      </dl>

      {chartSection}

      <div className="panel__search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sites or station ID…"
          aria-label={`Search sites in ${basin.name}`}
        />
      </div>

      <div
        className="panel__table-wrap"
        role="region"
        aria-label={`${basin.name} sites table`}
        tabIndex={0}
      >
        <table className="detail-table">
          <caption className="visually-hidden">
            Sites in {basin.name}: SWE and water-year precipitation, KSL table format
          </caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Elev.</th>
              <th scope="col">SWE</th>
              <th scope="col">Avg</th>
              <th scope="col">% Avg</th>
              <th scope="col">Precip</th>
              <th scope="col">Avg</th>
              <th scope="col">% Avg</th>
            </tr>
            <tr>
              <th scope="col">Site</th>
              <th scope="colgroup" colSpan={3}>
                SWE % Avg
              </th>
              <th scope="colgroup" colSpan={3}>
                Precip % Avg
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleSites.map((site) => {
              const selected = site.stationTriplet === selectedTriplet;
              return (
                <tr
                  key={site.stationTriplet}
                  className={[
                    site.reportedToday ? undefined : 'detail-table__row--stale',
                    selected ? 'detail-table__row--selected' : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={siteAriaLabel(site)}
                  onClick={() => selectSite(site)}
                >
                  <td className="detail-table__name" title={`station ${site.stationId}`}>
                    <button
                      type="button"
                      className="row-select"
                      aria-pressed={selected}
                      aria-label={`${site.name} — show time series`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectSite(site);
                      }}
                    >
                      {site.name}
                    </button>
                  </td>
                  <td className="detail-table__num">{formatElevCell(site.elevationFt)}</td>
                  <td className="detail-table__num">{formatInchesCell(site.sweIn)}</td>
                  <td className="detail-table__num">{formatInchesCell(site.sweAvgIn)}</td>
                  <td className="detail-table__num">
                    {formatPctCell(site.swePctAvg, site.flags.includes('swe-pct-invalid'))}
                  </td>
                  <td className="detail-table__num">{formatInchesCell(site.precipIn)}</td>
                  <td className="detail-table__num">{formatInchesCell(site.precipAvgIn)}</td>
                  <td className="detail-table__num">
                    {formatPctCell(site.precipPctAvg, site.flags.includes('precip-pct-invalid'))}
                  </td>
                </tr>
              );
            })}
            {visibleSites.length === 0 && (
              <tr>
                <td colSpan={8} className="detail-table__empty">
                  No sites match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="panel__footnote">
        SWE: snow water equivalent at SNOTEL sites, in inches. Precip: water year (Oct 1 – Sep 30)
        precipitation, in inches. Elev: site elevation, in feet. −M: missing data. *: data may not
        provide a valid measure of conditions. Charts: daily SWE (area) and precip (bars) for the
        current water year; the multi-year view uses monthly values from the WCC SNOTEL archive.
      </p>
    </aside>
  );
}
