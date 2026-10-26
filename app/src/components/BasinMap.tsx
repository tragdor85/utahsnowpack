import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BAND_COLORS, UTAH_VIEW, basinFeatures, siteFeatures } from '../map/layers';
import { formatPct, type SnowpackData } from '../types';

/**
 * Interactive basin map (docs/PLAN.md task 7): MapLibre GL with a free
 * raster basemap, the 8 basin polygons colored by SWE band, site dots,
 * hover tooltips, and click selection. Keyboard selection lives in the basin
 * list (the map is a mouse surface); both drive the same selection state.
 *
 * Basemap: Esri's World_Imagery satellite tiles — free, no API key, no
 * account (the legacy keyless CARTO dark endpoint went dark: it now serves
 * blank placeholder tiles, which left the map a featureless gray slab).
 * Satellite terrain gives the basins real geographic context (mountains,
 * rivers, the Great Salt Lake) and suits the dark theme.
 *
 * Degrades gracefully: the basemap is the only network dependency. Offline
 * or without WebGL the map falls back to a dark background (or a message)
 * while the list keeps working.
 */

/** Minimal inline style: dark background + raster basemap. */

// Vite inlines the worker module into the main bundle, so the URL maplibre
// derives from import.meta.url 404s; point it at the emitted asset instead.
maplibregl.setWorkerUrl(workerUrl);

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      // ArcGIS tile scheme is z/y/x (row before column) — not z/x/y.
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, GIS User Community',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } },
    { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.85 } },
  ],
};

/** Data-driven band color for a feature's `band` property. */
function bandColorExpression(): maplibregl.ExpressionSpecification {
  const stops: (string | number)[] = [];
  for (const [band, color] of Object.entries(BAND_COLORS)) stops.push(band, color);
  return [
    'match',
    ['get', 'band'],
    ...stops,
    BAND_COLORS.none,
  ] as unknown as maplibregl.ExpressionSpecification;
}

function fillOpacityExpression(
  selectedId: string | null,
): maplibregl.ExpressionSpecification | number {
  if (selectedId === null) return 0.3;
  return [
    'case',
    ['==', ['get', 'id'], selectedId],
    0.55,
    0.3,
  ] as maplibregl.ExpressionSpecification;
}

