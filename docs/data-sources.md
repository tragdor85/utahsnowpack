# Data sources — decision record

_Task 2 of `docs/PLAN.md`. Written 2026-10-25. Re-verify by dispatching the
`probe-data-sources` workflow (second network context) and re-running
`pnpm fetch:dry`._

## Decision

**Primary source: KSL's snowpack page** — `https://www.ksl.com/weather/snowpack`
(server-rendered HTML tables). Fetched with one plain HTTPS GET; no auth, no
API key. Already implemented, matches the baseline roster exactly, and is the
simplest to fetch.

**Fallback source: the USDA Water & Climate Center (WCC) SNOTEL report** —
`https://wcc.sc.egov.usda.gov/reports/UpdateReport.html?report=Utah&format=SNOTEL+Snowpack+Update+Report`.
This is the **official, upstream** feed: it is the same NRCS SNOTEL data KSL
republishes (SWE values match KSL exactly), and it is fresher (first reading of
the day, 00:00, vs. KSL's ~10:10 am stamp). Validated 2026-10-24 from both the
local machine and a GitHub runner — see the WCC section below.

Clarification of the task 2 record: the SNOTEL **brand** hostnames
(`snotel.gov`, NWPC, DWR's snow page) do not resolve from any network context
tested (see evidence) — the consumer portal is decommissioned. But the
**underlying data center** (WCC, on the general USDA `sc.egov.usda.gov` host)
is alive and serves the full report, so there **is** now a reachable official
fallback. The plan anticipated "official feed with the KSL page parser as
documented fallback"; validation landed on **KSL primary + WCC fallback**
(independent failure modes: commercial media vs. government). WCC is a strong
candidate for _primary_ if KSL ever fails; it is not implemented yet (see
"WCC — implementation notes").

## Evidence

Tested from two independent network contexts on 2026-10-24/25:

1. Local development machine (residential, US).
2. GitHub Actions `ubuntu-latest` runner (US datacenter) via the
   `probe-data-sources` workflow (run 40111650005; raw responses captured as
   artifacts).

| Candidate                          | Local                                     | GH runner                               | Roster coverage                                            | Needed elements                                                                                            | Auth                 |
| ---------------------------------- | ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| **KSL** `ksl.com/weather/snowpack` | 200, 166,762 B                            | 200, byte-identical                     | **206/206 (100%)**                                         | SWE, SWE avg, SWE % avg, precip, precip avg, precip % avg, elev, flags, Last Updated — all present per row | none                 |
| `snotel.gov` / `www.snotel.gov`    | DNS fail                                  | 000 (DNS fail)                          | —                                                          | —                                                                                                          | —                    |
| `snotel.sc.egov.usda.gov`          | DNS fail                                  | 000 (DNS fail)                          | —                                                          | —                                                                                                          | —                    |
| `nwpc.nws.noaa.gov`                | DNS fail                                  | 000                                     | —                                                          | —                                                                                                          | —                    |
| `dwr.utah.gov`, `snow.utah.gov`    | DNS fail                                  | 000                                     | —                                                          | —                                                                                                          | —                    |
| `nrcs.usda.gov` (main site)        | 200                                       | 200                                     | no SNOTEL feed exposed (checked paths 404)                 | —                                                                                                          | —                    |
| ACIS `data.rcc-acis.org`           | 200                                       | 200                                     | SNOTEL stations **not** indexed (0 hits)                   | swv/pcpn only for NWS/coop stations                                                                        | none                 |
| **WCC** `wcc.sc.egov.usda.gov`     | 200, 421,327 B (3× identical, no CAPTCHA) | 200, 421,327 B (explicit 2-step follow) | **203/207 (98%)** by normalized name — clears the 95% gate | SWE, today's median SWE, median peak SWE + dates, % of median — **no precipitation column**                | session (JSESSIONID) |

DNS failures are real (resolver `Errno 8`, not a local quirk): the SNOTEL
hostnames fail identically from the local machine and the US runner, matching
the SPEC's 2026-10-24 finding. Treat the official SNOTEL portal as
decommissioned until the probe workflow says otherwise.

### KSL page structure (as observed)

- Page renders **16 basin sections**, each a bold header (e.g. `DUCHESNE`)
  followed by an 8-column table:
  `Site | Elev | SWE | Avg | % Avg | Precip | Avg | % Avg`.
- Site rows are `<tr class="highlight">` with eight `<td>` cells; there are
  exactly **206** such rows (matches the baseline roster).
- `Last Updated: <strong>10:10am Sat 24 October 2026</strong>` — the upstream
  SNOTEL report stamp (KSL's page says the data comes from the Utah DWR SNOTEL
  report).
- Flags appear inside cells (e.g. `*`, `120*`).
- The 8 non-empty sections of the 2026-10-24 baseline are all present; KSL
  additionally renders 8 sections that were empty in the baseline (TOOELE,
  PRICE-SAN RAFAEL, DIRTY DEVIL, SE UTAH, SAN PITCH, LOWER SEVIER, ESCALANTE,
  SW UTAH — 75 rows). **Between the 10-24 capture and the 10-25 re-check, KSL
  re-grouped rows between sections** (e.g. the DUCHESNE family shrank 50→38,
  SE UTAH appeared with 12 rows). All 206 site values were still
  value-identical to the baseline. The pipeline stores KSL's current section
  names verbatim; mapping sites to the canonical 8 basins (parity task 4) is
  keyed on the baseline roster, not on section names.

### Why KSL wins

1. **Reachable everywhere tested** — the only candidate that works from both
   the dev machine and CI; the official feeds fail DNS in both.
2. **100% roster coverage by construction** — it renders exactly the 206
   sites in the baseline roster.
3. **Every needed element in one fetch**, including the % against the _same_
   SNOTEL long-term averages KSL uses — trivially resolves risk R3 (normal
   reference mismatch) and the parity goal in task 4.
4. Byte-identical responses across contexts — no regional content variation
   observed.

### WCC — the official upstream (validated fallback)

The USDA Water & Climate Center report is where SNOTEL data actually lives.
Investigated 2026-10-24 (fetched 3× locally + once from a GitHub runner; all
HTTP 200, identical 421,327-byte bodies, no CAPTCHA/bot wall).

- **Reachable & durable**: `wcc.sc.egov.usda.gov` is the general USDA
  `sc.egov.usda.gov` data host (not one of the dead SNOTEL brand hosts), so it
  resolves normally and is government infrastructure — a far more durable
  failure mode than KSL's commercial page.
- **Official & upstream**: header reads "Based on Mountain Data from NRCS
  SNOTEL Sites." It is the same data KSL republishes — spot-checked SWE matches
  KSL exactly (Howell Canyon 1.1, George Creek 1.2, Tony Grove 0.0, Emigrant
  Summit 0.1, …). The only differences are display formatting (WCC `0.0` vs.
  KSL `.0`; WCC `1.0 (10)` vs KSL `1.0`) and station-name conventions.
- **Fresher**: "Data based on the first reading of the day (typically 00:00)
  for Saturday, October 24, 2026" — earlier than KSL's ~10:10 am stamp.
- **How to fetch**: the first request 302-redirects to
  `...UpdateReport.html;jsessionid=XXX?...` (Java URL-rewriting, behind an AWS
  ALB) and sets `JSESSIONID` + `AWSALB` sticky-session cookies. Use a
  browser-like `User-Agent`. **Follow the redirect explicitly** — a separate
  request to the `Location`, carrying the cookie jar — rather than relying on
  `curl -L`; the auto-follow can return an **empty** body across the ALB. This
  two-step fetch returned the full 421,327 B from both the local machine and
  the GitHub runner. Encoding is `ISO-8859-1` (latin-1).
- **Structure**: one table `id="update_report_data"` (243 rows) with 17 basin
  groups and **207 site rows** (8 cells: site, elev ft, SWE in, today's median
  SWE in, median peak SWE in, median peak date, % of today's median, % of
  median peak). Basin names are long official names (`NORTHEASTERN UINTAHS`,
  `BEAR RIVER (UPPER)`); a separate index table gives 17 basin SWE/peak/percent
  totals. No per-row links, row ids, or station IDs in the markup — join key is
  the site name.
- **Name conventions differ from the baseline**: WCC uses hyphens and short
  suffixes (`Hole-in-Rock`, `Mill-D North`, `Rocky Basin-Settleme`, `Chepeta`,
  `EF Blacks Fork GS`), the baseline uses KSL's (`Hole in Rock`, `Mill D North`,
  …). Aggressive normalization (lowercase, strip all non-alphanumerics) matches
  **203/207**; the 4 residual mismatches are suffix/notation variants (`Chepeta`
  ×2 vs `Chepeta M`, `EF Blacks Fork GS` vs `EF Blacks Fork`, `Takka Wiiya`).
  A small mapping table (or prefix match) closes the gap to ~100%.
- **Gaps vs KSL**: no precipitation column (KSL has 3 precip cells; the baseline
  records them); some station names appear in multiple basins (e.g. `Trial
Lake` ×4), so name joins should carry the basin for disambiguation.
- **Implementation status**: implemented in `pipeline/src/sources/wcc.ts`
  (2026-10-25) — `fetchWccReport` (two-step jsessionid follow, latin-1
  decode) and `parseWccReport` (17 groups / 207 rows), plus
  `fetchWccStations` for the station catalog API below. Used by the site
  registry builder (`pnpm build:registry`); the automatic KSL→WCC fallback in
  `fetch.ts` is still not wired (task 5 territory).

### WCC — the station catalog (AWDB REST API)

`GET https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations` returns
JSON station metadata — discovered 2026-10-25 by mining the new WCC site's JS
bundle (the site is mid-migration; the homepage was erroring, but the report
and this API work). Query params: `stationNames=a,b,c` (comma-batched, exact
match, **whitespace-sensitive**), `activeOnly=false` to include
decommissioned stations. Each entry carries `stationId`, `stateCode`,
`networkCode` (SNTL/SNTLT/SNOW/MPRC/…), `name`, `elevation` (ft),
`latitude`/`longitude`, `beginDate`/`endDate` (`2100-01-01` = active),
`countyName`, `huc`. A single plain request works — no session dance. This is
what turns a station **name** into a station **ID** with coordinates:
the join key for everything downstream (task 3's registry, and later the
SNOTEL daily data fetch, which is keyed by `stationId:stateCode:networkCode`.
)

### The site registry (`data/sites.json`)

`pnpm build:registry` (offline: `--fixture data/fixtures`) builds the pinned
site registry from three inputs: the committed KSL baseline roster, the WCC
report (cross-check), and the station catalog (metadata). Matching is
normalized-name (lowercase, strip non-alphanumerics) with preference scoring
(active +4, SNTL network +2, elevation within 10 ft +1); ties are flagged
ambiguous, never guessed.

Result for the 2026-10-24 baseline: **206 rows → 191 unique (site, basin)
pairs → 148 unique stations, 100% resolved** (147 SNTL + 1 SNTLT; 138 UT,
7 ID, 3 WY stations — KSL's roster includes a few out-of-state sites in its
Utah basins). Two KSL display quirks required reconstruction: `EF Blacks
Fork` + `GS` (name tail shifted into the elev cell) and `Chepeta M` (missing
data flag appended to the name; the elev cell holds a shifted SWE value).
The catalog stores `Smith  Morehouse` with a double space, so the live
builder issues a first-token wildcard probe (`Smith*`) for any baseline name
the exact query misses. The KSL baseline also contains 15 fully duplicated
rows (same site listed twice in one section); the registry dedupes to unique
(stations, basin) membership.

The file is **pinned, not auto-rematched** (risk R2): re-running the build
against the committed fixtures reproduces it byte-for-byte (modulo the
generated timestamp — enforced by test), and live drift surfaces as
`unmatched`/`ambiguous`/`warnings` entries for review. Acceptance checks in
`pipeline/test/sites.test.ts`: schema validation, full baseline coverage,
catalog membership, and a leave-one-out convex-hull **map check** (each site
must sit within its basin's other sites, tolerance scaled to basin extent —
catches a station mis-resolved to a far-away same-named station).

### The normalizer (`data/snowpack.json`)

`pnpm build:snowpack` (offline against the committed fixtures) turns the two
raw snapshots plus the pinned registry into the canonical `data/snowpack.json`
(contract in `pipeline/src/schema.ts`, `schemaVersion: 1`). Source roles:

- **KSL** supplies every displayed value — SWE, averages, % of average, and
  water-year precip, which the WCC report does not carry. Values are taken
  verbatim after undoing KSL's two cell-shift display quirks
  (`reconstructKslRow` in `pipeline/src/normalize.ts`):
  - _name-overflow_: a non-numeric elev cell is the name's tail
    ("EF Blacks Fork" + "GS"); the last cell (precip % avg) is dropped.
  - _flag-shift_: a trailing M/-M/* flag on the name plus k trailing empty
    filler cells means SWE (and, for k ≥ 2, the elevation) was dropped and
    the remaining cells shifted left. k=2 is the only shape observed
    ("Chepeta M"); other k values reconstruct but emit a warning.
- **WCC** supplies _reported-today_: the report lists **every** station in
  the network — including ones that did not report (their SWE cell is `-M`,
  e.g. 5 of 149 on 2026-10-24, 7 of 149 on 2026-10-25) — so _presence alone
  says nothing_; reported-today means **SWE non-missing in the WCC report**.
  The basin rollup runs over the reported stations' KSL values. For every
  station that reported, the normalizer cross-checks KSL vs WCC SWE and
  SWE-avg (tolerance 0.05 in) and warns on disagreement; it also cross-checks
  each basin rollup against the report's own `Basin Index (%)` row (warns on
  a >2 pt divergence, or when the index exists but no rollup is computable)
  and warns — in one aggregate line, above a 10%/5-station threshold — when
  the sources disagree about _who_ reported (the signature of a stale KSL
  page; see the 2026-10-25 fixture test).

Basin rollup: `swePctAvg = round(100 × Σ SWE ÷ Σ SWE-avg)` over the basin's
reporting stations that have a non-null SWE **and** non-null SWE-avg — the
only of three candidate rules that reproduces all 8 baseline % values exactly
(verified 2026-10-24). `colorBand` uses KSL's legend (red <50, orange 50–69,
yellow 70–89, green 90–109, blue1 110–129, blue2 130–149, blue3 ≥150;
`none` when the rollup is null). Water year follows the standard convention
(WY N runs Oct 1 of N−1 to Sep 30 of N, so the Oct 24 2026 capture is WY2027).
Timestamps: the KSL stamp is America/Denver wall clock (re-anchored, DST-aware)
and the WCC report date is a calendar date; both are carried verbatim plus
parsed. Unresolvable rows, WCC rows outside the roster, multi-basin value
disagreements, and unverified row shapes land in `warnings` — never silently
dropped.

Parity (plan task 4 acceptance): against the captured 2026-10-24 baseline the
normalizer matches **all 8 basin % values and 1244/1244 site values (100%)**
— tolerance 1 pt / 0.1 in, enforced in `pipeline/test/normalize.test.ts`
(the baseline stores KSL's cells verbatim, so the test reconstructs the
baseline side too; the reconstruction itself is verified by the WCC
cross-check and the unit tests).

### Why the others lose

- **Official SNOTEL/NWPC/DWR brand portals**: unreachable (DNS) from both
  contexts — the _consumer_ sites are decommissioned. (Note this is distinct
  from WCC, which is alive — see above.) If `snotel.gov` comes back it becomes
  a _cross-check_ channel, not a replacement.
- **WCC**: not _lost_ — it is the validated fallback; it simply isn't the
  primary yet (KSL is simpler and already matches the baseline exactly).
- **ACIS** (`data.rcc-acis.org`): reachable, official NOAA, no auth — but
  SNOTEL stations are not indexed in its `StnMeta` under site names (0 hits
  for "SNOTEL" and for site names; `state=UT` returns 1351 NWS/coop/METAR
  stations only). Without a SNOTEL→WMO station-ID mapping there is no way to
  resolve the roster, and its normals reference would differ from SNOTEL's
  (R3). Rejected as primary; keep as a future spot-check if a sid mapping is
  obtained.

## How to fetch (implemented in `pipeline/`)

```
GET https://www.ksl.com/weather/snowpack
User-Agent: <browser-like UA>   # plain curl also works; UA set defensively
```

- Response is full HTML; parse the 16 sections and their
  `<tr class="highlight">` rows (see `pipeline/src/sources/ksl.ts`).
- Write the parsed rows verbatim (strings, as displayed) to
  `data/raw/ksl-<YYYY-MM-DD>.json` with metadata: source URL, `fetchedAt`,
  the page's `lastUpdated` stamp, section/row counts. (`data/raw/` is
  gitignored — generated output; committed test fixtures live in
  `data/fixtures/`.)

## Cadence

The SNOTEL network reports at 08:00 Mountain. The WCC daily report appears
shortly after. The KSL page re-renders on its own schedule — observed: a
~02:15 pre-report render and a ~10:10 post-report render (local wall clock),
so a fetch before ~10:10 Mountain captures a stale pre-report page (the
2026-10-25 capture: 133 of 148 registry stations still `-M`). Task 5's
daily pipeline therefore runs at 18:30 UTC (10:30 MST / 11:30 MDT — after
the ~10:10 render in either DST state) and the normalizer's warnings
(out-of-sync count, basin-index divergence, source-date mismatch) surface any
residual staleness in `snowpack.json` for the app's stamp (task 10).

## Fallbacks and robustness guards

There **is** now an official fallback — the WCC report (see above) — so the
strategy is: **fetch KSL; on a hard KSL failure (unreachable, redesign, or
coverage-gate trip), fall back to WCC.** The WCC fetch/parse module now exists
(`pipeline/src/sources/wcc.ts`, used by the registry builder); the automatic
fallback wiring in `fetch.ts` is not yet done, so until it lands the guard
below fails loudly. The KSL path keeps these guards:

1. **Structural guard**: no `Last Updated` stamp or no highlight rows → hard
   error (KSL redesign detected).
2. **Coverage gate**: parsed site count must cover ≥95% of the committed
   baseline roster (matched on normalized site names) or `fetch:dry` exits
   non-zero.
3. **Row sanity**: total rows outside 150–300 → warn in the report.
4. **Staleness**: `lastUpdated` older than 3 days → warn in the report.
5. **Re-verification**: `probe-data-sources` workflow (manual dispatch)
   re-probes all candidates from a US datacenter and captures raw responses.

## How to run (script + fixtures)

The plan's tentative `fetch:snotel` is implemented as **`fetch:dry`** (the
official SNOTEL feed is unreachable, so the stub fetches KSL).

Committed fixtures (generated `data/raw/` output stays gitignored):

```
data/fixtures/ksl-2026-10-24.html  # full 206-site page, Oct 24 2026 snapshot
 data/fixtures/wcc-ut-snotel-report-2026-10-24.html  # full WCC report (latin-1)
 data/fixtures/wcc-ut-stations-2026-10-24.json      # station catalog (260 entries)
pipeline/test/fixtures/ksl-sample.html              # 2-basin/15-row slice (fast parser unit tests)
```

```bash
pnpm fetch:dry                                             # live fetch → data/raw/ksl-<YYYY-MM-DD>.json
pnpm fetch:dry --fixture data/fixtures/ksl-2026-10-24.html # full offline run (100%, passes)
pnpm fetch:dry --fixture pipeline/test/fixtures/ksl-sample.html  # PARTIAL → coverage gate FAILS by design
pnpm --filter @utahsnowpack/pipeline exec tsx src/build-registry.ts --fixture data/fixtures  # rebuild data/sites.json offline
pnpm --filter @utahsnowpack/pipeline build:snowpack       # fixtures + registry → data/snowpack.json
```

The full fixture lets the entire pipeline run offline (no network needed in
CI). The partial sample exists only to exercise parser edge cases cheaply
(verbatim spacing, flags, `.0`); feeding it to `fetch:dry` correctly trips
the 95% coverage gate — a canary that the guard fires.
