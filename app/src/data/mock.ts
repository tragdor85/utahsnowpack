import type { SnowpackBasin, SnowpackData, SnowpackSite } from '../types';

/**
 * Mock `snowpack.json` for development and tests (docs/PLAN.md task 6).
 *
 * The 8 basins cover every legend band (red/orange/yellow/green/blue1/
 * blue2/blue3/none) and the site set exercises the display cases: a
 * healthy reporting site, a missing-SWE site (flagged), and a site KSL
 * omitted. Values are invented but shaped like real data.
 */

function site(
  partial: Partial<SnowpackSite> &
    Pick<SnowpackSite, 'stationId' | 'stationTriplet' | 'name' | 'elevationFt' | 'latitude' | 'longitude'>,
): SnowpackSite {
  return {
    reportedToday: true,
    sweIn: null,
    sweAvgIn: null,
    swePctAvg: null,
    precipIn: null,
    precipAvgIn: null,
    precipPctAvg: null,
    flags: [],
    ...partial,
  };
}

function basin(
  partial: Partial<SnowpackBasin> & Pick<SnowpackBasin, 'id' | 'name' | 'colorBand'>,
  sites: SnowpackSite[],
): SnowpackBasin {
  return {
    swePctAvg: null,
    sitesReporting: sites.filter((s) => s.reportedToday).length,
    sitesTotal: sites.length,
    ...partial,
    sites,
  };
}

const SITES: Record<string, SnowpackSite[]> = {
  raft_river: [
    site({
      stationId: '1005',
      stationTriplet: '0805231005',
      name: 'ATWATER 1.3 SSW',
      elevationFt: 7100,
      latitude: 41.915,
      longitude: -109.805,
      sweIn: 3.2,
      sweAvgIn: 1.8,
      swePctAvg: 178,
      precipIn: 41.2,
      precipAvgIn: 28.4,
      precipPctAvg: 145,
    }),
    site({
      stationId: '1006',
      stationTriplet: '0805231006',
      name: 'BRIGHTON 3 W',
      elevationFt: 8300,
      latitude: 40.54,
      longitude: -111.53,
      sweIn: 2.1,
      sweAvgIn: 1.5,
      swePctAvg: 140,
      precipIn: 38.9,
      precipAvgIn: 26.1,
      precipPctAvg: 149,
    }),
  ],
  bear_river: [
    site({
      stationId: '1007',
      stationTriplet: '0805231007',
      name: 'SUNNYSIDE 1 W',
      elevationFt: 7200,
      latitude: 40.46,
      longitude: -111.55,
      sweIn: 1.1,
      sweAvgIn: 2.0,
      swePctAvg: 55,
      precipIn: 22.4,
      precipAvgIn: 30.2,
      precipPctAvg: 74,
    }),
    site({
      stationId: '1008',
      stationTriplet: '0805231008',
      name: 'CORTEZ 2 N',
      elevationFt: 8600,
      latitude: 41.02,
      longitude: -111.79,
      reportedToday: false,
      flags: ['swe-missing'],
      sweAvgIn: 2.4,
      precipIn: 25.0,
      precipAvgIn: 31.5,
      precipPctAvg: 79,
    }),
  ],
  weber_ogden: [
    site({
      stationId: '1009',
      stationTriplet: '0805231009',
      name: 'PARK CITY 2 W',
      elevationFt: 7100,
      latitude: 40.65,
      longitude: -111.51,
      sweIn: 2.9,
      sweAvgIn: 2.6,
      swePctAvg: 112,
      precipIn: 33.1,
      precipAvgIn: 29.8,
      precipPctAvg: 111,
    }),
  ],
  provo: [
    site({
      stationId: '1010',
      stationTriplet: '0805231010',
      name: 'WASATCH 1 S',
      elevationFt: 8900,
      latitude: 40.42,
      longitude: -111.62,
      sweIn: 3.4,
      sweAvgIn: 3.6,
      swePctAvg: 94,
      precipIn: 36.8,
      precipAvgIn: 34.2,
      precipPctAvg: 108,
    }),
    site({
      stationId: '1011',
      stationTriplet: '0805231011',
      name: 'PROVO 2 N',
      elevationFt: 5600,
      latitude: 40.27,
      longitude: -111.66,
      reportedToday: false,
      sweIn: null,
      sweAvgIn: 1.9,
      flags: ['swe-missing', 'swe-pct-missing'],
      precipIn: 18.2,
      precipAvgIn: 21.4,
      precipPctAvg: 85,
    }),
  ],
  green_river: [
    site({
      stationId: '1012',
      stationTriplet: '0805231012',
      name: 'PROMONTORY 5 W',
      elevationFt: 5900,
      latitude: 41.45,
      longitude: -111.68,
      sweIn: 1.8,
      sweAvgIn: 2.3,
      swePctAvg: 78,
      precipIn: 24.6,
      precipAvgIn: 27.9,
      precipPctAvg: 88,
    }),
  ],
  duchesne: [
    site({
      stationId: '1013',
      stationTriplet: '0805231013',
      name: 'CHEPETA 1 N',
      elevationFt: 9800,
      latitude: 40.44,
      longitude: -111.05,
      sweIn: 4.1,
      sweAvgIn: 3.0,
      swePctAvg: 137,
      precipIn: 44.7,
      precipAvgIn: 35.6,
      precipPctAvg: 126,
    }),
  ],
  sevier: [
    site({
      stationId: '1014',
      stationTriplet: '0805231014',
      name: 'CANYON 3 N',
      elevationFt: 8400,
      latitude: 39.62,
      longitude: -112.44,
      sweIn: 1.2,
      sweAvgIn: 3.8,
      swePctAvg: 32,
      precipIn: 19.3,
      precipAvgIn: 33.7,
      precipPctAvg: 57,
    }),
  ],
  beaver: [
    site({
      stationId: '1015',
      stationTriplet: '0805231015',
      name: 'HURD 1 S',
      elevationFt: 7900,
      latitude: 39.05,
      longitude: -112.79,
      reportedToday: false,
      flags: ['swe-missing', 'swe-avg-missing', 'swe-pct-missing', 'precip-missing', 'precip-avg-missing', 'precip-pct-missing'],
    }),
  ],
};

