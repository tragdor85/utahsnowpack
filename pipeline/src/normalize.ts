/**
 * Normalizer (docs/PLAN.md task 4): turns the two raw snapshots — the KSL
 * page (all roster sites, 8 columns) and the WCC report (all stations,
 * `-M` for those that did not report) — plus the pinned site registry into
 * the canonical `data/snowpack.json` (see schema.ts).
 *
 * Source roles (docs/data-sources.md):
 * - KSL supplies every displayed site value, including precipitation, which
 *   the WCC report does not carry. Values are taken verbatim after undoing
 *   KSL's two cell-shift display quirks (reconstructKslRow).
 * - The WCC report lists every station in the network, with `-M` where a
 *   station did not report. "Reported today" therefore means *SWE
 *   non-missing in the WCC report* — not mere presence in it. The basin
 *   rollup runs over KSL values for the reported stations; the report's own
 *   basin index row is kept as a cross-check on that rollup.
 */
import { BASINS, type BasinDef } from './basins.js';
import { parseKslStamp } from './fetch.js';
import { normalizeStationName, type Registry, type RegistrySite } from './registry.js';
import {
  colorBand,
  type SnowpackBasin,
  type SnowpackData,
  type SnowpackSite,
  type SiteFlag,
} from './schema.js';
import { stripFlag, trailingFlag, type KslRow, type KslSnapshot } from './sources/ksl.js';
import type { WccGroup, WccRow, WccSnapshot } from './sources/wcc.js';

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

/** A parsed table cell: the numeric value plus KSL's data-quality flags. */
export interface Metric {
  value: number | null;
  /** `-M` (or an empty dropped cell): missing data. */
  missing: boolean;
  /** `*`: data may not provide a valid measure of conditions. */
  invalid: boolean;
}

const NUMERIC = /^(\.?\d+(?:\.\d+)?)\s*(?:\(\d+\))*\s*(\*)?$/;

/**
 * Parse one verbatim cell: `.7` → 0.7, `-M` → missing, `*` → invalid,
 * `120*` → 120 + invalid. Accepts the WCC `1.0 (10)` year-count suffix too,
 * so the same parser reads both sources.
 */
export function parseMetric(cell: string): Metric {
  const raw = cell.trim();
  if (raw === '') return { value: null, missing: true, invalid: false };
  if (/^-?M\*?$/i.test(raw)) return { value: null, missing: true, invalid: raw.includes('*') };
  if (/^N\/A$/i.test(raw)) return { value: null, missing: true, invalid: false };
  if (/^-\*$/i.test(raw)) return { value: null, missing: true, invalid: true };
  if (raw === '*') return { value: null, missing: false, invalid: true };
  const m = raw.match(NUMERIC);
  if (m) return { value: Number(m[1]), missing: false, invalid: m[2] !== undefined };
  return { value: null, missing: true, invalid: false };
}

