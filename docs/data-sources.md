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
the day, 00:00, vs. KSL's ~10:10 am stamp). Validated 2026-10-25 — see the WCC
section below.

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

| Candidate                          | Local                                     | GH runner                                   | Roster coverage                                            | Needed elements                                                                                            | Auth                 |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| **KSL** `ksl.com/weather/snowpack` | 200, 166,762 B                            | 200, byte-identical                         | **206/206 (100%)**                                         | SWE, SWE avg, SWE % avg, precip, precip avg, precip % avg, elev, flags, Last Updated — all present per row | none                 |
| `snotel.gov` / `www.snotel.gov`    | DNS fail                                  | 000 (DNS fail)                              | —                                                          | —                                                                                                          | —                    |
| `snotel.sc.egov.usda.gov`          | DNS fail                                  | 000 (DNS fail)                              | —                                                          | —                                                                                                          | —                    |
| `nwpc.nws.noaa.gov`                | DNS fail                                  | 000                                         | —                                                          | —                                                                                                          | —                    |
| `dwr.utah.gov`, `snow.utah.gov`    | DNS fail                                  | 000                                         | —                                                          | —                                                                                                          | —                    |
| `nrcs.usda.gov` (main site)        | 200                                       | 200                                         | no SNOTEL feed exposed (checked paths 404)                 | —                                                                                                          | —                    |
| ACIS `data.rcc-acis.org`           | 200                                       | 200                                         | SNOTEL stations **not** indexed (0 hits)                   | swv/pcpn only for NWS/coop stations                                                                        | none                 |
| **WCC** `wcc.sc.egov.usda.gov`     | 200, 421,327 B (3× identical, no CAPTCHA) | added to probe workflow, pending runner run | **203/207 (98%)** by normalized name — clears the 95% gate | SWE, today's median SWE, median peak SWE + dates, % of median — **no precipitation column**                | session (JSESSIONID) |

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
Investigated 2026-10-25 (fetched 3×; all HTTP 200, identical 421,327-byte
bodies, no CAPTCHA/bot wall).

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
- **How to fetch**: `GET` the URL with a browser-like `User-Agent`, follow
  redirects (`-L`), and keep the `JSESSIONID` cookie (the first request 302s
  with a fresh session, then returns 200). Encoding is `ISO-8859-1`.
  Reproducible with plain `curl`.
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
- **Implementation status**: not yet implemented in `pipeline/`. When built it
  lands as a second source (`pipeline/src/sources/wcc.ts`) behind the existing
  coverage gate, used as the automatic fallback if the KSL fetch/parse fails.

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

KSL re-renders the page around the SNOTEL daily report (observed stamp:
Saturday ~10:10 am local). Task 5's pipeline may poll hourly; a staleness
guard compares the `lastUpdated` stamp against the expected daily cadence.

## Fallbacks and robustness guards

There **is** now an official fallback — the WCC report (see above) — so the
strategy is: **fetch KSL; on a hard KSL failure (unreachable, redesign, or
coverage-gate trip), fall back to WCC.** (WCC fetch/parse is documented but not
yet implemented in `pipeline/`; until it lands, the guard below fails loudly.
) The KSL path keeps these guards:

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
 data/fixtures/ksl-sample.html     # 2-basin/15-row slice (fast parser unit tests)
```

```bash
pnpm fetch:dry                                             # live fetch → data/raw/ksl-<YYYY-MM-DD>.json
pnpm fetch:dry --fixture data/fixtures/ksl-2026-10-24.html # full offline run (100%, passes)
pnpm fetch:dry --fixture data/fixtures/ksl-sample.html    # PARTIAL → coverage gate FAILS by design
```

The full fixture lets the entire pipeline run offline (no network needed in
CI). The partial sample exists only to exercise parser edge cases cheaply
(verbatim spacing, flags, `.0`); feeding it to `fetch:dry` correctly trips
the 95% coverage gate — a canary that the guard fires.
