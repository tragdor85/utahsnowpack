/**
 * Roster coverage: how much of the committed KSL baseline roster does a
 * fetched snapshot account for? Gate for docs/PLAN.md task 2 (≥95%).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KslSnapshot } from './sources/ksl.js';
import { stripFlag } from './sources/ksl.js';

const BASELINE_PATH = fileURLToPath(
  new URL('../../data/ksl-baseline-2026-10-24.json', import.meta.url),
);

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function baselineRoster(): string[] {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
    basins: { name: string; sites: { site: string }[] }[];
  };
  return baseline.basins.flatMap((b) => b.sites.map((s) => s.site));
}

export interface CoverageReport {
  rosterSize: number;
  matched: number;
  pct: number;
  missing: string[];
}

export function coverageReport(snapshot: KslSnapshot, roster?: string[]): CoverageReport {
  const names = roster ?? baselineRoster();
  // KSL appends a trailing data-quality flag ("Atwater  M") to the site cell
  // when a station has not reported yet; the flag is not part of the name.
  // Strip it on both sides so flagged and unflagged renderings match.
  const seen = new Set(
    snapshot.sections.flatMap((s) => s.rows.map((r) => normalizeName(stripFlag(r.site)))),
  );
  const missing = names.filter((n) => !seen.has(normalizeName(stripFlag(n))));
  const matched = names.length - missing.length;
  return {
    rosterSize: names.length,
    matched,
    pct: names.length === 0 ? 0 : (matched / names.length) * 100,
    missing,
  };
}