/** Parse an elevation cell (integer feet); null when the cell was dropped. */
export function parseElevation(cell: string): number | null {
  const m = cell.trim().match(/^(\d{3,6})$/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// KSL row reconstruction (the two cell-shift display quirks)
// ---------------------------------------------------------------------------

export type KslRowKind = 'normal' | 'name-overflow' | 'flag-shift';

/**
 * A KSL row with display quirks undone: a station name + 6 metrics.
 * `anomaly` describes an unverified shape so the normalizer can warn.
 */
export interface ReconstructedRow {
  kind: KslRowKind;
  name: string;
  elevationFt: number | null;
  swe: Metric;
  sweAvg: Metric;
  swePct: Metric;
  precip: Metric;
  precipAvg: Metric;
  precipPct: Metric;
  anomaly?: string;
}

const METRIC_SLOTS = [
  'elevationFt',
  'swe',
  'sweAvg',
  'swePct',
  'precip',
  'precipAvg',
  'precipPct',
] as const;
type SlotName = (typeof METRIC_SLOTS)[number];

/**
 * KSL's table renderer shifts cells left when values are missing, leaving
 * empty filler cells at the end, and appends data-quality flags to the name
 * cell ("Chepeta  M" — the station's SWE reading is missing) or overflows
 * long names into the elev cell ("EF Blacks Fork" + "GS").
 *
 * - name-overflow: the elev cell holds non-numeric text (the name tail);
 *   the last cell (precip % avg) is dropped. Data = cells[2..7].
 * - flag-shift: the name carries a trailing M/-M/* flag (the dropped SWE
 *   value) and k trailing cells are empty filler; the first k metric slots
 *   (elev, then SWE) were dropped. k=2 is the observed shape.
 *
 * Discriminators, checked in this order: trailing flag + trailing empty
 * cells → flag-shift FIRST (a shifted row's elev cell may hold "-M", which
 * would otherwise look like overflow); non-numeric elev cell → overflow;
 * a flag with no empty cells is a plain marker on an otherwise normal row.
 */
export function reconstructKslRow(row: KslRow): ReconstructedRow {
  const cells = [
    row.site,
    row.elev,
    row.swe,
    row.sweAvg,
    row.swePct,
    row.precip,
    row.precipAvg,
    row.precipPct,
  ];
  const elev = row.elev.trim();
  const flag = trailingFlag(row.site);
  const trailingEmpty = countTrailingEmpty(cells);

  if (flag !== null && trailingEmpty > 0) {
    const k = trailingEmpty;
    const rec = shiftedRow(
      stripFlag(row.site),
      1,
      k >= 2 ? ['elevationFt', 'swe'] : ['swe'],
      cells,
      'flag-shift',
    );
    rec.swe = { value: null, missing: flag !== '*', invalid: flag === '*' };
    if (k !== 2)
      rec.anomaly = `flag-shift with ${k} trailing empty cell(s) — only k=2 is verified against the baseline`;
    return rec;
  }
  if (elev !== '' && !/^[\d.]+$/.test(elev)) {
    // Name tail shifted into the elev cell; everything shifts left one and
    // the last cell (precip % avg) is dropped.
    const rec = shiftedRow(
      `${stripFlag(row.site)} ${elev}`.replace(/\s+/g, ' ').trim(),
      2,
      ['precipPct'],
      cells,
      'name-overflow',
    );
    if (trailingEmpty > 0)
      rec.anomaly = `name-overflow row also has ${trailingEmpty} trailing empty cell(s) — unverified shape`;
    return rec;
  }
  const rec: ReconstructedRow = {
    kind: 'normal',
    name: stripFlag(row.site).replace(/\s+/g, ' ').trim(),
    elevationFt: parseElevation(elev),
    swe: parseMetric(cells[2]),
    sweAvg: parseMetric(cells[3]),
    swePct: parseMetric(cells[4]),
    precip: parseMetric(cells[5]),
    precipAvg: parseMetric(cells[6]),
    precipPct: parseMetric(cells[7]),
  };
  if (flag !== null)
    rec.anomaly = `name carries "${flag}" flag but no cells were dropped — flag treated as a marker`;
  return rec;
}

/**
 * Left-shift reconstruction: `dropped` are the slots KSL's renderer removed;
 * the data cells starting at `dataStart` map onto the surviving slots in
 * order. Overflow drops the last slot; a flag-shift drops SWE (always — that
 * is what the name flag records) and, with k ≥ 2, the elevation too.
 */
function shiftedRow(
  name: string,
  dataStart: number,
  dropped: SlotName[],
  cells: string[],
  kind: KslRowKind,
): ReconstructedRow {
  const slots = METRIC_SLOTS.filter((s) => !dropped.includes(s));
  const values = cells.slice(dataStart, dataStart + slots.length);
  const out: Partial<Record<SlotName, number | null | Metric>> = {};
  slots.forEach((s, i) => {
    out[s] = s === 'elevationFt' ? parseElevation(values[i]) : parseMetric(values[i]);
  });
  const missing: Metric = { value: null, missing: true, invalid: false };
  return {
    kind,
    name,
    elevationFt: (out.elevationFt as number | null | undefined) ?? null,
    swe: (out.swe as Metric | undefined) ?? missing,
    sweAvg: (out.sweAvg as Metric | undefined) ?? missing,
    swePct: (out.swePct as Metric | undefined) ?? missing,
    precip: (out.precip as Metric | undefined) ?? missing,
    precipAvg: (out.precipAvg as Metric | undefined) ?? missing,
    precipPct: (out.precipPct as Metric | undefined) ?? missing,
  };
}

function countTrailingEmpty(cells: string[]): number {
  let k = 0;
  for (let i = cells.length - 1; i >= 1 && cells[i].trim() === ''; i--) k++;
  return k;
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

interface WccIndex {
  /** WCC group name → normalized station name → rows. */
  byGroup: Map<string, Map<string, WccRow[]>>;
  /** WCC group name → the group itself (for the basin index row). */
  groups: Map<string, WccGroup>;
}

function buildWccIndex(wcc: WccSnapshot): WccIndex {
  const byGroup = new Map<string, Map<string, WccRow[]>>();
  const groups = new Map<string, WccGroup>();
  for (const group of wcc.groups) {
    const names = byGroup.get(group.name) ?? new Map<string, WccRow[]>();
    for (const row of group.rows) {
      const key = normalizeStationName(row.site);
      names.set(key, [...(names.get(key) ?? []), row]);
    }
    byGroup.set(group.name, names);
    groups.set(group.name, group);
  }
  return { byGroup, groups };
}

/** Registry lookup by normalized name (catalog name, KSL display name, or
 * the display name with its data-quality flag stripped). */
function buildStationIndex(registry: Registry): Map<string, RegistrySite> {
  const index = new Map<string, RegistrySite>();
  for (const site of registry.sites) {
    index.set(normalizeStationName(site.name), site);
    index.set(normalizeStationName(site.kslName), site);
    index.set(normalizeStationName(stripFlag(site.kslName)), site);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/**
 * The KSL stamp is Mountain Time wall clock ("10:10am Sat 24 October 2026").
 * parseKslStamp builds it in the local timezone; re-anchor the same wall
 * clock to America/Denver so the ISO instant is identical on any machine.
 */
export function kslStampToIso(stamp: string): string | null {
  const wall = parseKslStamp(stamp);
  if (!wall) return null;
  const utcGuess = Date.UTC(
    wall.getFullYear(),
    wall.getMonth(),
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
  );
  const offsetMin = denverOffsetMinutes(utcGuess);
  return new Date(utcGuess - offsetMin * 60_000).toISOString();
}

/** The stamp's calendar date (America/Denver), e.g. "2026-10-24". */
export function kslStampToDate(stamp: string): string | null {
  const wall = parseKslStamp(stamp);
  if (!wall) return null;
  return `${wall.getFullYear()}-${String(wall.getMonth() + 1).padStart(2, '0')}-${String(wall.getDate()).padStart(2, '0')}`;
}

/** UTC offset of America/Denver (minutes) at the given instant, DST-aware. */
function denverOffsetMinutes(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const offsetAt = (ms: number): number => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    const denverWall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
    );
    return Math.round((denverWall - ms) / 60_000);
  };
  // One refinement pass: the offset is looked up at the guessed instant, but
  // the true instant is `guess - offset`; near a DST boundary these can be on
  // opposite sides of the transition.
  const first = offsetAt(utcMs);
  return offsetAt(utcMs - first * 60_000);
}

/** "Saturday, October 24, 2026" → "2026-10-24" (calendar date, no TZ). */
export function wccReportDateToIso(date: string): string | null {
  const m = date.match(/^([A-Z][a-z]+),\s+(\w+) (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = months.indexOf(m[2]);
  if (month === -1) return null;
  return `${m[4]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

/** Water year (standard convention: WY N runs Oct 1 of N-1 to Sep 30 of N). */
export function waterYearOf(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const [y, m] = dateIso.split('-').map(Number);
  if (!y || !m) return null;
  return m >= 10 ? y + 1 : y;
}

// ---------------------------------------------------------------------------
// The normalizer
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  /** ISO timestamp for `fetchedAt` (defaults to now). */
  fetchedAt?: string;
}

interface SiteValues {
  swe: Metric;
  sweAvg: Metric;
  swePct: Metric;
  precip: Metric;
  precipAvg: Metric;
  precipPct: Metric;
}

const ALL_MISSING: SiteValues = {
  swe: { value: null, missing: true, invalid: false },
  sweAvg: { value: null, missing: true, invalid: false },
  swePct: { value: null, missing: true, invalid: false },
  precip: { value: null, missing: true, invalid: false },
  precipAvg: { value: null, missing: true, invalid: false },
  precipPct: { value: null, missing: true, invalid: false },
};

export function normalize(
  ksl: KslSnapshot,
  wcc: WccSnapshot,
  registry: Registry,
  opts: NormalizeOptions = {},
): SnowpackData {
  const warnings: string[] = [];
  const stationIndex = buildStationIndex(registry);
  const wccIndex = buildWccIndex(wcc);

  // KSL rows → (station, values), first occurrence per station wins.
  const valuesByStation = new Map<string, SiteValues>();
  const kslOrder = new Map<string, number>(); // stationTriplet → first row position
  let rowPosition = 0;
  for (const section of ksl.sections) {
    for (const row of section.rows) {
      const rec = reconstructKslRow(row);
      if (rec.anomaly) {
        warnings.push(`KSL row "${rec.name}" (section ${section.name}): ${rec.anomaly}`);
      }
      const station = stationIndex.get(normalizeStationName(rec.name));
      if (!station) {
        warnings.push(
          `KSL row "${rec.name}" (section ${section.name}) does not match any registry station — skipped`,
        );
        continue;
      }
      if (valuesByStation.has(station.stationTriplet)) {
        const first = valuesByStation.get(station.stationTriplet)!;
        if (valuesDiffer(first, rec)) {
          warnings.push(
            `station ${station.stationTriplet} (${station.name}) appears in multiple KSL sections with different values — first occurrence kept`,
          );
        }
        continue;
      }
      valuesByStation.set(station.stationTriplet, {
        swe: rec.swe,
        sweAvg: rec.sweAvg,
        swePct: rec.swePct,
        precip: rec.precip,
        precipAvg: rec.precipAvg,
        precipPct: rec.precipPct,
      });
      kslOrder.set(station.stationTriplet, rowPosition++);
    }
  }

  // WCC rows that match no roster station (in the 8 tracked groups).
  for (const basin of BASINS) {
    const names = wccIndex.byGroup.get(basin.wccGroup);
    if (!names) continue;
    for (const [key, rows] of names) {
      if (!stationIndex.has(key)) {
        warnings.push(
          `WCC report lists "${rows[0].site}" in ${basin.wccGroup} but it is not in the roster — excluded from rollup`,
        );
      }
    }
  }

  // Cross-check: for stations that reported, KSL and WCC must agree.
  const reportedMismatches = new Set<string>();
  for (const station of registry.sites) {
    const values = valuesByStation.get(station.stationTriplet);
    if (!values) continue;
    for (const basin of BASINS) {
      if (!station.basins.includes(basin.id)) continue;
      const rows = wccRowsForStation(station, wccIndex, basin);
      if (!rows) continue;
      const w = rows[0];
      const wSwe = parseMetric(w.swe);
      const wMedian = parseMetric(w.sweMedian);
      if (
        values.swe.value !== null &&
        wSwe.value !== null &&
        Math.abs(values.swe.value - wSwe.value) > 0.05
      ) {
        warnings.push(
          `SWE disagreement for ${station.name} (${basin.id}): KSL ${values.swe.value} vs WCC ${wSwe.value}`,
        );
      }
      if (
        values.sweAvg.value !== null &&
        wMedian.value !== null &&
        Math.abs(values.sweAvg.value - wMedian.value) > 0.05
      ) {
        warnings.push(
          `SWE avg disagreement for ${station.name} (${basin.id}): KSL ${values.sweAvg.value} vs WCC ${wMedian.value}`,
        );
      }
      // Reported-status agreement: one source has a SWE reading, the other
      // does not. A few stragglers are normal (the sources are fetched
      // minutes apart); a flood means the pages are out of sync (e.g. the
      // KSL page was rendered before the 08:00 SNOTEL report).
      if ((values.swe.value !== null) !== (wSwe.value !== null)) {
        reportedMismatches.add(station.name);
      }
    }
  }
  const totalEntries = registry.sites.reduce((n, s) => n + s.basins.length, 0);
  if (reportedMismatches.size > Math.max(5, Math.round(totalEntries * 0.1))) {
    const examples = [...reportedMismatches].slice(0, 5).join(', ');
    warnings.push(
      `${reportedMismatches.size} station(s) have a SWE reading on one source but not the other ` +
        `(e.g. ${examples}) — the sources may be out of sync (KSL ${ksl.lastUpdated} vs WCC ${wcc.reportDate})`,
    );
  }

  // A tracked basin whose WCC group vanished from the report would silently
  // zero out its rollup — say so loudly.
  for (const basin of BASINS) {
    if (!wccIndex.byGroup.has(basin.wccGroup)) {
      warnings.push(
        `WCC report has no "${basin.wccGroup}" group — ${basin.id} rollup and reported-today flags are unreliable`,
      );
    }
  }

  const wccDate = wcc.reportDate ? wccReportDateToIso(wcc.reportDate) : null;
  if (wcc.reportDate && !wccDate)
    warnings.push(`could not parse WCC report date: "${wcc.reportDate}"`);
  const kslDate = ksl.lastUpdated ? kslStampToDate(ksl.lastUpdated) : null;
  if (ksl.lastUpdated && !kslDate) warnings.push(`could not parse KSL stamp: "${ksl.lastUpdated}"`);
  if (kslDate && wccDate && kslDate !== wccDate) {
    warnings.push(
      `source dates differ — KSL page from ${kslDate}, WCC report from ${wccDate}; ` +
        'reported-today flags follow the WCC date while values follow the KSL page',
    );
  }

  const basins: SnowpackBasin[] = BASINS.map((basin) =>
    buildBasin(basin, registry, valuesByStation, kslOrder, wccIndex, warnings),
  );

  return {
    schemaVersion: 1,
    source: { ksl: ksl.sourceUrl, wcc: wcc.sourceUrl },
    fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
    lastUpdated: {
      ksl: ksl.lastUpdated,
      kslDate,
      wcc: wcc.reportDate,
      wccDate,
    },
    waterYear: waterYearOf(wccDate ?? kslDate),
    basins,
    warnings,
  };
}

function buildBasin(
  basin: BasinDef,
  registry: Registry,
  valuesByStation: Map<string, SiteValues>,
  kslOrder: Map<string, number>,
  wccIndex: WccIndex,
  warnings: string[],
): SnowpackBasin {
  const members = registry.sites.filter((s) => s.basins.includes(basin.id));
  const withValues = members
    .filter((s) => valuesByStation.has(s.stationTriplet))
    .sort((a, b) => (kslOrder.get(a.stationTriplet) ?? 0) - (kslOrder.get(b.stationTriplet) ?? 0));
  const withoutValues = members.filter((s) => !valuesByStation.has(s.stationTriplet));
  for (const s of withoutValues) {
    warnings.push(
      `station ${s.stationTriplet} (${s.name}) is in the registry but absent from the KSL snapshot — emitted with missing values`,
    );
  }

  const sites: SnowpackSite[] = [...withValues, ...withoutValues].map((station) => {
    const values = valuesByStation.get(station.stationTriplet) ?? ALL_MISSING;
    const reportedToday = wccReported(station, wccIndex, basin);
    return {
      stationId: station.stationId,
      stationTriplet: station.stationTriplet,
      name: station.name,
      elevationFt: station.elevationFt,
      latitude: station.latitude,
      longitude: station.longitude,
      reportedToday,
      sweIn: values.swe.value,
      sweAvgIn: values.sweAvg.value,
      swePctAvg: values.swePct.value,
      precipIn: values.precip.value,
      precipAvgIn: values.precipAvg.value,
      precipPctAvg: values.precipPct.value,
      flags: flagsFor(values),
    };
  });

  const reporting = sites.filter((s) => s.reportedToday);
  const pairs = reporting.filter((s) => s.sweIn !== null && s.sweAvgIn !== null);
  const denom = pairs.reduce((sum, s) => sum + (s.sweAvgIn ?? 0), 0);
  const swePctAvg =
    pairs.length > 0 && denom > 0
      ? Math.round((100 * pairs.reduce((sum, s) => sum + (s.sweIn ?? 0), 0)) / denom)
      : null;

  // Cross-check the rollup against the WCC report's own basin index row.
  const wccGroup = wccIndex.groups.get(basin.wccGroup);
  const indexRow = wccGroup?.basinIndex ?? null;
  if (indexRow) {
    const idx = parseMetric(indexRow);
    if (idx.value !== null && !idx.missing) {
      if (swePctAvg === null) {
        const why =
          pairs.length === 0
            ? 'no reported station has both SWE and SWE-avg'
            : `${pairs.length} reported station(s) have both, but their SWE-avg sum is 0`;
        warnings.push(
          `${basin.id}: WCC basin index is ${indexRow} but no rollup is computable (${why})`,
        );
      } else if (Math.abs(swePctAvg - idx.value) > 2) {
        warnings.push(
          `${basin.id}: rollup ${swePctAvg}% diverges from the WCC basin index ${indexRow} by ` +
            `${Math.abs(swePctAvg - idx.value)} pts — the sources may be out of sync`,
        );
      }
    }
  }

  return {
    id: basin.id,
    name: basin.kslName,
    swePctAvg,
    colorBand: colorBand(swePctAvg),
    sitesReporting: reporting.length,
    sitesTotal: sites.length,
    sites,
  };
}

/** The WCC report rows for a station within one basin's group, if any. */
function wccRowsForStation(
  station: RegistrySite,
  wccIndex: WccIndex,
  basin: BasinDef,
): WccRow[] | null {
  const names = wccIndex.byGroup.get(basin.wccGroup);
  if (!names) return null;
  return (
    names.get(normalizeStationName(station.name)) ??
    names.get(normalizeStationName(station.kslName)) ??
    null
  );
}

/**
 * "Reported today": the WCC report lists every station, so presence alone
 * says nothing — the station's SWE cell must be non-missing (`-M` means the
 * station has not reported yet).
 */
function wccReported(station: RegistrySite, wccIndex: WccIndex, basin: BasinDef): boolean {
  const rows = wccRowsForStation(station, wccIndex, basin);
  if (!rows) return false;
  return parseMetric(rows[0].swe).missing === false;
}

function flagsFor(v: SiteValues): SiteFlag[] {
  const flags: SiteFlag[] = [];
  const add = (
    prefix: 'swe' | 'swe-avg' | 'swe-pct' | 'precip' | 'precip-avg' | 'precip-pct',
    m: Metric,
  ) => {
    if (m.missing) flags.push(`${prefix}-missing` as SiteFlag);
    if (m.invalid) flags.push(`${prefix}-invalid` as SiteFlag);
  };
  add('swe', v.swe);
  add('swe-avg', v.sweAvg);
  add('swe-pct', v.swePct);
  add('precip', v.precip);
  add('precip-avg', v.precipAvg);
  add('precip-pct', v.precipPct);
  return flags;
}

function valuesDiffer(a: SiteValues, b: ReconstructedRow): boolean {
  const pairs: [Metric, Metric][] = [
    [a.swe, b.swe],
    [a.sweAvg, b.sweAvg],
    [a.swePct, b.swePct],
    [a.precip, b.precip],
    [a.precipAvg, b.precipAvg],
    [a.precipPct, b.precipPct],
  ];
  return pairs.some(
    ([x, y]) =>
      (x.value === null) !== (y.value === null) ||
      (x.value !== null && y.value !== null && Math.abs(x.value - y.value) > 1e-9),
  );
}
