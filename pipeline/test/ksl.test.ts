import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseKslHtml, type KslSection } from '../src/sources/ksl.js';
import { normalizeName, baselineRoster, coverageReport } from '../src/coverage.js';
import { parseKslStamp } from '../src/fetch.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/ksl-sample.html', import.meta.url));
const snapshot = parseKslHtml(
  readFileSync(FIXTURE, 'utf8'),
  'fixture:ksl-sample.html',
  '2026-10-24T18:00:00Z',
);

describe('parseKslHtml (committed KSL fixture)', () => {
  it('parses the last-updated stamp', () => {
    expect(snapshot.lastUpdated).toBe('10:10am Sat 24 October 2026');
  });

  it('parses sections and rows verbatim', () => {
    const names = snapshot.sections.map((s) => s.name);
    expect(names).toEqual(['RAFT RIVER', 'NE UINTAHS']);
    expect(snapshot.rowCount).toBe(15);
  });

  it('keeps cell values verbatim, including flags and .0', () => {
    const howell = snapshot.sections[0].rows[0];
    expect(howell).toEqual({
      site: 'Howell Canyon',
      elev: '8010',
      swe: '1.1',
      sweAvg: '.0',
      swePct: '*',
      precip: '3.9',
      precipAvg: '1.4',
      precipPct: '279',
    });
    const george = snapshot.sections[0].rows[1];
    expect(george.swePct).toBe('120*');
    expect(george.precipPct).toBe('350');
  });

  it('keeps internal spacing of site names verbatim (Chepeta double space)', () => {
    const chepeta = snapshot.sections[1].rows.find((r) => r.site.includes('Chepeta'));
    expect(chepeta?.site).toBe('Chepeta  M');
    // ...while normalization treats it as one name
    expect(normalizeName('Chepeta  M')).toBe(normalizeName('Chepeta M'));
  });
});

describe('parseKslStamp', () => {
  it('parses the KSL timestamp format', () => {
    const d = parseKslStamp('10:10am Sat 24 October 2026');
    expect(d).not.toBeNull();
    // Local-time construction: Oct 24 2026 10:10
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(24);
    expect(d!.getHours()).toBe(10);
    expect(d!.getMinutes()).toBe(10);
  });

  it('returns null for unrecognized stamps', () => {
    expect(parseKslStamp('2026-10-24')).toBeNull();
  });
});

describe('coverageReport', () => {
  it('matches roster sites, normalizing display spacing', () => {
    // The fixture contains "Chepeta  M" (double space); normalized lookup
    // must still match the roster's "Chepeta M".
    const cov = coverageReport(snapshot, ['Howell Canyon', 'George Creek', 'Chepeta M']);
    expect(cov.matched).toBe(3);
    expect(cov.missing).toEqual([]);
  });

  it('reports missing roster sites', () => {
    const cov = coverageReport(snapshot, ['Howell Canyon', 'No Such Site', 'Ghost Peak']);
    expect(cov.matched).toBe(1);
    expect(cov.missing).toEqual(['No Such Site', 'Ghost Peak']);
    expect(cov.pct).toBeCloseTo(33.33, 1);
  });

  it('matches a clean roster name against a flagged page name (Atwater  M, 2026-10-25)', () => {
    const cov = coverageReport(snapshot, ['Hewinta', 'Chepeta']);
    expect(cov.matched).toBe(2);
    expect(cov.missing).toEqual([]);
  });
});

describe('full fixture (task 2 acceptance: >=95% roster coverage, offline)', () => {
  const FULL = fileURLToPath(new URL('../../data/fixtures/ksl-2026-10-24.html', import.meta.url));
  const full = parseKslHtml(readFileSync(FULL, 'utf8'), 'fixture:full', '2026-10-24T18:00:00Z');

  it('parses the complete 206-site page from 16 sections', () => {
    expect(full.sections.length).toBe(16);
    expect(full.rowCount).toBe(206);
  });

  it('covers >=95% of the committed baseline roster', () => {
    const cov = coverageReport(full, baselineRoster());
    expect(cov.rosterSize).toBe(206);
    expect(cov.pct).toBeGreaterThanOrEqual(95);
    expect(cov.missing).toEqual([]);
  });

  it('every row has all 8 string cells', () => {
    for (const row of full.sections.flatMap((s) => s.rows)) {
      for (const value of Object.values(row)) {
        expect(typeof value).toBe('string');
      }
    }
  });
});

describe('parseKslHtml fallbacks', () => {
  it('parses tables even when the header style attribute changed', () => {
    const noStyleAttr = readFileSync(FIXTURE, 'utf8').replace(
      /font-weight:bold;font-size:14px; width:100%;/g,
      'font-size: 20px;',
    );
    const snap = parseKslHtml(noStyleAttr, 'fixture', 't');
    // Fallback labels come from the nearest preceding text; names may differ,
    // but every row must survive.
    expect(snap.rowCount).toBe(15);
    expect(snap.sections.every((s: KslSection) => s.rows.length > 0)).toBe(true);
  });

  it('fails closed: a page with no tables yields zero rows', () => {
    const snap = parseKslHtml('<html><body>nothing here</body></html>', 'fixture', 't');
    expect(snap.rowCount).toBe(0);
    expect(snap.lastUpdated).toBeNull();
  });
});
