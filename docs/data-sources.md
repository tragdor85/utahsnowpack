# Data sources — decision record

_Task 2 of `docs/PLAN.md`. Written 2026-10-25. Re-verify by dispatching the
`probe-data-sources` workflow (second network context) and re-running
`pnpm fetch:dry`._

## Decision

**Primary source: KSL's snowpack page** — `https://www.ksl.com/weather/snowpack`
(server-rendered HTML tables). Fetched with one plain HTTPS GET; no auth, no
API key.

The official SNOTEL feeds are **not** a viable live source: the SNOTEL-specific
hostnames do not resolve from any network context tested (see evidence below).
The plan anticipated "official feed with the KSL page parser as documented
fallback"; validation flipped that — **KSL is the primary, the official feed is
recorded as dead and is re-verified opportunistically** by the probe workflow.

## Evidence

Tested from two independent network contexts on 2026-10-24/25:

1. Local development machine (residential, US).
2. GitHub Actions `ubuntu-latest` runner (US datacenter) via the
   `probe-data-sources` workflow (run 40111650005; raw responses captured as
   artifacts).

| Candidate                          | Local          | GH runner           | Roster coverage                            | Needed elements                                                                                            | Auth |
| ---------------------------------- | -------------- | ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---- |
| **KSL** `ksl.com/weather/snowpack` | 200, 166,762 B | 200, byte-identical | **206/206 (100%)**                         | SWE, SWE avg, SWE % avg, precip, precip avg, precip % avg, elev, flags, Last Updated — all present per row | none |
| `snotel.gov` / `www.snotel.gov`    | DNS fail       | 000 (DNS fail)      | —                                          | —                                                                                                          | —    |
| `snotel.sc.egov.usda.gov`          | DNS fail       | 000 (DNS fail)      | —                                          | —                                                                                                          | —    |
| `nwpc.nws.noaa.gov`                | DNS fail       | 000                 | —                                          | —                                                                                                          | —    |
| `dwr.utah.gov`, `snow.utah.gov`    | DNS fail       | 000                 | —                                          | —                                                                                                          | —    |
| `nrcs.usda.gov` (main site)        | 200            | 200                 | no SNOTEL feed exposed (checked paths 404) | —                                                                                                          | —    |
| ACIS `data.rcc-acis.org`           | 200            | 200                 | SNOTEL stations **not** indexed (0 hits)   | swv/pcpn only for NWS/coop stations                                                                        | none |

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

### Why the others lose

- **Official SNOTEL/NWPC/DWR**: unreachable (DNS) from both contexts. Nothing
  to fetch. Recorded for the probe workflow to re-check; if `snotel.gov`
  comes back it becomes a _cross-check_ channel, not a replacement.
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

There is currently **no reachable fallback** — the official feeds are dead —
so the fetcher fails loudly instead of serving stale data:

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
