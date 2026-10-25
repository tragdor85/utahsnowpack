import { COLOR_BAND_META, type ColorBand } from '../types';

/**
 * KSL's legend, mirrored as design tokens (docs/PLAN.md task 6). The seven
 * KSL bands plus `none` (no data). Swatches use the exact colors KSL paints.
 */
const BANDS: ColorBand[] = ['red', 'orange', 'yellow', 'green', 'blue1', 'blue2', 'blue3', 'none'];

export function Legend() {
  return (
    <ul className="legend" aria-label="Snowpack percent-of-average legend">
      {BANDS.map((band) => {
        const meta = COLOR_BAND_META[band];
        return (
          <li key={band} className={`legend__band legend__band--${band}`}>
            <span className={`band-chip band-chip--${band}`} aria-hidden="true" />
            <span>{meta.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
