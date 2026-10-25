import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { MOCK_SNOWPACK } from '../src/data/mock';
import type { SnowpackSite } from '../src/types';

/**
 * Detail panel tests (docs/PLAN.md task 8 acceptance): the site table
 * matches KSL column-for-column (two-row header, "-M"/"*" cell
 * conventions, elevation sort), search works, non-reporting rows are
 * visible but dimmed, and axe finds no violations.
 *
 * Most tests run against the intercepted mock (deterministic). One test
 * runs against the REAL served snowpack.json and re-derives every cell
 * from it — the column-for-column parity check that keeps the app in
 * lockstep with whatever the pipeline publishes daily.
 */

// KSL cell conventions (verified against the 10-24 capture: 192 of 194
// matched sites cell-for-cell; the 2 exceptions are KSL's own column-shift bug).
function fmtIn(v: number | null): string {
  if (v === null) return '-M';
  return v.toFixed(1).replace(/^(-?)0\./, '$1.');
}
function fmtPct(v: number | null, invalid: boolean): string {
  if (invalid) return v === null ? '*' : `${Math.round(v)}*`;
  return v === null ? '-M' : `${Math.round(v)}`;
}
function fmtElev(v: number | null): string {
  return v === null ? '-M' : `${Math.round(v)}`;
}

function expectedCells(s: SnowpackSite): string[] {
  return [
    s.name,
    fmtElev(s.elevationFt),
    fmtIn(s.sweIn),
    fmtIn(s.sweAvgIn),
    fmtPct(s.swePctAvg, s.flags.includes('swe-pct-invalid')),
    fmtIn(s.precipIn),
    fmtIn(s.precipAvgIn),
    fmtPct(s.precipPctAvg, s.flags.includes('precip-pct-invalid')),
  ];
}

async function renderedRows(page: import('@playwright/test').Page): Promise<string[][]> {
  return page
    .locator('.detail-table tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? ''),
      ),
    );
}

async function selectBasin(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name, 'i') }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/snowpack.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SNOWPACK),
    }),
  );
});

test('renders the two-row KSL header in the detail panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('water-year')).toHaveText('Water year 2027');
  const headers = await page
    .locator('.detail-table thead th')
    .evaluateAll((ths) => ths.map((th) => th.textContent?.trim()));
  expect(headers).toEqual([
    'Site',
    'Elev.',
    'SWE',
    'Avg',
    '% Avg',
    'Precip',
    'Avg',
    '% Avg',
    'Site',
    'SWE % Avg',
    'Precip % Avg',
  ]);
});

test('formats cells KSL-style and sorts by elevation (mock)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('water-year')).toHaveText('Water year 2027');
  await selectBasin(page, 'BEAR RIVER');

  const rows = await renderedRows(page);
  expect(rows).toEqual([
    // CORTEZ 2 N (8600 ft) first: SWE missing → "-M" in the value column.
    ['CORTEZ 2 N', '8600', '-M', '2.4', '-M', '25.0', '31.5', '79'],
    // SUNNYSIDE 1 W (7200 ft): 55% of SWE average.
    ['SUNNYSIDE 1 W', '7200', '1.1', '2.0', '55', '22.4', '30.2', '74'],
  ]);

  // The non-reporting row is dimmed.
  await expect(page.locator('.detail-table__row--stale')).toHaveCount(1);
});

test('search filters sites by name and station ID', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('water-year')).toHaveText('Water year 2027');
  await selectBasin(page, 'RAFT RIVER');

  await expect(page.locator('.detail-table tbody tr')).toHaveCount(2);
  const input = page.getByRole('searchbox');
  await input.fill('atwater');
  await expect(page.locator('.detail-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.detail-table tbody td').first()).toHaveText('ATWATER 1.3 SSW');

  await input.fill('1006');
  await expect(page.locator('.detail-table tbody td').first()).toHaveText('BRIGHTON 3 W');

  await input.fill('zzz');
  await expect(page.locator('.detail-table__empty')).toHaveText(/No sites match/);
});

test('shows the per-basin summary and the KSL footnote', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('water-year')).toHaveText('Water year 2027');
  await selectBasin(page, 'BEAR RIVER');

  const panel = page.locator('.panel');
  await expect(panel.locator('.panel__stats')).toHaveText(/54%/);
  await expect(panel.locator('.panel__stats')).toHaveText(/1\/2/);
  await expect(panel.locator('.panel__footnote')).toHaveText(/missing data/);
  await expect(panel.locator('.panel__footnote')).toHaveText(/valid measure of conditions/);
});

test('axe: no violations in the detail panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('water-year')).toHaveText('Water year 2027');
  await selectBasin(page, 'BEAR RIVER');

  const results = await new AxeBuilder({ page }).include('.panel').analyze(page);
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
});

test('real data: every cell matches the served snowpack.json (KSL parity)', async ({ page }) => {
  // No route interception for this test: the app loads the real
  // data/snowpack.json that the pipeline committed.
  await page.unroute('**/snowpack.json');
  await page.goto('/');
  await expect(page.getByTestId('water-year')).toBeVisible();

  const data = await page.evaluate(async () => {
    const res = await fetch('/snowpack.json');
    return (await res.json()) as { basins: (typeof MOCK_SNOWPACK.basins)[number][] };
  });

  for (const basin of data.basins) {
    await selectBasin(page, basin.name);
    const expected = [...basin.sites]
      .sort((a, b) => (b.elevationFt ?? -1) - (a.elevationFt ?? -1))
      .map(expectedCells);
    const rows = await renderedRows(page);
    expect(rows, `${basin.name}: rendered rows diverge from snowpack.json`).toEqual(expected);
  }
});

