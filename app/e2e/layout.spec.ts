import { expect, test } from '@playwright/test';
import { MOCK_SNOWPACK } from '../src/data/mock';
import { BASIN_POLYGONS } from '../src/data/basins';
import { COLOR_BAND_META } from '../src/types';

/**
 * Layout + map tests (docs/PLAN.md tasks 6–7 acceptance): desktop 1280 and
 * mobile 390 render the mock data with the correct legend bands, the basin
 * map renders and click-selects, the keyboard tab order walks the basins,
 * and nothing overflows horizontally.
 *
 * The built app fetches /snowpack.json; we intercept it with the mock so
 * the tests are deterministic regardless of the pipeline's latest data.
 * Screenshots land in app/screenshots/ (gitignored); the assertions are
 * against computed styles and geometry, not pixels.
 * Basemap tiles (CARTO) load over the network where available; the map's
 * own data is local, so the tests pass offline too.
 */

// KSL's exact palette as the browser computes it from the design tokens.
const KSL_COLORS: Record<string, string> = {
  red: 'rgb(255, 0, 0)',
  orange: 'rgb(255, 152, 0)',
  yellow: 'rgb(255, 255, 0)',
  green: 'rgb(0, 255, 0)',
  blue1: 'rgb(115, 255, 223)',
  blue2: 'rgb(0, 169, 230)',
  blue3: 'rgb(0, 0, 255)',
  none: 'rgb(48, 54, 61)',
};

const BANDS = Object.keys(COLOR_BAND_META); // red … none, in legend order

test.beforeEach(async ({ page }) => {
  await page.route('**/snowpack.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SNOWPACK),
    }),
  );
});

async function assertMockRendered(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('water-year')).toHaveText('Water year 2027');
  // Legend: all 8 bands, in order, with KSL's exact colors.
  const swatches = page.locator('.legend .band-chip');
  await expect(swatches).toHaveCount(BANDS.length);
  for (let i = 0; i < BANDS.length; i++) {
    await expect(swatches.nth(i)).toHaveCSS('background-color', KSL_COLORS[BANDS[i]]);
  }
  // All 8 basins render.
  await expect(page.locator('.basin-list__item')).toHaveCount(8);
}

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(
    scrollWidth,
    `document scrollWidth ${scrollWidth} exceeds viewport ${width}`,
  ).toBeLessThanOrEqual(width);
}

test.describe('desktop (1280)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('renders mock data beside the detail panel', async ({ page }) => {
    await page.goto('/');
    await assertMockRendered(page);

    // Two-column layout: the panel sits to the right of the basin list.
    const list = (await page.locator('.basin-list').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!;
    expect(panel.x, 'panel should be right of the list').toBeGreaterThan(list.x + list.width / 2);

    // The default selection (first basin) shows its rollup.
    await expect(page.locator('.panel__name')).toHaveText('RAFT RIVER');
    await expect(page.locator('.panel__pct')).toHaveText('180%');

    await assertNoHorizontalOverflow(page, 1280);
    await page.screenshot({ path: 'screenshots/desktop-1280.png', fullPage: true });
  });

  test('renders the basin map with a sized canvas', async ({ page }) => {
    await page.goto('/');
    await assertMockRendered(page);

    const canvas = page.locator('.basin-map canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThan(400);
    expect(box.height).toBeGreaterThan(300);
  });

  test('clicking a basin on the map selects it', async ({ page }) => {
    await page.goto('/');
    await assertMockRendered(page);

    // Wait until the map instance is attached and its basins source has data
    // (independent of the network basemap tiles).
    await page.waitForFunction(() => {
      const el = document.querySelector('.basin-map');
      const map =
        el && (el as unknown as { __map?: { isSourceLoaded: (id: string) => boolean } }).__map;
      return !!map && map.isSourceLoaded('basins');
    });

    // Project the DUCHESNE polygon centroid to canvas coordinates.
    const ring = BASIN_POLYGONS.features.find((f) => f.properties.id === 'duchesne')!.geometry
      .coordinates[0];
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const pt = await page.evaluate(
      ([x, y]) => {
        const el = document.querySelector('.basin-map') as unknown as {
          __map: { project: (p: [number, number]) => { x: number; y: number } };
        };
        const p = el.__map.project([x, y]);
        return { x: p.x, y: p.y };
      },
      [cx, cy],
    );

    await page.locator('.basin-map').scrollIntoViewIfNeeded();
    const box = (await page.locator('.basin-map canvas').boundingBox())!;
    await page.mouse.click(box.x + pt.x, box.y + pt.y);

    await expect(page.locator('.panel__name')).toHaveText('DUCHESNE');
  });
});

test.describe('mobile (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stacks the panel below the list without overflow', async ({ page }) => {
    await page.goto('/');
    await assertMockRendered(page);

    // Single column: the panel sits below the basin list.
    const list = (await page.locator('.basin-list').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!;
    expect(panel.y, 'panel should be below the list').toBeGreaterThan(list.y);

    await assertNoHorizontalOverflow(page, 390);
    await page.screenshot({ path: 'screenshots/mobile-390.png', fullPage: true });
  });
});

test('keyboard tab order walks the basins in order and Enter selects', async ({ page }) => {
  await page.goto('/');
  await assertMockRendered(page);

  const items = page.locator('.basin-list__item');
  await items.first().focus();
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(items.nth(2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel__name')).toHaveText('WEBER-OGDEN');
});
