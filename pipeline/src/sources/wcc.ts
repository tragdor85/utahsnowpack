/**
 * USDA Water & Climate Center (WCC) — the official upstream of the SNOTEL data
 * (docs/data-sources.md). Two endpoints:
 *
 * 1. The Utah SNOTEL Snowpack Update Report — server-rendered HTML table
 *    (validated daily fallback source; fresher than KSL).
 * 2. The AWDB REST API `GET /awdbRestApi/services/v1/stations` — the station
 *    catalog: station ID, name, elevation, lat/lon, network, service dates.
 *    Discovered 2026-10-25 via the new site's JS bundle; a plain single
 *    request works (no session dance), but `wccFetch` still handles the
 *    `;jsessionid` redirect the report page performs.
 *
 * The report body is ISO-8859-1 (latin-1); the API returns JSON.
 */

export const WCC_REPORT_URL =
  'https://wcc.sc.egov.usda.gov/reports/UpdateReport.html?report=Utah&format=SNOTEL+Snowpack+Update+Report';
export const WCC_STATIONS_URL = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Fetch a WCC URL, following the Java `;jsessionid` redirect explicitly
 * (a separate request carrying the cookie jar) rather than relying on
 * auto-follow across the AWS ALB — see docs/data-sources.md.
 */
export async function wccFetch(url: string): Promise<string> {
  const res1 = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  const location = res1.headers.get('location');
  if (!location) {
    if (!res1.ok) throw new Error(`WCC responded ${res1.status} ${res1.statusText} for ${url}`);
    return decodeBody(res1, url);
  }
  const cookies = (res1.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
  await res1.body?.cancel();
  const res2 = await fetch(new URL(location, url).toString(), {
    headers: { 'User-Agent': UA, ...(cookies ? { Cookie: cookies } : {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res2.ok) throw new Error(`WCC follow-up responded ${res2.status} ${res2.statusText}`);
  return decodeBody(res2, url);
}

async function decodeBody(res: Response, url: string): Promise<string> {
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  // The report is latin-1; the API is JSON (utf-8). Latin-1 decodes every
  // byte, so it is the safe default for the HTML page.
  const decoder = contentType.includes('json')
    ? new TextDecoder('utf-8')
    : new TextDecoder('iso-8859-1');
  const text = decoder.decode(buf);
  if (text.trim().length === 0) throw new Error(`WCC returned an empty body for ${url}`);
  return text;
}

export async function fetchWccReport(): Promise<string> {
  return wccFetch(WCC_REPORT_URL);
}

/**
 * Fetch the station catalog for the given names (comma-batched, deduped).
 * `activeOnly=false` so decommissioned stations remain matchable.
 */
export async function fetchWccStations(names: string[], batchSize = 50): Promise<WccStation[]> {
  const unique = [...new Set(names)];
  const all: WccStation[] = [];
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize).join(',');
    const url = `${WCC_STATIONS_URL}?stationNames=${encodeURIComponent(batch)}&activeOnly=false`;
    const text = await wccFetch(url);
    const parsed = JSON.parse(text) as WccStation[];
    if (!Array.isArray(parsed)) throw new Error('WCC stations API returned a non-array response');
    all.push(...parsed);
  }
  const seen = new Set<string>();
  return all.filter((s) => {
    if (seen.has(s.stationTriplet)) return false;
    seen.add(s.stationTriplet);
    return true;
  });
}

/** Station catalog entry (AWDB StationDTO, fields we use). */
export interface WccStation {
  stationTriplet: string;
  stationId: string;
  stateCode: string;
  networkCode: string;
  name: string;
  dcoCode?: string;
  countyName?: string;
  huc?: string;
  elevation?: number;
  latitude?: number;
  longitude?: number;
  beginDate?: string;
  endDate?: string;
}

const WCC_CELL_KEYS = [
  'site',
  'elev',
  'swe',
  'sweMedian',
  'peakSwe',
  'peakDate',
  'pctMedian',
  'pctPeak',
] as const;

export interface WccRow {
  site: string;
  elev: string;
  swe: string;
  sweMedian: string;
  peakSwe: string;
  peakDate: string;
  pctMedian: string;
  pctPeak: string;
}

export interface WccGroup {
  name: string;
  rows: WccRow[];
  /** The report's own basin-level index, e.g. `"230*"` (null if absent). */
  basinIndex: string | null;
}

export interface WccSnapshot {
  sourceUrl: string;
  fetchedAt: string;
  reportDate: string | null; // e.g. "Saturday, October 24, 2026"
  groups: WccGroup[];
  rowCount: number;
}

function cleanCell(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the report's `update_report_data` table: one-cell rows are basin
 * group headers, three-cell `Basin Index (%)` rows are the group's index,
 * eight-cell rows are sites.
 *
 * Note: the report lists every station in the network — including stations
 * that did not report (their SWE cell is `-M`). "Reported today" therefore
 * means *SWE non-missing*, not mere presence in the report
 * (docs/data-sources.md).
 */
export function parseWccReport(html: string, sourceUrl: string, fetchedAt: string): WccSnapshot {
  const dateMatch = html.match(
    /Data based on the first reading of the day[^<]*for\s*([^<]+?)\s*(?:&lt;|<)/i,
  );
  const reportDate = dateMatch ? cleanCell(dateMatch[1]) : null;

  const tag = /<table[^>]*id="update_report_data"[^>]*>/is;
  const start = html.search(tag);
  if (start === -1)
    throw new Error('no update_report_data table found — WCC report layout changed?');
  let depth = 0;
  let end = start;
  while (end < html.length) {
    const open = html.indexOf('<table', end);
    const close = html.indexOf('</table>', end);
    if (close === -1) break;
    if (open !== -1 && open < close) {
      depth += 1;
      end = open + 6;
    } else {
      depth -= 1;
      end = close + 8;
      if (depth === 0) break;
    }
  }
  const table = html.slice(start, end);

  const groups: WccGroup[] = [];
  for (const rowMatch of table.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)) {
    const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g)].map((c) =>
      cleanCell(c[0]),
    );
    if (cells.length === 1) {
      groups.push({ name: cells[0], rows: [], basinIndex: null });
    } else if (cells.length === 3 && cells[0] === 'Basin Index (%)' && groups.length > 0) {
      groups[groups.length - 1].basinIndex = cells[1] || null;
    } else if (cells.length === WCC_CELL_KEYS.length && groups.length > 0) {
      groups[groups.length - 1].rows.push(
        Object.fromEntries(cells.map((v, i) => [WCC_CELL_KEYS[i], v])) as unknown as WccRow,
      );
    }
  }

  return {
    sourceUrl,
    fetchedAt,
    reportDate,
    groups,
    rowCount: groups.reduce((n, g) => n + g.rows.length, 0),
  };
}
