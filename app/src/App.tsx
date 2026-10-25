import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { Legend } from './components/Legend';
import { BasinMap } from './components/BasinMap';
import { BasinList } from './components/BasinList';
import { DetailPanel } from './components/DetailPanel';
import { fetchTimeseries } from './data/timeseries';
import { formatDataDate } from './data/freshness';
import type { SnowpackData, TimeseriesData } from './types';
import bundledRaw from '../../data/snowpack.json';

// The last good data, bundled at build time (docs/PLAN.md task 10): if the
// live fetch fails the dashboard still renders, with a visible warning.
// The file is pipeline-validated (pipeline/src/schema.ts) before commit.
const bundledSnowpack = bundledRaw as unknown as SnowpackData;

/**
 * Dashboard shell (docs/PLAN.md task 6).
 *
 * Data comes from `snowpack.json` (fetched at `/snowpack.json`), the
 * canonical contract produced by the pipeline. Tests and the mock render
 * inject `data` directly, which skips the fetch. If the fetch fails the
 * app falls back to the bundled copy (task 10) and shows a warning; the
 * time series (`/timeseries.json`, task 9) is optional: a failure degrades
 * the charts, never the dashboard.
 */
export default function App({
  data: injected,
  timeseries: injectedTimeseries,
}: {
  data?: SnowpackData | null;
  timeseries?: TimeseriesData | null;
}) {
  const [fetched, setFetched] = useState<SnowpackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const [loading, setLoading] = useState(injected === undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(injectedTimeseries ?? null);

  useEffect(() => {
    if (injected !== undefined) return;
    let cancelled = false;
    // Base-relative: the site deploys under /utahsnowpack/ on GitHub Pages
    // (VITE_BASE), root locally.
    fetch(`${import.meta.env.BASE_URL}snowpack.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SnowpackData>;
      })
      .then((data) => {
        if (cancelled) return;
        setFetched(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Resilience (task 10): serve the last good data bundled at build
        // time, with a visible warning that it may be stale.
        setFetched(bundledSnowpack);
        setFellBack(true);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [injected]);

  useEffect(() => {
    if (injectedTimeseries !== undefined) return;
    let cancelled = false;
    fetchTimeseries().then((data) => {
      if (cancelled) return;
      setTimeseries(data);
    });
    return () => {
      cancelled = true;
    };
  }, [injectedTimeseries]);

  const data = injected !== undefined ? injected : fetched;

  if (loading) {
    return (
      <div className="shell">
        <Header data={null} />
        <main className="shell__main" aria-busy="true">
          <div className="spinner" aria-hidden="true" />
          <p role="status">Loading data…</p>
        </main>
        <ShellFooter data={null} />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="shell">
        <Header data={null} />
        <main className="shell__main" role="alert">
          <p>Could not load snowpack data{error ? ` (${error})` : ''}.</p>
          <p className="shell__hint">Try again once the daily pipeline has run.</p>
        </main>
        <ShellFooter data={null} />
      </div>
    );
  }

  const selected = data.basins.find((b) => b.id === selectedId) ?? data.basins[0] ?? null;

  return (
    <div className="shell">
      <Header data={data} />
      {fellBack && (
        <div className="shell__fallback" role="alert">
          Live data unavailable{error ? ` (${error})` : ''} — showing data from{' '}
          {formatDataDate(data.fetchedAt)}.
        </div>
      )}
      <div className="shell__body">
        <main className="shell__main">
          <Legend />
          <BasinMap data={data} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          <BasinList
            basins={data.basins}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
        </main>
        <DetailPanel basin={selected} timeseries={timeseries} />
      </div>
      <ShellFooter data={data} />
    </div>
  );
}

function ShellFooter({ data }: { data: SnowpackData | null }) {
  const warnings = data?.warnings ?? [];
  return (
    <footer className="shell__footer">
      <p>
        Source: USDA NRCS SNOTEL &middot; KSL Utah Snowpack Totals &middot; Water year Oct 1 &ndash;
        Sep 30
      </p>
      {warnings.length > 0 && (
        <details className="shell__warnings">
          <summary>
            {warnings.length} data warning{warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </footer>
  );
}
