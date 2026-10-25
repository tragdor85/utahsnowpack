/**
 * Share-card image (docs/PLAN.md task 10): renders the current
 * `data/snowpack.json` as a 1200×630 PNG for the og:image / twitter:image
 * tags — the 8 basins as band-colored convex hulls (the same shapes the app
 * map draws) with per-basin SWE percentages.
 *
 * The daily pipeline commits `data/og-image.png`; the app copies it to
 * `/og-image.png` at build time (app/scripts/copy-snowpack.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { BASINS } from './basins';
import { loadRegistry } from './registry';

const root = join(import.meta.dirname, '..', '..');
const DATA_DIR = join(root, 'data');

/** KSL legend colors (docs/data-sources.md) + legible text on each. */
const BAND_COLORS: Record<string, { fill: string; text: string }> = {
  red: { fill: '#ff0000', text: '#000000' },
  orange: { fill: '#ff9800', text: '#000000' },
  yellow: { fill: '#ffff00', text: '#000000' },
  green: { fill: '#00ff00', text: '#000000' },
  blue1: { fill: '#73ffdf', text: '#000000' },
  blue2: { fill: '#00a9e6', text: '#ffffff' },
  blue3: { fill: '#0000ff', text: '#ffffff' },
  none: { fill: '#30363d', text: '#8b949e' },
};

interface SnowpackBasin {
  id: string;
  name: string;
  swePctAvg: number | null;
  colorBand: string;
}

interface SnowpackFile {
  waterYear: number;
  fetchedAt: string;
  basins: SnowpackBasin[];
}

type Point = [number, number];

/** Monotone-chain convex hull (Andrew's). Input: lon/lat pairs. */
function convexHull(points: Point[]): Point[] {
  const pts = [...new Set(points.map((p) => p.join(',')))].map(
    (s) => s.split(',').map(Number) as Point,
  );
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the 1200×630 SVG card. The map occupies the left; the basin value
 * list the right (page order, like the app).
 */
export function renderOgImageSvg(
  data: SnowpackFile,
  registrySites: {
    latitude: number;
    longitude: number;
    basins: string[];
  }[],
): string {
  const W = 1200;
  const H = 630;

  // Map box + projection (equirectangular over the registry extent).
  const map = { x: 60, y: 150, w: 560, h: 400 };
  const lons = registrySites.map((s) => s.longitude);
  const lats = registrySites.map((s) => s.latitude);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const pad = 0.06;
  const spanLon = (maxLon - minLon) * (1 + 2 * pad) || 1;
  const spanLat = (maxLat - minLat) * (1 + 2 * pad) || 1;
  const px = (lon: number) =>
    map.x + ((lon - (minLon - (maxLon - minLon) * pad)) / spanLon) * map.w;
  const py = (lat: number) =>
    map.y + map.h - ((lat - (minLat - (maxLat - minLat) * pad)) / spanLat) * map.h;

  const basinById = new Map(data.basins.map((b) => [b.id, b]));
  const sitesByBasin = new Map<string, Point[]>();
  for (const site of registrySites) {
    for (const basinId of site.basins) {
      const list = sitesByBasin.get(basinId) ?? [];
      list.push([site.longitude, site.latitude]);
      sitesByBasin.set(basinId, list);
    }
  }

  const hulls = BASINS.map((def) => {
    const sites = sitesByBasin.get(def.id) ?? [];
    const basin = basinById.get(def.id);
    if (sites.length === 0 || basin === undefined) return null;
    const band = BAND_COLORS[basin.colorBand] ?? BAND_COLORS.none;
    const pct = basin.swePctAvg === null ? '—' : `${Math.round(basin.swePctAvg)}%`;
    const [cx, cy] = centroid(sites);
    // A 1–2 site basin has no hull; mark it with a dot instead.
    if (sites.length < 3) {
      return { def, band, path: null, cx: px(cx), cy: py(cy), pct };
    }
    const hull = convexHull(sites);
    const path =
      hull
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`)
        .join('') + 'Z';
    return { def, band, path, cx: px(cx), cy: py(cy), pct };
  }).filter((h): h is NonNullable<typeof h> => h !== null);

  const hullSvg = hulls
    .map((h) =>
      h.path === null
        ? `    <circle cx="${h.cx.toFixed(1)}" cy="${h.cy.toFixed(1)}" r="10" fill="${h.band.fill}" fill-opacity="0.8" stroke="${h.band.fill}" stroke-width="2"/>`
        : `    <path d="${h.path}" fill="${h.band.fill}" fill-opacity="0.5" stroke="${h.band.fill}" stroke-width="2"/>`,
    )
    .join('\n');
  const labelSvg = hulls
    .map(
      (h) =>
        `    <text x="${h.cx.toFixed(1)}" y="${(h.cy - 6).toFixed(1)}" text-anchor="middle" font-size="19" font-weight="600" fill="${h.band.text}" stroke="#0d1117" stroke-width="4" paint-order="stroke">${escapeXml(h.def.kslName)}</text>\n` +
        `    <text x="${h.cx.toFixed(1)}" y="${(h.cy + 18).toFixed(1)}" text-anchor="middle" font-size="24" font-weight="700" fill="${h.band.text}" stroke="#0d1117" stroke-width="4" paint-order="stroke">${h.pct}</text>`,
    )
    .join('\n');

  const rows = data.basins
    .map((b, i) => {
      const band = BAND_COLORS[b.colorBand] ?? BAND_COLORS.none;
      const y = 190 + i * 44;
      const pct = b.swePctAvg === null ? '—' : `${Math.round(b.swePctAvg)}%`;
      return (
        `    <rect x="680" y="${y - 18}" width="26" height="26" rx="5" fill="${band.fill}"/>\n` +
        `    <text x="722" y="${y + 2}" font-size="26" fill="#e6edf3">${escapeXml(b.name)}</text>\n` +
        `    <text x="1140" y="${y + 2}" font-size="26" font-weight="700" fill="${band.text === '#000000' ? band.fill : '#e6edf3'}" text-anchor="end">${pct}</text>`
      );
    })
    .join('\n');

  const updated = new Date(data.fetchedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <text x="60" y="82" font-size="52" font-weight="700" fill="#e6edf3">Utah Snowpack</text>
  <text x="60" y="120" font-size="26" fill="#8b949e">Water year ${data.waterYear} · SWE percent of average · updated ${updated}</text>
  <g>
${hullSvg}
${labelSvg}
  </g>
  <g>
${rows}
  </g>
  <text x="60" y="600" font-size="20" fill="#8b949e">NRCS SNOTEL · KSL Utah Snowpack Totals · WCC Snowpack Update Report</text>
</svg>`;
}

async function main(): Promise<void> {
  const data = JSON.parse(readFileSync(join(DATA_DIR, 'snowpack.json'), 'utf8')) as SnowpackFile;
  const registry = loadRegistry();
  const svg = renderOgImageSvg(
    data,
    registry.sites.map((s) => ({
      latitude: s.latitude,
      longitude: s.longitude,
      basins: s.basins,
    })),
  );
  const out = join(DATA_DIR, 'og-image.png');
  await sharp(Buffer.from(svg)).png().toFile(out);
  writeFileSync(join(DATA_DIR, 'og-image.svg'), svg);
  console.log(`wrote ${out} (1200×630)`);
}

await main();
