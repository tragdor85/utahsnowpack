/**
 * `pnpm fetch:dry` — fetch the KSL snowpack page (docs/data-sources.md),
 * validate it against the committed roster, and write the raw snapshot to
 * data/raw/ksl-<YYYY-MM-DD>.json.
 *
 * Usage:
 *   pnpm fetch:dry                # live fetch
 *   pnpm fetch:dry --fixture path/to/page.html
 *
 * Fails loudly (non-zero exit) when the page structure is unrecognizable or
 * roster coverage drops below 95% — see docs/data-sources.md "robustness
 * guards".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { coverageReport } from './coverage.js';
import { parseKslHtml, type KslSnapshot } from './sources/ksl.js';

export const KSL_URL = 'https://www.ksl.com/weather/snowpack';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Parse KSL's stamp, e.g. "10:10am Sat 24 October 2026". */
export function parseKslStamp(stamp: string): Date | null {
  const m = stamp.match(
    /^(\d{1,2}):(\d{2})\s*(am|pm)\s+[A-Z][a-z]*\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/,
  );
  if (!m) return null;
  const [, hh, mm, mer, day, month, year] = m;
  let hour = Number(hh) % 12;
  if (mer === 'pm') hour += 12;
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
  return new Date(Number(year), months.indexOf(month), Number(day), hour, Number(mm));
}

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function loadHtml(fixturePath: string | undefined): { html: string; sourceUrl: string } {
  if (!fixturePath) throw new Error('live fetch requires network; use --fixture for offline runs');
  // pnpm --filter runs from pipeline/, but users pass paths relative to the
  // repo root — try the cwd first, then the repo root.
  const candidates = [resolve(process.cwd(), fixturePath), resolve(REPO_ROOT, fixturePath)];
  const found = candidates
    .map((p) => {
      try {
        return { p, html: readFileSync(p, 'utf8') };
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!found)
    throw new Error(`fixture not found: ${fixturePath} (tried ${candidates.join(' or ')})`);
  return { html: found.html, sourceUrl: `fixture:${fixturePath}` };
}

async function fetchKsl(): Promise<{ html: string; sourceUrl: string }> {
  const res = await fetch(KSL_URL, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`KSL responded ${res.status} ${res.statusText}`);
  return { html: await res.text(), sourceUrl: KSL_URL };
}

interface Guards {
  warnings: string[];
  errors: string[];
}

function guard(snapshot: KslSnapshot, warnings: string[], errors: string[]): Guards {
  if (!snapshot.lastUpdated)
    errors.push("no 'Last Updated' stamp found — KSL page layout may have changed");
  if (snapshot.rowCount === 0)
    errors.push('no site rows parsed — KSL page layout may have changed');
  if (snapshot.rowCount > 0 && (snapshot.rowCount < 150 || snapshot.rowCount > 300)) {
    warnings.push(`unexpected row count ${snapshot.rowCount} (expected ~200)`);
  }
  const stampedAt = snapshot.lastUpdated ? parseKslStamp(snapshot.lastUpdated) : null;
  if (snapshot.lastUpdated && !stampedAt) {
    warnings.push(`could not parse last-updated stamp: "${snapshot.lastUpdated}"`);
  } else if (stampedAt && Date.now() - stampedAt.getTime() > 3 * 86_400_000) {
    warnings.push(
      `last updated "${snapshot.lastUpdated}" is older than 3 days — data may be stale`,
    );
  }
  return { warnings, errors };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const fixtureIdx = argv.indexOf('--fixture');
  const fixturePath = fixtureIdx >= 0 ? argv[fixtureIdx + 1] : undefined;

  const source = fixturePath ? loadHtml(fixturePath) : await fetchKsl();
  const snapshot = parseKslHtml(source.html, source.sourceUrl, new Date().toISOString());

  const warnings: string[] = [];
  const errors: string[] = [];
  guard(snapshot, warnings, errors);

  const cov = coverageReport(snapshot);
  if (cov.pct < 95) {
    errors.push(
      `roster coverage ${cov.pct.toFixed(1)}% is below the 95% gate ` +
        `(missing ${cov.missing.length}: ${cov.missing.slice(0, 10).join(', ')}${cov.missing.length > 10 ? '…' : ''})`,
    );
  }

  console.log(`source:        ${snapshot.sourceUrl}`);
  console.log(`fetched at:    ${snapshot.fetchedAt}`);
  console.log(`last updated:  ${snapshot.lastUpdated ?? '(none)'}`);
  console.log(
    `sections:      ${snapshot.sections.length} (${snapshot.sections.map((s) => s.name).join(', ')})`,
  );
  console.log(`rows:          ${snapshot.rowCount}`);
  console.log(
    `roster:        ${cov.matched}/${cov.rosterSize} matched (${cov.pct.toFixed(1)}%)` +
      (cov.missing.length ? ` — missing: ${cov.missing.join(', ')}` : ''),
  );

  const outDir = fileURLToPath(new URL('../../data/raw/', import.meta.url));
  const outPath = fileURLToPath(
    new URL(`../../data/raw/ksl-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url),
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`wrote:         ${outPath}`);

  for (const w of warnings) console.warn(`warn: ${w}`);
  for (const e of errors) console.error(`ERROR: ${e}`);
  if (errors.length > 0) {
    console.error('fetch:dry FAILED');
    return 1;
  }
  console.log('fetch:dry OK');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('ERROR:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