const BASINS: SnowpackBasin[] = [
  basin({ id: 'raft_river', name: 'RAFT RIVER', colorBand: 'blue3', swePctAvg: 180 }, SITES.raft_river),
  basin({ id: 'bear_river', name: 'BEAR RIVER', colorBand: 'orange', swePctAvg: 54 }, SITES.bear_river),
  basin({ id: 'weber_ogden', name: 'WEBER/OGDEN', colorBand: 'blue1', swePctAvg: 112 }, SITES.weber_ogden),
  basin({ id: 'provo', name: 'PROVO', colorBand: 'green', swePctAvg: 95 }, SITES.provo),
  basin({ id: 'green_river', name: 'GREEN RIVER', colorBand: 'yellow', swePctAvg: 78 }, SITES.green_river),
  basin({ id: 'duchesne', name: 'DUCHESNE', colorBand: 'blue2', swePctAvg: 135 }, SITES.duchesne),
  basin({ id: 'sevier', name: 'SEVIER', colorBand: 'red', swePctAvg: 32 }, SITES.sevier),
  basin({ id: 'beaver', name: 'BEAVER', colorBand: 'none' }, SITES.beaver),
];

export const MOCK_SNOWPACK: SnowpackData = {
  schemaVersion: 1,
  source: {
    ksl: 'https://www.ksl.com/utah-snowpack-totals',
    wcc: 'https://wcc.nrcs.usda.gov/api/snow/utah/report',
  },
  fetchedAt: '2026-10-25T18:30:00.000Z',
  lastUpdated: {
    ksl: '10:10am Sun 25 October 2026',
    kslDate: '2026-10-25',
    wcc: 'Sunday, October 25, 2026',
    wccDate: '2026-10-25',
  },
  waterYear: 2027,
  basins: BASINS,
  warnings: [
    'WCC report lists 3 station(s) missing from the registry (skipped): HURD 1 S',
  ],
};
