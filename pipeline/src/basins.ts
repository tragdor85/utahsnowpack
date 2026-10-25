/**
 * The canonical 8 KSL basins (docs/PLAN.md task 4).
 *
 * KSL's page renders 16 sections, but only these 8 are the "major basins" of
 * the baseline capture (data/ksl-baseline-2026-10-24.json). Sites are assigned
 * to canonical basins via the pinned registry (data/sites.json), never via the
 * KSL section a row happens to sit in — KSL re-groups rows between sections
 * without changing values (docs/data-sources.md).
 *
 * `wccGroup` is the official WCC report group name for the same drainage
 * (docs/data-sources.md): the normalizer uses it to learn which stations
 * reported today (the WCC report lists only stations with a reading).
 */
export interface BasinDef {
  /** Stable slug, as in the KSL baseline JSON and the registry. */
  id: string;
  /** Display name as KSL prints it (page order). */
  kslName: string;
  /** WCC report group name for this drainage. */
  wccGroup: string;
}

export const BASINS: readonly BasinDef[] = [
  { id: 'raft_river', kslName: 'RAFT RIVER', wccGroup: 'RAFT RIVER' },
  { id: 'bear_river', kslName: 'BEAR RIVER', wccGroup: 'BEAR RIVER' },
  { id: 'weber_ogden', kslName: 'WEBER-OGDEN', wccGroup: 'WEBER-OGDEN RIVERS' },
  { id: 'provo_river', kslName: 'PROVO RIVER', wccGroup: 'PROVO R.-UTAH LAKE-JORDAN R.' },
  { id: 'green_river', kslName: 'NE UINTAHS', wccGroup: 'NORTHEASTERN UINTAHS' },
  { id: 'duchesne', kslName: 'DUCHESNE', wccGroup: 'DUCHESNE RIVER' },
  { id: 'sevier_river', kslName: 'UPPER SEVIER', wccGroup: 'UPPER SEVIER RIVER' },
  { id: 'beaver_river', kslName: 'BEAVER RIVER', wccGroup: 'BEAVER RIVER' },
] as const;
