import { formatInches, formatPct, type SiteFlag, type SnowpackBasin } from '../types';

/** Human-readable explanation for each data-quality flag (tooltip text). */
const FLAG_TITLES: Record<SiteFlag, string> = {
  'swe-missing': 'SWE missing (station has not reported)',
  'swe-invalid': 'SWE value failed validation',
  'swe-avg-missing': 'SWE average missing',
  'swe-avg-invalid': 'SWE average failed validation',
  'swe-pct-missing': 'SWE % not computable',
  'swe-pct-invalid': 'SWE % failed validation',
  'precip-missing': 'Precipitation missing',
  'precip-invalid': 'Precipitation value failed validation',
  'precip-avg-missing': 'Precipitation average missing',
  'precip-avg-invalid': 'Precipitation average failed validation',
  'precip-pct-missing': 'Precipitation % not computable',
  'precip-pct-invalid': 'Precipitation % failed validation',
};

function metricCell(value: number | null, format: (v: number | null) => string, flags: SiteFlag[]) {
  const flagged = flags.length > 0;
  return (
    <td className={flagged ? 'site-table__cell site-table__cell--flagged' : 'site-table__cell'}>
      {format(value)}
      {flags.map((f) => (
        <sup
          key={f}
          className="site-table__flag"
          title={FLAG_TITLES[f]}
          aria-label={FLAG_TITLES[f]}
        >
          *
        </sup>
      ))}
    </td>
  );
}

/**
 * Side detail panel (docs/PLAN.md task 6): the selected basin's rollup and
 * its sites. Task 8 extends this to full parity with KSL's basin detail.
 */
export function DetailPanel({ basin }: { basin: SnowpackBasin | null }) {
  if (basin === null) {
    return (
      <aside className="panel" aria-label="Basin detail">
        <p className="panel__empty">Select a basin to see its sites.</p>
      </aside>
    );
  }
  return (
    <aside className="panel" aria-label={`Basin detail: ${basin.name}`}>
      <h2 className="panel__name">{basin.name}</h2>
      <p className="panel__rollup">
        <span
          className={`band-chip panel__chip band-chip--${basin.colorBand}`}
          aria-hidden="true"
        />
        <span className="panel__pct">{formatPct(basin.swePctAvg)}</span>
        <span className="panel__rollup-label">of average SWE</span>
      </p>
      <p className="panel__reporting">
        {basin.sitesReporting} of {basin.sitesTotal} sites reported
      </p>
      <div className="site-table-wrap">
        <table className="site-table">
          <caption className="visually-hidden">
            Sites in {basin.name} with SWE and water-year precipitation
          </caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">SWE (in)</th>
              <th scope="col">SWE avg (in)</th>
              <th scope="col">SWE %</th>
              <th scope="col">Precip (in)</th>
              <th scope="col">Precip avg (in)</th>
              <th scope="col">Precip %</th>
            </tr>
          </thead>
          <tbody>
            {basin.sites.map((site) => (
              <tr
                key={site.stationTriplet}
                className={site.reportedToday ? undefined : 'site-table__row--stale'}
              >
                <td className="site-table__name" title={`elevation ${site.elevationFt} ft`}>
                  {site.name}
                </td>
                {metricCell(
                  site.sweIn,
                  (v) => formatInches(v),
                  site.flags.filter(
                    (f) => f.startsWith('swe-') && !f.includes('avg') && !f.includes('pct'),
                  ),
                )}
                {metricCell(
                  site.sweAvgIn,
                  (v) => formatInches(v),
                  site.flags.filter((f) => f.includes('swe-avg')),
                )}
                {metricCell(
                  site.swePctAvg,
                  (v) => formatPct(v),
                  site.flags.filter((f) => f.includes('swe-pct')),
                )}
                {metricCell(
                  site.precipIn,
                  (v) => formatInches(v),
                  site.flags.filter(
                    (f) => f.startsWith('precip-') && !f.includes('avg') && !f.includes('pct'),
                  ),
                )}
                {metricCell(
                  site.precipAvgIn,
                  (v) => formatInches(v),
                  site.flags.filter((f) => f.includes('precip-avg')),
                )}
                {metricCell(
                  site.precipPctAvg,
                  (v) => formatPct(v),
                  site.flags.filter((f) => f.includes('precip-pct')),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
