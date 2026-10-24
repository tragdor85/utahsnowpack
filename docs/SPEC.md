# Spec — Utah Snowpack Dashboard

## The one-paragraph spec

Build a modern, live, interactive dashboard of Utah snowpack that reproduces the
data behind [ksl.com/weather/snowpack](https://www.ksl.com/weather/snowpack)
(SWE, water-year precipitation, and percent-of-average for the 8 major basins
and their 206 NRCS SNOTEL sites) but renders it as an interactive vector map
with per-basin and per-site drill-down, historical time series across the water
year (Oct 1 – Sep 30), automated daily data refresh, and mobile-friendly,
accessible, dark-mode UI — deployed as a static site with a small data pipeline.

## Data-source research (verified 2026-10-24)

What KSL actually does:

- The page is a **server-rendered React shell**. The basin tables are embedded
  in the HTML at render time; there is **no client-side snowpack API** (the only
  KSL API call is `news-api.ksl.com/v1/weather/getHeaderWeather`, which powers
  the header widget, not the basin data).
- Page meta description: *"Follow current Utah snowpack at KSL.com with SWE
  values, precipitation amounts, and percent of average across major basins from
  NRCS SNOTEL sites."* → **upstream = USDA NRCS SNOTEL network**.
- KSL shows: a map image (basins colored by SWE % of avg, legend 50-69 / 70-89 /
  90-109 / 110-129 / 130-149 / >150%), "Last Updated" stamp, and per-basin
  site tables with columns: Site, Elev (ft), SWE (in), SWE avg, SWE % avg,
  Water-year Precip (in), Precip avg, Precip % avg; flags `-M` (missing) and
  `*` (may not provide valid measure).
- Captured baseline (see `data/ksl-baseline-2026-10-24.json`): 8 basins —
  raft_river (230%), bear_river (84%), weber_ogden (191%), provo_river (220%),
  green_river/NE UINTAHS (40%), duchesne (194%), sevier_river/Upper Sevier
  (120%), beaver_river (73%) — totaling **206 sites**.

Machine-readable SNOTEL feed status (probed from dev machine, 2026-10-24):

| Candidate | Result |
|---|---|
| `www.nwpc.nws.noaa.gov` (NWPC Snow portal) | does not resolve (DNS) — re-verify from other networks |
| `www.snotel.gov` (NRCS SNOTEL) | does not resolve (DNS) — re-verify from other networks |
| `snotel.org` | Vercel domain live, root deployment 404 (stale project) |
| `dwr.utah.gov` (Utah DWR SNOTEL) | does not resolve (DNS) — re-verify |
| ACIS (`data.rcc-acis.org`) | API reachable; StnMeta SNOTEL queries not yet validated |
| `ksl.com/api/weather/snowpack` | returns 200 with empty body (not usable) |

**Decision:** the fetcher must be built around a *validated* public SNOTEL
endpoint (task 2 of the plan) and must be swappable — the pipeline consumes a
normalization layer, and a KSL-page parser exists as a guaranteed-parity
fallback. Whatever endpoint wins, the output contract is identical.

## Feature parity with KSL (required)

1. 8 basins with aggregate SWE % of average + color band.
2. All 206 sites with: name, elevation, SWE (in), SWE long-term avg, SWE % avg,
   water-year precip (in), precip avg, precip % avg, missing/invalid flags.
3. Legend: 6 bands (50-69, 70-89, 90-109, 110-129, 130-149, >150).
4. "Last updated" timestamp per data pull.
5. Water year semantics: Oct 1 – Sep 30.

## Modernization (beyond KSL)

- Vector interactive map (MapLibre GL) instead of JPEG; basins clickable.
- Per-site time-series charts (SWE + precip across the water year, and
  multi-year context if the endpoint provides history).
- Basin summary cards (total SWE in, equivalent water volume, trend).
- Stale-data indicators when a site hasn't reported.
- Dark theme, responsive, keyboard accessible, no third-party tracking.
- OG meta tags for sharing.

## Architecture

```
NRCS SNOTEL (or validated equivalent)
        │  daily cron (GitHub Actions) ~08:30 MDT, SNOTEL reports ~08:00
        ▼
  fetcher (Node/TS) ──► normalizer ──► data/snowpack.json  (git-pushed)
                                         │
                                         ▼
        Vite + TS static site (map + cards + charts, client-side fetch)
        deployed to GitHub Pages / Cloudflare Pages
```

- Pure static deploy: JSON is a build/deploy artifact, so the site works with
  zero backend and instant freshness after each CI run.
- Client fetches `snowpack.json` (with last-modified caching + fallback to the
  last built-in copy) so a broken deploy never blanks the page.
- Normalization is the stable seam: swap sources without touching the UI.

## Non-goals

- No account system, no ad stack, no cookie consent (it's a data dashboard).
- Not a forecast engine — SWE/precip observations only (model data later).
- No re-implementation of KSL's exact visual design; "same data, better UI".
