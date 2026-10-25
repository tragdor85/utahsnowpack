import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { BASIN_POLYGONS } from '../data/basins';
import { colorBand, type ColorBand, type SnowpackData } from '../types';

/**
 * Map layer data builders (docs/PLAN.md task 7). Pure functions from
 * `snowpack.json` to GeoJSON — unit-testable without a map.
 */

/**
 * Hex colors per band — the same palette as the `--band-*` design tokens
 * (styles.css). Kept in JS because MapLibre paint expressions need literal
 * colors; the tokens remain the source of truth for the DOM.
 */
export const BAND_COLORS: Record<ColorBand, string> = {
  red: '#f00',
  orange: '#ff9800',
  yellow: '#ffff00',
  green: '#00ff00',
  blue1: '#73ffdf',
  blue2: '#00a9e6',
  blue3: '#0000ff',
  none: '#30363d',
};

export type BasinFeatureProps = {
  id: string;
  name: string;
  /** Current legend band (drives the fill color). */
  band: ColorBand;
  /** SWE % of average for the tooltip (null = no data). */
  swePctAvg: number | null;
  sitesReporting: number;
  sitesTotal: number;
};

/**
 * Basin polygons with the current data's band + tooltip values. Polygons
 * without a matching basin (shouldn't happen) render as `none`.
 */
export function basinFeatures(data: SnowpackData): FeatureCollection<Polygon, BasinFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: BASIN_POLYGONS.features.map((f) => {
      const basin = data.basins.find((b) => b.id === f.properties.id);
      return {
        type: 'Feature' as const,
        properties: {
          ...f.properties,
          // The data's (KSL's) name wins; the polygon name is a fallback.
          name: basin?.name ?? f.properties.name,
          band: basin?.colorBand ?? 'none',
          swePctAvg: basin?.swePctAvg ?? null,
          sitesReporting: basin?.sitesReporting ?? 0,
          sitesTotal: basin?.sitesTotal ?? 0,
        },
        geometry: f.geometry,
      };
    }),
  };
}

export type SiteFeatureProps = {
  name: string;
  /** Owning basin id (for the tooltip). */
  basinId: string;
  /** SWE % of average (null = not reported / missing). */
  swePct: number | null;
  /** True when the station reported today (drives dot color/opacity). */
  reported: boolean;
  band: ColorBand;
};

/**
 * One dot per site, deduped by triplet (a site in two basins appears once,
 * colored by its own SWE band). Sites without coordinates are skipped.
 */
export function siteFeatures(data: SnowpackData): FeatureCollection<Point, SiteFeatureProps> {
  const seen = new Map<string, Feature<Point, SiteFeatureProps>>();
  for (const basin of data.basins) {
    for (const site of basin.sites) {
      if (seen.has(site.stationTriplet)) continue;
      seen.set(site.stationTriplet, {
        type: 'Feature',
        properties: {
          name: site.name,
          basinId: basin.id,
          swePct: site.swePctAvg,
          reported: site.reportedToday,
          band: colorBand(site.swePctAvg),
        },
        geometry: { type: 'Point', coordinates: [site.longitude, site.latitude] },
      });
    }
  }
  return { type: 'FeatureCollection', features: [...seen.values()] };
}

/** Map center/zoom for the whole state (Utah, minus the Idaho-headwater tail). */
export const UTAH_VIEW = { center: [-111.6, 39.9] as [number, number], zoom: 5.4 };
