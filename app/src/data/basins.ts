/**
 * The 8 KSL basins as simplified GeoJSON polygons (docs/PLAN.md task 7).
 *
 * Hand-traced from the registry site coordinates: each polygon is the
 * padded convex hull of its roster sites (data/sites.json), clipped to
 * Utah (north edge extended for the Idaho-headwater sites). They are
 * approximate display shapes — the basins genuinely overlap (a site can
 * sit in two), and the registry, not the map, is the source of truth.
 */
import type { FeatureCollection, Polygon } from 'geojson';

export const BASIN_POLYGONS: FeatureCollection<Polygon, { id: string; name: string }> =
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "raft_river",
        "name": "Raft River"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -113.842,
              41.66
            ],
            [
              -113.186,
              41.66
            ],
            [
              -113.186,
              42.576
            ],
            [
              -113.842,
              42.576
            ],
            [
              -113.842,
              41.66
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "bear_river",
        "name": "Bear River"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -112.216,
              42.6
            ],
            [
              -112.351,
              42.389
            ],
            [
              -111.962,
              41.278
            ],
            [
              -110.821,
              40.332
            ],
            [
              -110.626,
              40.575
            ],
            [
              -110.459,
              42.6
            ],
            [
              -112.216,
              42.6
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "weber_ogden",
        "name": "Weber-Ogden"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -112.093,
              41.503
            ],
            [
              -111.923,
              40.929
            ],
            [
              -111.654,
              40.627
            ],
            [
              -111.559,
              40.525
            ],
            [
              -110.993,
              40.511
            ],
            [
              -110.799,
              40.596
            ],
            [
              -110.928,
              40.826
            ],
            [
              -110.956,
              40.865
            ],
            [
              -111.512,
              41.62
            ],
            [
              -112.063,
              41.512
            ],
            [
              -112.093,
              41.503
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "provo_river",
        "name": "Provo River"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -112.883,
              40.555
            ],
            [
              -112.628,
              39.831
            ],
            [
              -111.157,
              39.74
            ],
            [
              -111.116,
              39.774
            ],
            [
              -110.722,
              40.795
            ],
            [
              -111.723,
              41.042
            ],
            [
              -112.883,
              40.555
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "green_river",
        "name": "Green River (NE Uintahs)"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -110.803,
              40.849
            ],
            [
              -109.798,
              40.541
            ],
            [
              -109.351,
              40.682
            ],
            [
              -109.896,
              40.929
            ],
            [
              -110.573,
              40.986
            ],
            [
              -110.702,
              40.996
            ],
            [
              -110.803,
              40.849
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "duchesne",
        "name": "Duchesne"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -112.193,
              38.285
            ],
            [
              -111.638,
              37.691
            ],
            [
              -109.599,
              37.399
            ],
            [
              -109.23,
              37.386
            ],
            [
              -109.178,
              37.459
            ],
            [
              -109.05,
              37.872
            ],
            [
              -109.05,
              38.615
            ],
            [
              -109.751,
              41.019
            ],
            [
              -109.91,
              41.236
            ],
            [
              -110.704,
              41.188
            ],
            [
              -111.13,
              41.11
            ],
            [
              -111.53,
              40.613
            ],
            [
              -112.193,
              38.285
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "sevier_river",
        "name": "Upper Sevier"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -113.129,
              37.336
            ],
            [
              -112.706,
              37.225
            ],
            [
              -112.626,
              37.222
            ],
            [
              -112.309,
              37.267
            ],
            [
              -111.803,
              37.675
            ],
            [
              -111.011,
              39.776
            ],
            [
              -111.071,
              40.077
            ],
            [
              -112.496,
              40.406
            ],
            [
              -113.129,
              37.336
            ]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "beaver_river",
        "name": "Beaver River"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              -114.06,
              37.607
            ],
            [
              -114.06,
              37.34
            ],
            [
              -113.752,
              37.279
            ],
            [
              -112.523,
              37.392
            ],
            [
              -112.207,
              37.437
            ],
            [
              -110.996,
              38.12
            ],
            [
              -111.171,
              38.329
            ],
            [
              -112.365,
              38.687
            ],
            [
              -114.06,
              37.607
            ]
          ]
        ]
      }
    }
  ]
};