export function BasinMap({
  data,
  selectedId,
  onSelect,
}: {
  data: SnowpackData;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dataRef = useRef(data);
  dataRef.current = data;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [failed, setFailed] = useState(false);

  // Map lifecycle (once).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: maplibregl.Map | null = null;
    try {
      map = new maplibregl.Map({
        container,
        style: STYLE,
        center: UTAH_VIEW.center,
        zoom: UTAH_VIEW.zoom,
        dragRotate: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    // Test hook for e2e (screen projection of basins); not part of the UI.
    (container as HTMLDivElement & { __map?: maplibregl.Map }).__map = map;

    const popup = new maplibregl.Popup({ offset: 10, closeButton: false });
    popupRef.current = popup;

    // Add the data layers once the style spec has parsed. (The `load` event
    // is gated on the raster basemap tiles, which depend on the network and
    // would delay the data layers for nothing.)
    map.once('style.load', () => {
      map.addSource('basins', { type: 'geojson', data: basinFeatures(dataRef.current!) });
      map.addLayer({
        id: 'basins-fill',
        type: 'fill',
        source: 'basins',
        paint: {
          'fill-color': bandColorExpression(),
          'fill-opacity': 0.3,
        },
      });
      map.addLayer({
        id: 'basins-line',
        type: 'line',
        source: 'basins',
        paint: {
          'line-color': '#8b949e',
          'line-width': 1,
        },
      });
      map.addSource('sites', { type: 'geojson', data: siteFeatures(dataRef.current!) });
      map.addLayer({
        id: 'sites',
        type: 'circle',
        source: 'sites',
        paint: {
          'circle-radius': [
            'case',
            ['get', 'reported'],
            3.5,
            2.5,
          ] as maplibregl.ExpressionSpecification,
          'circle-color': [
            'case',
            ['get', 'reported'],
            bandColorExpression(),
            BAND_COLORS.none,
          ] as maplibregl.ExpressionSpecification,
          'circle-opacity': [
            'case',
            ['get', 'reported'],
            0.95,
            0.4,
          ] as maplibregl.ExpressionSpecification,
          'circle-stroke-color': '#0d1117',
          'circle-stroke-width': 1,
        },
      });
      applySelection(map, selectedIdRef.current);
    });

    map.on('click', 'basins-fill', (e) => {
      const feature = e.features?.[0];
      if (feature) onSelectRef.current((feature.properties as { id: string }).id);
    });
    map.on('mousemove', 'basins-fill', (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties as {
        name: string;
        swePctAvg: number | null;
        sitesReporting: number;
        sitesTotal: number;
      };
      map!.getCanvas().style.cursor = 'pointer';
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="map-tooltip"><strong>${p.name}</strong><br>${
            p.swePctAvg === null ? 'no data' : `${formatPct(p.swePctAvg)} of average SWE`
          }<br>${p.sitesReporting}/${p.sitesTotal} sites reported</div>`,
        )
        .addTo(map!);
    });
    map.on('mouseleave', 'basins-fill', () => {
      map!.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('mousemove', 'sites', (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties as { name: string; swePct: number | null; reported: boolean };
      map!.getCanvas().style.cursor = 'pointer';
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="map-tooltip"><strong>${p.name}</strong><br>${
            p.swePct === null
              ? p.reported
                ? 'reported — SWE missing'
                : 'no report today'
              : `${formatPct(p.swePct)} of average SWE`
          }</div>`,
        )
        .addTo(map!);
    });
    map.on('mouseleave', 'sites', () => {
      map!.getCanvas().style.cursor = '';
      popup.remove();
    });

    return () => {
      popup.remove();
      map!.remove();
      if (mapRef.current === map) mapRef.current = null;
      (container as HTMLDivElement & { __map?: maplibregl.Map }).__map = undefined;
    };
  }, []);

  // Data changed → refresh the layer sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('basins')) return;
    type SetDataArg = Parameters<maplibregl.GeoJSONSource['setData']>[0];
    (map.getSource('basins') as maplibregl.GeoJSONSource | undefined)?.setData(
      basinFeatures(data) as unknown as SetDataArg,
    );
    (map.getSource('sites') as maplibregl.GeoJSONSource | undefined)?.setData(
      siteFeatures(data) as unknown as SetDataArg,
    );
  }, [data]);

  // Selection changed → highlight + fly to the basin.
  useEffect(() => {
    applySelection(mapRef.current, selectedId);
  }, [selectedId]);

  if (failed) {
    return (
      <div className="basin-map basin-map--fallback" role="img" aria-label="Basin map unavailable">
        <p>Map unavailable (needs WebGL) — use the basin list below.</p>
      </div>
    );
  }

  return (
    <div
      className="basin-map"
      ref={containerRef}
      role="img"
      aria-label={`Map of Utah's 8 snowpack basins, colored by percent of average SWE. Use the basin list below for keyboard selection.`}
    />
  );
}

function applySelection(map: maplibregl.Map | null, selectedId: string | null) {
  if (!map || !map.getSource('basins')) return;
  map.setPaintProperty('basins-fill', 'fill-opacity', fillOpacityExpression(selectedId));
  map.setPaintProperty(
    'basins-line',
    'line-width',
    selectedId === null
      ? 1
      : (['case', ['==', ['get', 'id'], selectedId], 2, 1] as maplibregl.ExpressionSpecification),
  );
  map.setPaintProperty(
    'basins-line',
    'line-color',
    selectedId === null
      ? '#8b949e'
      : ([
          'case',
          ['==', ['get', 'id'], selectedId],
          '#58a6ff',
          '#8b949e',
        ] as maplibregl.ExpressionSpecification),
  );
  if (selectedId === null) return;
  if (!map.getSource('basins')) return;
  const features = map.querySourceFeatures('basins');
  const feature = features.find((f) => f.properties?.id === selectedId);
  if (feature && feature.geometry.type === 'Polygon') {
    const bounds = new maplibregl.LngLatBounds();
    for (const coord of feature.geometry.coordinates[0]) bounds.extend(coord as [number, number]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 6.5, duration: 600 });
  }
}
