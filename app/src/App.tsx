/**
 * Dashboard shell. The map, detail panel, and charts arrive with the data
 * pipeline (docs/PLAN.md tasks 2-5 + 6-9); until snowpack.json exists the
 * app shows the loading state instead of a blank page.
 */
export default function App() {
  return (
    <div className="shell">
      <header className="shell__header">
        <h1>Utah Snowpack</h1>
        <p className="shell__subtitle">
          SNOTEL SWE &amp; water-year precipitation across Utah&rsquo;s 8 major basins
        </p>
      </header>
      <main className="shell__main" aria-busy="true">
        <div className="spinner" aria-hidden="true" />
        <p role="status">Loading data…</p>
      </main>
      <footer className="shell__footer">
        <p>
          Source: USDA NRCS SNOTEL &middot; 206 reporting sites &middot; Water year Oct 1 &ndash;
          Sep 30
        </p>
      </footer>
    </div>
  );
}