// ---------------------------------------------------------------------------
// Time series charts (docs/PLAN.md task 9 acceptance)
// ---------------------------------------------------------------------------

const MOCK_TIMESERIES = {
  schemaVersion: 1,
  source: 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data',
  waterYear: 2027,
  fetchedAt: '2026-10-25T18:30:00.000Z',
  dates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
  stations: [
    {
      t: '0805231007',
      w: [0.1, 0.2, 0.3, 0.5, 0.6],
      p: [0.1, 0.1, 0.1, 0.2, 0.1],
    },
    {
      t: '0805231008',
      w: [0.2, 0.3, 0.4, 0.6, 0.8],
      p: [0.2, 0.1, 0.1, 0.1, 0.2],
    },
  ],
  warnings: [],
};

test.describe('time series charts', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/timeseries.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TIMESERIES),
      }),
    );
  });

  test('renders the basin chart with labeled axes', async ({ page }) => {
    await page.goto('/');
    await selectBasin(page, 'BEAR RIVER');

    const chart = page.locator('.panel__charts .chart').first();
    await expect(chart).toBeVisible();
    await expect(chart.getByText('BEAR RIVER basin')).toBeVisible();

    // The SVG appears once the ResponsiveContainer measures; the tick
    // labels land a moment after. Poll rather than snapshot.
    //
    // Note: Recharts 3 portals the tick-labels group into a chart-level z
    // layer, so the labels are NOT descendants of the axis group — select
    // on the text elements' own class tokens instead.
    await expect
      .poll(async () => {
        const ticks = await chart
          .locator('text.recharts-cartesian-axis-tick-value')
          .evaluateAll((els) =>
            els
              .filter((el) => el.classList.contains('recharts-yAxis'))
              .map((el) => el.textContent?.trim() ?? ''),
          );
        return ticks.length > 0 && ticks.every((t) => t.length > 0);
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const ticks = await chart
          .locator('text.recharts-cartesian-axis-tick-value')
          .evaluateAll((els) =>
            els
              .filter((el) => el.classList.contains('recharts-xAxis'))
              .map((el) => el.textContent?.trim() ?? ''),
          );
        return ticks.length > 0 && ticks.every((t) => t.length > 0);
      })
      .toBe(true);
  });

  test('shows a tooltip with date, SWE, and precip on hover', async ({ page }) => {
    await page.goto('/');
    await selectBasin(page, 'BEAR RIVER');

    const chart = page.locator('.panel__charts .chart').first();
    const box = await chart.locator('svg.recharts-surface').boundingBox();
    if (!box) throw new Error('chart surface not laid out');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(600);

    const tooltip = page.locator('.recharts-tooltip-wrapper', { hasText: 'SWE' });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/Oct \d+/);
    await expect(tooltip).toContainText(/SWE/);
    await expect(tooltip).toContainText(/Precip/);
    await expect(tooltip).toContainText(/in/);
  });

  test('multi-year toggle loads monthly history from AWDB', async ({ page }) => {
    await page.goto('/');
    await selectBasin(page, 'BEAR RIVER');

    // Select the first site in the table (CORTEZ 2 N, highest elevation).
    await page.locator('.row-select').first().click();
    const siteChart = page.locator('.panel__charts .chart').nth(1);
    await expect(siteChart.locator('.chart__title')).toHaveText('CORTEZ 2 N');

    await page.route('**/awdbRestApi/services/v1/data*', (route) => {
      const values = Array.from({ length: 12 }, (_, i) => ({
        month: (i % 12) + 1,
        year: 2026,
        value: Math.round((0.5 + i * 0.1) * 100) / 100,
      }));
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            stationTriplet: '0805231008',
            data: [
              {
                stationElement: {
                  elementCode: 'WTEQ',
                  durationName: 'MONTHLY',
                  beginDate: '2025-10-01',
                  endDate: '2026-09-30',
                },
                values,
              },
            ],
          },
        ]),
      });
    });

    const toggle = page.getByRole('button', { name: /Multi-year/ });
    const requestPromise = page.waitForRequest((req) =>
      req.url().includes('/awdbRestApi/services/v1/data'),
    );
    await toggle.click();
    const request = await requestPromise;

    expect(request.url()).toContain('stationTriplets=0805231008');
    expect(request.url()).toContain('duration=MONTHLY');

    // The site chart now renders monthly points with month-formatted ticks.
    // (Labels are portal-hoisted out of the axis group — select on the
    // text elements' own class tokens.)
    await expect
      .poll(async () =>
        siteChart
          .locator('text.recharts-cartesian-axis-tick-value')
          .evaluateAll((els) =>
            els
              .filter((el) => el.classList.contains('recharts-xAxis'))
              .map((el) => el.textContent?.trim() ?? ''),
          ),
      )
      .toEqual(expect.arrayContaining([expect.stringMatching(/’2\d/)]));
  });

  test('charts pass axe', async ({ page }) => {
    await page.goto('/');
    await selectBasin(page, 'BEAR RIVER');
    await page.locator('.row-select').first().click();
    await expect(page.locator('.panel__charts .chart').nth(1).locator('.chart__title')).toHaveText(
      'CORTEZ 2 N',
    );

    // The site chart mounts under the cursor after the row click, which
    // leaves a tooltip open; move the pointer away so the analyzed state
    // is the resting one.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);

    const results = await new AxeBuilder({ page }).include('.panel__charts').analyze();
    expect(results.violations).toEqual([]);
  });
});
