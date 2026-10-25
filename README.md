# utahsnowpack

A modern dashboard for Utah snowpack, using the same data as
[ksl.com/weather/snowpack](https://www.ksl.com/weather/snowpack): SNOTEL
network readings — SWE, water-year precipitation, and percent-of-average across
Utah's 8 major basins and their 148 stations.

**Live site:** <https://tragdor85.github.io/utahsnowpack/>

This is an **unofficial** dashboard. It is not affiliated with or endorsed by
KSL, the NRCS, or the USDA. The data comes from their public pages and APIs —
see [docs/data-sources.md](docs/data-sources.md) for the full provenance and
decision record.

## What you get

- **Interactive map** — basin regions colored by SWE % of average (KSL's
  7-band legend), site markers, click to drill in
- **Basin & site detail** — the exact figures KSL shows (elevation, SWE, SWE
  avg, % avg, water-year precip, precip avg, % avg, data-quality flags,
  `-M` for missing), plus basin rollups
- **Time series** — SWE and daily precipitation across the water year
  (Oct 1 – Sep 30), with multi-year context on demand
- **Always current** — a daily pipeline refreshes the data; the site shows how
  old the data is and falls back to the last good snapshot if the live copy is
  unreachable

## Data sources

| Source                                                                    | Role                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [KSL snowpack page](https://www.ksl.com/weather/snowpack)                 | Every displayed value (the official SNOTEL feeds are dead; KSL's server-rendered page is the validated live source) |
| [WCC Utah SNOTEL report](https://wcc.sc.egov.usda.gov/ut-snotel-report/)  | Independent cross-check: station roster, reporting status, basin index                                              |
| [WCC AWDB API](https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data) | Daily SWE/precipitation history for charts                                                                          |

The pipeline reconciles KSL and WCC on every run: stations that appear in one
source but not the other (or disagree on reporting status) become warnings in
the data file rather than silent drops, and the station registry
(`data/sites.json`) is the single source of truth for names, elevations, and
basin assignments — drift surfaces as warnings for review, never silent
re-matching.

## How the data stays fresh

A GitHub Actions workflow (`.github/workflows/daily-data.yml`) runs daily at
18:30 UTC (after KSL's post-report render): fetch KSL + WCC + AWDB, validate
(coverage ≥ 95%, unrecognizable pages fail the run), build
`data/snowpack.json` + `data/timeseries.json` + the share-card image, and
commit the results. The deploy workflow
(`.github/workflows/deploy.yml`) rebuilds and republishes the site on every
main push, so each day's data lands on the live site automatically.

The site displays the data's `fetchedAt` as a freshness badge (fresh / stale
after 36 h / very stale after 72 h) and, if the live JSON is unreachable,
serves the last committed snapshot with a warning banner.

## Build & run

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io) (the pinned
version is in `packageManager`; `corepack enable` or `npm i -g pnpm`).

```sh
pnpm install          # install all workspace deps
pnpm dev              # dev server (http://localhost:5173)
pnpm lint             # ESLint
pnpm test             # Vitest (app/ + pipeline/)
pnpm build            # type-check + production build → app/dist
pnpm preview          # serve the production build locally
pnpm test:e2e         # Playwright end-to-end tests (built app)
```

Data pipeline (run locally):

```sh
pnpm fetch:dry        # fetch live sources → data/raw/ (gitignored), validate coverage
pnpm fetch:all        # fetch KSL + WCC + AWDB (best-effort) → data/fixtures/
pnpm build:snowpack   # normalize → data/snowpack.json
pnpm build:timeseries # normalize → data/timeseries.json
pnpm build:og-image   # render the share card → data/og-image.png
```

`fetch:dry` / `fetch:all` accept `--fixture <file>` to run offline against
captured pages (`data/fixtures/` holds the committed fixtures;
`pipeline/test/fixtures/` holds pinned historical pairs for regression
tests). `fetch:all` exits non-zero if the KSL or WCC report is unreachable or
unrecognizable; AWDB failure is best-effort (the history charts degrade, the
snapshot still ships).

## Adding a basin or a site

- **New site:** add it to `data/sites.json` (triplet, name, elevation, basin,
  and any `kslAliases` needed to match KSL's rendering). The next pipeline run
  will pick it up; if KSL and WCC disagree about it, you'll get a warning.
- **New basin:** add a `Basin` entry to `data/sites.json` and assign sites to
  it; add the polygon to `app/src/data/basins.ts` (the map's display shape —
  approximate is fine, the registry is the source of truth). Rollups, the
  list, and the map pick it up automatically.

## Layout

```
app/        Vite + React + TypeScript dashboard (src/, dist/ is the build)
pipeline/   data pipeline: fetchers, parsers, normalizer, reconciliation, tests
data/       sites.json (registry), snowpack.json, timeseries.json, og-image,
            fixtures/ (committed, updated daily); raw/ + generated/ gitignored
docs/       SPEC.md, PLAN.md, data-sources.md (provenance + decision record)
```

Workflows: `ci.yml` (lint + test + build + e2e on every PR/push),
`daily-data.yml` (the daily data run), `deploy.yml` (GitHub Pages), and
`probe-data-sources.yml` (manual dispatch; re-probes SNOTEL/KSL/ACIS
reachability from a US datacenter).

## License

Code: [MIT](LICENSE). Data: © its respective sources (KSL, NRCS/USDA); used
here for personal, non-commercial purposes with attribution.
