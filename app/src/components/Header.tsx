import type { SnowpackData } from '../types';

/**
 * Dashboard header: title, water-year banner, and the two source stamps
 * (docs/PLAN.md task 6). Task 10 extends this with the staleness indicator.
 */
export function Header({ data }: { data: SnowpackData | null }) {
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
            fetched{' '}
            <time dateTime={data.fetchedAt}>{new Date(data.fetchedAt).toLocaleString()}</time>
          </span>
        </p>
      )}
    </header>
  );
}
