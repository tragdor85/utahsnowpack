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

Early planning stage. See [docs/SPEC.md](docs/SPEC.md) for the specification and
[docs/PLAN.md](docs/PLAN.md) for the task breakdown.

`data/ksl-baseline-2026-10-24.json` is a captured copy of the KSL page (all 8
basins, 206 sites, legend, last-updated stamp) used as the parity reference for
testing.

## Layout

```
data/       captured baselines + generated snowpack.json (gitignored when generated)
docs/       spec, plan, data-source research
src/        (planned) Vite + TypeScript app: map, charts, data layer
```
