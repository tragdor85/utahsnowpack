# Plan — Utah Snowpack Dashboard

Each task is sized 1–4 agent turns. Critical path: **2 → 3 → 4 → 5** (data
pipeline) can run in parallel with **6–8** (UI on mock data). Task 2 is the
main risk — see "Risk notes".

## Task 1 — Scaffold app + toolchain (est. 1–2 turns) — ✅ done (2026-10-24, `a83f4e6`)

Create the application skeleton: pnpm workspace, Vite + TypeScript, Vitest,
ESLint/Prettier, GitHub repo push, CI (lint + test + build on PR), and a
minimal dashboard shell that renders a "Utah Snowpack — loading data" screen.

- **Accept:** `pnpm lint && pnpm test && pnpm build` green locally _and_ in CI;
  `dist/index.html` serves the shell; README build/run steps verified.

## Task 2 — Validate the SNOTEL data endpoint (est. 3–4 turns, RISK) — ✅ done (2026-10-24/25, `de8adab`…`4949146`)

From multiple network contexts, test the public SNOTEL feeds (NRCS SNOTEL
station data, NWPC snow portal, Utah DWR, ACIS `data.rcc-acis.org`) for:
reachability, element availability (SWE in, precip, normals), update cadence
(~08:00/20:00 local reports), and coverage of the 206-site roster. Pick the
primary source; record the exact endpoints, parameters, and auth (if any) in
`docs/data-sources.md`; write a raw-fetch stub (`fetch:snotel`) with fixtures.

- **Accept:** `pnpm fetch:dry` downloads real data for ≥95% of roster sites into
  `data/raw/` fixtures, with a written decision record for the chosen source and
  documented fallback (KSL page parser) if the official feed is flaky.

## Task 3 — Site registry: KSL sites → SNOTEL IDs (est. 2–3 turns) — ✅ done (2026-10-25)

Build `data/sites.json`: for all 206 KSL sites (from
`data/ksl-baseline-2026-10-24.json`), resolve the NRCS SNOTEL station ID,
lat/lon, elevation, and basin membership by matching the SNOTEL station catalog
(name + basin + elevation). Output an unmatched/ambiguous list for manual review.

- **Accept:** 100% of KSL site names resolved or explicitly flagged; registry
  validates against a schema test; coordinates plot within their basins on a
  quick map check.

## Task 4 — Normalizer + snowpack.json contract (est. 2–3 turns) — ✅ done (2026-10-25, `d37ebe8`)

Define the canonical output schema (`data/snowpack.json`: basins → sites, SWE
in, water-year precip in, long-term averages, % of average, `-M`/`*` flags,
`lastUpdated`) and write the normalizer with unit tests. Compute basin rollups
and the 6-band color class the same way KSL does.

- **Accept:** parity test against the captured KSL baseline (2026-10-24) passes
  for all 8 basin % values and ≥95% of site values (tolerance: 1 pt / 0.1 in);
  schema + normalization tests green.

## Task 5 — Daily data pipeline (est. 1–2 turns) — ✅ done (2026-10-25, `e2c3413`)

GitHub Actions workflow: daily cron and `workflow_dispatch` — fetch →
normalize → commit `snowpack.json` + raw captures (the deploy workflow,
task 11, redeploys on main pushes). The cron runs **18:30 UTC**
(10:30 MST / 11:30 MDT): the SNOTEL report lands 08:00 Mountain, but the
KSL page re-renders on its own schedule (observed ~02:15 pre-report and
~10:10 post-report), so fetching earlier captures a stale pre-report page.
`cancel-in-progress: false` — a run must finish its commit or fail.

