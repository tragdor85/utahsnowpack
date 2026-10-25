import { formatRelativeTime, stalenessOf } from '../data/freshness';
import type { SnowpackData } from '../types';

const STALENESS_LABEL: Record<'stale' | 'very-stale', string> = {
  stale: 'stale',
  'very-stale': 'very stale',
};

/**
 * Dashboard header: title, water-year banner, the two source stamps
 * (docs/PLAN.md task 6) and the freshness indicator (task 10): a
 * relative "updated" stamp, plus a staleness badge when the data is
 * older than a daily run or two.
 *
 * `now` is injectable for tests; defaults to the current clock.
 */
export function Header({ data, now }: { data: SnowpackData | null; now?: Date }) {
  const clock = now ?? new Date();
  const staleness = data !== null ? stalenessOf(data.fetchedAt, clock) : null;
  return (
    <header className="shell__header">
      <div className="shell__header-row">
        <h1>Utah Snowpack</h1>
        {data?.waterYear != null && (
          <span className="header__water-year" data-testid="water-year">
            Water year {data.waterYear}
          </span>
        )}
      </div>
      <p className="shell__subtitle">
        SNOTEL SWE &amp; water-year precipitation across Utah&rsquo;s 8 major basins
      </p>
      {data !== null && (
        <p className="header__stamps">
          <span>
            KSL{' '}
            <time dateTime={data.lastUpdated.kslDate ?? undefined}>
              {data.lastUpdated.ksl ?? '—'}
            </time>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            WCC{' '}
            <time dateTime={data.lastUpdated.wccDate ?? undefined}>
              {data.lastUpdated.wcc ?? '—'}
            </time>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            updated{' '}
            <time dateTime={data.fetchedAt} data-testid="updated-relative">
              {formatRelativeTime(data.fetchedAt, clock)}
            </time>
          </span>
          {staleness !== null && staleness !== 'fresh' && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={`header__staleness header__staleness--${staleness}`}
                data-testid="staleness-badge"
              >
                {STALENESS_LABEL[staleness]}
              </span>
            </>
          )}
        </p>
      )}
    </header>
  );
}
