import { describe, expect, it } from 'vitest';
import { BASIN_POLYGONS } from '../data/basins';
import { MOCK_SNOWPACK } from '../data/mock';
import { UTAH_VIEW, basinFeatures, siteFeatures } from './layers';

/** All coordinates of every polygon ring must sit inside the Utah display box. */
function assertInUtah() {
  for (const f of BASIN_POLYGONS.features) {
    const [ring] = f.geometry.coordinates;
    for (const [lng, lat] of ring) {
      expect(lng).toBeGreaterThanOrEqual(-114.06);
      expect(lng).toBeLessThanOrEqual(-109.05);
      expect(lat).toBeGreaterThanOrEqual(37.0);
      expect(lat).toBeLessThanOrEqual(42.6);
    }
  }
}

describe('basinFeatures', () => {
  it('emits one feature per basin with id/name/band properties', () => {
    const features = basinFeatures(MOCK_SNOWPACK);
    expect(features.features).toHaveLength(MOCK_SNOWPACK.basins.length);
    const byId = new Map(features.features.map((f) => [f.properties.id, f.properties]));
    expect(byId.get('raft_river')?.band).toBe('blue3');
    expect(byId.get('green_river')?.band).toBe('yellow');
    expect(byId.get('beaver_river')?.band).toBe('none'); // no data → neutral
    expect(byId.get('duchesne')?.name).toBe('DUCHESNE');
  });

  it('only includes basins that have a generated polygon', () => {
    const features = basinFeatures(MOCK_SNOWPACK);
    const polygonIds = new Set(BASIN_POLYGONS.features.map((f) => f.properties.id));
    for (const f of features.features) {
      expect(polygonIds.has(f.properties.id)).toBe(true);
    }
  });
});

describe('siteFeatures', () => {
  it('emits one feature per site with its rollup values', () => {
    const features = siteFeatures(MOCK_SNOWPACK);
    const totalSites = MOCK_SNOWPACK.basins.reduce((n, b) => n + b.sites.length, 0);
    expect(features.features).toHaveLength(totalSites);
    const atwater = features.features.find((f) => f.properties.name === 'ATWATER 1.3 SSW');
    expect(atwater?.properties.basinId).toBe('raft_river');
    expect(atwater?.properties.swePct).toBe(178);
    expect(atwater?.properties.reported).toBe(true);
  });

  it('marks non-reporting sites', () => {
    const features = siteFeatures(MOCK_SNOWPACK);
    const cortez = features.features.find((f) => f.properties.name === 'CORTEZ 2 N');
    expect(cortez?.properties.reported).toBe(false);
    expect(cortez?.properties.swePct).toBe(null);
  });
});

describe('geometry', () => {
  it('keeps every polygon vertex inside the Utah display box', () => assertInUtah());

  it('centers the default view inside Utah', () => {
    expect(UTAH_VIEW.center[0]).toBeGreaterThan(-114);
    expect(UTAH_VIEW.center[0]).toBeLessThan(-110);
    expect(UTAH_VIEW.center[1]).toBeGreaterThan(37);
    expect(UTAH_VIEW.center[1]).toBeLessThan(42.6);
    expect(UTAH_VIEW.zoom).toBeGreaterThan(5);
  });
});
