# utahsnowpack

A modern dashboard for Utah snowpack, using the same data sources as
[ksl.com/weather/snowpack](https://www.ksl.com/weather/snowpack): the **USDA NRCS
SNOTEL** network — SWE, water-year precipitation, and percent-of-average across
Utah's 8 major basins and their 206 reporting sites.

## Why

KSL's page is a static snapshot: a JPEG map, 8 collapsible tables, no history,
no interactivity. This project rebuilds it as a live, interactive dashboard:

- **Interactive map** — vector basins colored by SWE % of average (same 6-band legend as KSL)
- **Site detail** — elevation, SWE, SWE avg, % avg, water-year precip, precip avg, % avg, data-quality flags
- **Time series** — SWE and precipitation across the water year (Oct 1 – Sep 30)
- **Always current** — automated daily refresh of SNOTEL data with staleness indicators

## Status

Task 1 of [docs/PLAN.md](docs/PLAN.md) done: app scaffolded (Vite + React +
TypeScript in a pnpm workspace), toolchain green (ESLint, Prettier, Vitest),
CI runs lint + test + build, and the dashboard shell renders the loading
screen. Next: task 2 — validate the SNOTEL data endpoint.

`data/ksl-baseline-2026-10-24.json` is a captured copy of the KSL page (all 8
basins, 206 sites, legend, last-updated stamp) used as the parity reference for
testing.

## Build & run

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io) (the pinned
version is in `packageManager`; `corepack enable` or `npm i -g pnpm`).

```sh
pnpm install          # install all workspace deps
pnpm dev              # dev server (http://localhost:5173)
pnpm lint             # ESLint
pnpm test             # Vitest (runs in app/)
pnpm build            # type-check + production build → app/dist
pnpm preview          # serve the production build locally
```

CI (`.github/workflows/ci.yml`) runs the same `pnpm lint && pnpm test &&
pnpm build` on every PR and main push, and uploads `app/dist` as an artifact.

## Layout

```
app/        Vite + React + TypeScript dashboard (src/, dist/ is the build)
data/       captured baselines; generated snowpack.json + raw/ are gitignored
docs/       spec, plan, data-source research
```
