/**
 * Parser for KSL's Utah snowpack page (docs/data-sources.md).
 *
 * The page server-renders one section per basin: a bold header (e.g.
 * "DUCHESNE") followed by an 8-column table. Site rows use
 * `<tr class="highlight">` with cells:
 *   Site | Elev | SWE | Avg | % Avg | Precip | Avg | % Avg
 * Values are kept verbatim (strings, as displayed, flags included).
 */

export interface KslRow {
  site: string;
  elev: string;
  swe: string;
  sweAvg: string;
  swePct: string;
  precip: string;
  precipAvg: string;
  precipPct: string;
}

export interface KslSection {
  name: string;
  rows: KslRow[];
}

export interface KslSnapshot {
  sourceUrl: string;
  fetchedAt: string; // ISO timestamp
  lastUpdated: string | null; // page stamp, e.g. "10:10am Sat 24 October 2026"
  sections: KslSection[];
  rowCount: number;
}

const CELL_KEYS = [
  'site',
  'elev',
  'swe',
  'sweAvg',
  'swePct',
  'precip',
  'precipAvg',
  'precipPct',
] as const;

/**
 * Strip tags and trim cell text. Internal whitespace is preserved so
 * display quirks survive verbatim (e.g. "Chepeta  M" with a double space);
 * name matching uses normalizeName() instead.
 */
function cleanCell(cell: string): string {
  return cell.replace(/<[^>]+>/g, '').trim();
}

function parseRows(tableHtml: string): KslRow[] {
  const rows: KslRow[] = [];
  for (const m of tableHtml.matchAll(/<tr[^>]*class="[^"]*highlight[^"]*"[^>]*>(.*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => cleanCell(c[1]));
    if (cells.length !== CELL_KEYS.length) continue;
    rows.push(Object.fromEntries(cells.map((v, i) => [CELL_KEYS[i], v])) as KslRow);
  }
  return rows;
}

/**
 * Fallback section discovery for when KSL changes the header markup:
 * any table whose rows all have 8 cells is treated as a basin table,
 * labelled from the nearest preceding text.
 */
function parseFallbackSections(html: string): KslSection[] {
  const sections: KslSection[] = [];
  for (const m of html.matchAll(/<table\b[^>]*>.*?<\/table>/gs)) {
    const tableHtml = m[0];
    const rows = [...tableHtml.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)]
      .map((r) => [...r[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => cleanCell(c[1])))
      .filter((cells) => cells.length === CELL_KEYS.length);
    if (rows.length === 0) continue;
    const before = html.slice(Math.max(0, m.index - 300), m.index ?? 0);
    const label =
      [...before.matchAll(/>([^<>]{2,40})</g)]
        .map((t) => t[1].trim())
        .filter((t) => t && t !== 'Close (X)')
        .pop() ?? `Section ${sections.length + 1}`;
    sections.push({
      name: label,
      rows: rows.map(
        (cells) => Object.fromEntries(cells.map((v, i) => [CELL_KEYS[i], v])) as KslRow,
      ),
    });
  }
  return sections;
}

export function parseKslHtml(html: string, sourceUrl: string, fetchedAt: string): KslSnapshot {
  const stamp = html.match(/Last Updated:\s*<strong[^>]*>\s*([^<]+?)\s*<\/strong>/i);
  const lastUpdated = stamp ? cleanCell(stamp[1]) : null;

  const sections: KslSection[] = [];
  const headerRe = /font-weight:bold;font-size:14px; width:100%;">\s*([^<]+?)\s*</g;
  const headers = [...html.matchAll(headerRe)];
  if (headers.length > 0) {
    for (let i = 0; i < headers.length; i++) {
      const start = (headers[i].index ?? 0) + headers[i][0].length;
      const end = i + 1 < headers.length ? (headers[i + 1].index ?? html.length) : html.length;
      const sectionRows = parseRows(html.slice(start, end));
      if (sectionRows.length > 0) sections.push({ name: headers[i][1], rows: sectionRows });
    }
  }
  if (sections.length === 0) sections.push(...parseFallbackSections(html));

  return {
    sourceUrl,
    fetchedAt,
    lastUpdated,
    sections,
    rowCount: sections.reduce((n, s) => n + s.rows.length, 0),
  };
}
