import { formatPct, type SnowpackBasin } from '../types';

/**
 * The main map area's stand-in (docs/PLAN.md task 6): the 8 basins as a
 * keyboard-navigable list. Task 7 replaces the list with the MapLibre map;
 * the selection contract (id + callback) is the same.
 */
export function BasinList({
  basins,
  selectedId,
  onSelect,
}: {
  basins: SnowpackBasin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="basin-list" aria-label="Basins">
      {basins.map((basin) => {
        const selected = basin.id === selectedId;
        return (
          <button
            key={basin.id}
            type="button"
            className={`basin-list__item${selected ? ' basin-list__item--selected' : ''}`}
            aria-pressed={selected}
            data-basin-id={basin.id}
            onClick={() => onSelect(basin.id)}
          >
            <span
              className={`band-chip basin-list__chip band-chip--${basin.colorBand}`}
              aria-hidden="true"
            />
            <span className="basin-list__name">{basin.name}</span>
            <span className="basin-list__pct">{formatPct(basin.swePctAvg)}</span>
            <span className="basin-list__reporting">
              {basin.sitesReporting}/{basin.sitesTotal} sites
            </span>
          </button>
        );
      })}
    </div>
  );
}