**Landed 2026-10-25:** `fetch:all` (KSL + WCC report required — fail loudly,
nothing written; station catalog best-effort) writes date-stamped captures
to the now-committed `data/fixtures/`; `data/snowpack.json` is committed too.
Investigating the first live run corrected two Task-4 assumptions: the WCC
report lists **every** station (`-M` for non-reporters), so `reportedToday`
now means _SWE non-missing in WCC_; and the report's `Basin Index (%)` rows
are parsed and cross-checked against our rollups, alongside an aggregate
out-of-sync warning that surfaces a stale KSL page (the 2026-10-25 capture
is exactly that scenario: 9 warnings, null rollups — all visible, nothing
silently dropped).

- **Accept:** one `workflow_dispatch` run end-to-end updates the committed
  JSON (deploy wiring lands with task 11); failed runs are logged visibly.

## Task 6 — UI shell + design system (est. 1–2 turns) — ✅ done (2026-10-25, `5b12b6b`)

Dark-themed responsive layout (header w/ last-updated + water-year banner,
legend, main map area, side detail panel) + design tokens (colors incl. the 7
KSL legend bands + `none`, type scale, spacing). Renders with a mock
`snowpack.json` (tests) and the real one in dev/build (copied from
`data/` by `app/scripts/copy-snowpack.mjs`).

**Landed 2026-10-25:** `app/src/types.ts` mirrors the pipeline contract
(kept in sync by schema tests on both sides); `COLOR_BAND_META` + the
`.band-chip--<band>` tokens carry KSL's exact palette (captured from the
page's own `<style>` block — the plan's "6 bands" is 7: red/orange/yellow/
green/blue1/blue2/blue3, plus our `none`). Components: `Header` (water-year
badge + both source stamps), `Legend`, `BasinList` (8 keyboard-navigable
basin buttons — the map-area stand-in task 7 replaces), `DetailPanel`
(rollup + per-site table, flags as `*` with tooltips, horizontal scroll
contained in a wrapper). Playwright e2e (`app/e2e/layout.spec.ts`) asserts
the 1280 and 390 layouts against the mock — legend colors, geometry,
no overflow, tab order — and runs in CI after the unit tests.

- **Accept:** desktop (1280) and mobile (390) layouts render mock data with
  correct legend bands; keyboard tab order works; screenshot test committed.

## Task 7 — Interactive basin map (est. 3–4 turns) — ✅ done (2026-10-25, `5bec291`)

MapLibre GL basemap (no tracking, offline-capable tiles) with the 8 basin
polygons, colored by SWE % band, click/keyboard selection, hover tooltips,
and site dots.

- **Accept:** all 8 basins render with colors matching the KSL bands for
  baseline data; selecting a basin updates the detail panel; works with zero
  third-party network calls beyond tiles (and degrades gracefully without).
- **Impl:** `app/src/data/basins.ts` — 8 basin polygons (padded convex hulls
  of the registry site coordinates, clipped to the Utah display box; the
  registry, not the map, is the source of truth — polygons are approximate
  display shapes and may overlap). `app/src/map/layers.ts` — pure GeoJSON
  builders (`basinFeatures`, `siteFeatures`) + `BAND_COLORS` (hex literals
  for MapLibre paint expressions; the `--band-*` tokens remain the DOM source
  of truth). `app/src/components/BasinMap.tsx` — MapLibre GL map: CARTO dark
  raster basemap (3 subdomains, no key), basin fill/line layers, site dots
  (reported vs not), hover tooltips, click selection + fitBounds, WebGL
  fallback message. Layers are added on `style.load` (not `load`, which is
  gated on the network tiles); the worker URL is set explicitly because Vite
  inlines the worker module (`?url` import of the emitted asset). The basin
  list stays alongside the map for keyboard selection; both drive the same
  selection state. Mock basin ids/names corrected to the canonical registry
  values. e2e: canvas renders sized, clicking the DUCHESNE polygon selects
  it; unit: layer builders + polygon bounds.

## Task 8 — Basin/site detail panel (est. 2–3 turns) — ✅ done (2026-10-25, `e520f23`)

Detail panel parity with KSL: site table (Site, Elev, SWE, Avg, % Avg, Precip,
Avg, % Avg) with `-M`/`*` flags, per-basin summary card (sites reporting,
aggregate SWE, trend arrow), search/filter, sticky header, sorted by elevation.

