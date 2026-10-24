# utahsnowpack

A modern dashboard for Utah snowpack, using the same data as
[ksl.com/weather/snowpack](https://www.ksl.com/weather/snowpack): SNOTEL
network readings — SWE, water-year precipitation, and percent-of-average across
Utah's 8 major basins and their 206 reporting sites. (The official SNOTEL
feeds are dead; KSL's server-rendered page is our validated live source — see
[docs/data-sources.md](docs/data-sources.md).)

## Why

KSL's page is a static snapshot: a JPEG map, 8 collapsible tables, no history,
no interactivity. This project rebuilds it as a live, interactive dashboard:

- **Interactive map** — vector basins colored by SWE % of average (same 6-band legend as KSL)
- **Site detail** — elevation, SWE, SWE avg, % avg, water-year precip, precip avg, % avg, data-quality flags
- **Time series** — SWE and precipitation across the water year (Oct 1 – Sep 30)
- **Always current** — automated daily refresh of SNOTEL data with staleness indicators

## Status

Tasks 1–2 of [docs/PLAN.md](docs/PLAN.md) done:

- App scaffolded (Vite + React + TypeScript in a pnpm workspace), toolchain
  green (ESLint, Prettier, Vitest), CI runs lint + test + build, dashboard
  shell renders the loading screen.
- **Data source validated** (the plan's main risk): the official SNOTEL feeds
  are dead, so the pipeline fetches KSL's server-rendered snowpack page. The
  fetcher (`pipeline/`) currently retrieves **206/206 roster sites (100%)**
  from the live page. Full decision record: [docs/data-sources.md](docs/data-sources.md).

`data/ksl-baseline-2026-10-24.json` is a captured copy of the KSL page (all 8
canonical basins, 206 sites, legend, last-updated stamp) used as the parity
reference for testing. Note: KSL's live page currently groups the same 206
sites under 16 sections; the pipeline records KSL's section names verbatim and
maps to the canonical 8 basins via the baseline roster.

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
pnpm fetch:dry        # fetch live KSL page → data/raw/ (gitignored), validates coverage
```

`fetch:dry` accepts `--fixture <file>` to run offline against a captured page
(`data/fixtures/` holds the committed test fixture). It exits non-zero if the
page structure is unrecognizable or roster coverage drops below 95%
(see [docs/data-sources.md](docs/data-sources.md)).

CI (`.github/workflows/ci.yml`) runs the same `pnpm lint && pnpm test &&
pnpm build` on every PR and main push, and uploads `app/dist` as an artifact.

## Layout

```
app/        Vite + React + TypeScript dashboard (src/, dist/ is the build)
pipeline/   data pipeline: KSL fetcher/parser, coverage gate, tests
data/       committed baselines + fixtures; generated raw/ output is gitignored
docs/       spec, plan, data-source research (data-sources.md)
```

Workflows: `ci.yml` (lint + test + build on every PR/push) and
`probe-data-sources.yml` (manual dispatch; re-probes SNOTEL/KSL/ACIS
reachability from a US datacenter and uploads raw responses).
