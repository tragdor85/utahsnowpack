/**
 * Freshness helpers (docs/PLAN.md task 10).
 *
 * The pipeline runs daily, so `fetchedAt` older than ~36h means a missed
 * run and older than ~72h means two or more. Pure functions of (iso, now)
 * so tests can pin the clock.
 */

export type Staleness = 'fresh' | 'stale' | 'very-stale';

const HOUR_MS = 3_600_000;

export function stalenessOf(fetchedAt: string, now: Date): Staleness {
  const hours = (now.getTime() - new Date(fetchedAt).getTime()) / HOUR_MS;
  if (Number.isNaN(hours)) return 'very-stale';
  if (hours < 36) return 'fresh';
  if (hours < 72) return 'stale';
  return 'very-stale';
}

/** "just now" / "42m ago" / "26h ago" / "3d ago" — coarse on purpose. */
export function formatRelativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'unknown';
  if (ms < 60_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Human date for the fallback banner, e.g. "Oct 25, 2026". */
export function formatDataDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