- **Accept:** column-for-column parity with the captured KSL baseline;
  a11y: tables announced, flags exposed via aria-label; passes axe checks.

Done: parity verified cell-by-cell against the 10-24 capture (192 of 194
matched sites; the 2 exceptions are KSL's own column-shift bug; all 8 basin
rollups identical to KSL's). The plan's "trend arrow" is covered
by the band-colored rollup (no multi-year history exists yet; task 9 adds it).
E2E includes a real-data parity test re-deriving every cell from the served
snowpack.json, so daily pipeline updates stay in lockstep with the UI.

## Task 9 — Time-series charts (est. 3–4 turns) — ✅ done (2026-10-25)

Per-site SWE area chart + water-year precip bar/area chart; basin aggregate
line; multi-year context if the endpoint provides history; chart theming +
touch/keyboard interaction.

Data side: AWDB daily series source → committed `timeseries.json` (shared date
axis, per-station arrays, ~24KB) + daily pipeline step; client fetches full
monthly history on demand for the multi-year toggle (cached in memory).

- **Accept:** real-data charts render for every basin and ≥5 sample sites, with
  empty-state handling for sites missing history.

Done: basin aggregate + per-site charts (Recharts, dual y-axes, themable
tokens), multi-year monthly-history toggle, empty/loading/unavailable states,
keyboard row selection, e2e + axe coverage. Charts degrade to a note when the
timeseries file is missing; the dashboard never blocks on it.

## Task 10 — Freshness, resilience, shareability (est. 1–2 turns)

"Last updated" display with relative time + staleness badges (per site and
global), client fallback to the last bundled `snowpack.json` on fetch failure,
OG/Twitter meta tags, favicon + PWA manifest.

- **Accept:** with network blocked, the page still serves the last good data
  with a visible "data from <date>" warning; og:image renders the current map.

## Task 11 — Deploy + end-to-end parity (est. 2–3 turns)

Deploy static site (GitHub Pages or Cloudflare Pages) + wire the pipeline to it;
final live check of the deployed dashboard against the live KSL page; README
final pass (source attribution, data license, how to add basins/sites).

- **Accept:** public URL live; every basin % and ≥95% of site values on the
  live site match live KSL within tolerance on the same day; docs current.

---

## Risk notes

- **R1 (Task 2) — official SNOTEL endpoints unverified from this machine.**
  `snotel.gov`, `dwr.utah.gov`, and NWPC domains didn't resolve here (2026-10-24);
  they may be region-restricted or renamed. Mitigation: probe from a second
  network (phone/VPN) before committing to a source; the KSL-page parser is a
  guaranteed fallback because it reads _the exact same numbers_ KSL publishes
  (KSL's upstream is NRCS SNOTEL — scraping KSL is same-data, not a re-source).
- **R2 — station ID mapping (Task 3).** Names like "Bear River RS" / "Kelley R.S."
  may not 1:1 with catalog names; mitigation: elevation + basin disambiguation,
  manual review list, and a pinned mapping file (never auto-rematched).
  **Landed 2026-10-25:** the registry resolved 100% of the baseline (148 unique
  stations; the only same-named set was Chepeta ×3, disambiguated by
  active/SNTL/elevation); the two KSL cell-shift quirks and the catalog's
  double-space name needed explicit reconstruction rules; `data/sites.json` is
  pinned and reproduces from committed fixtures (test-enforced).
- **R3 — normals basis.** "% of average" must use the same normals period KSL
  uses (long-term, site-specific); if the SNOTEL feed's normals differ, document
  the basis in the UI and keep the parity test as the arbiter.
- **R4 — basin polygons.** KSL's map is a hand-drawn JPEG with no published
  GeoJSON; if NHD boundaries don't align with KSL's 8 basins, trace simplified
  polygons from their map (acceptable: they're illustrative, data is per-site).
