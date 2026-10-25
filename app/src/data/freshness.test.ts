import { describe, expect, it } from 'vitest';
import { formatDataDate, formatRelativeTime, stalenessOf } from './freshness';

const NOW = new Date('2026-10-25T20:00:00.000Z');

describe('stalenessOf', () => {
  it('is fresh within 36 hours of the fetch', () => {
    expect(stalenessOf('2026-10-25T18:30:00.000Z', NOW)).toBe('fresh');
    expect(stalenessOf('2026-10-24T08:01:00.000Z', NOW)).toBe('fresh');
  });

  it('is stale between 36 and 72 hours (one missed run)', () => {
    expect(stalenessOf('2026-10-24T07:59:00.000Z', NOW)).toBe('stale');
    expect(stalenessOf('2026-10-23T09:00:00.000Z', NOW)).toBe('stale');
  });

  it('is very stale beyond 72 hours (two or more missed runs)', () => {
    expect(stalenessOf('2026-10-22T08:59:00.000Z', NOW)).toBe('very-stale');
    expect(stalenessOf('2026-10-01T00:00:00.000Z', NOW)).toBe('very-stale');
  });

  it('treats unparseable timestamps as very stale', () => {
    expect(stalenessOf('not-a-date', NOW)).toBe('very-stale');
  });
});

describe('formatRelativeTime', () => {
  it('formats minutes, hours, and days', () => {
    expect(formatRelativeTime('2026-10-25T19:59:30.000Z', NOW)).toBe('just now');
    expect(formatRelativeTime('2026-10-25T19:18:00.000Z', NOW)).toBe('42m ago');
    expect(formatRelativeTime('2026-10-25T02:00:00.000Z', NOW)).toBe('18h ago');
    expect(formatRelativeTime('2026-10-22T20:00:00.000Z', NOW)).toBe('3d ago');
  });

  it('reports unknown for unparseable timestamps', () => {
    expect(formatRelativeTime('nope', NOW)).toBe('unknown');
  });
});

describe('formatDataDate', () => {
  it('formats a full date for the fallback banner', () => {
    expect(formatDataDate('2026-10-25T16:21:27.815Z')).toMatch(/2026/);
    expect(formatDataDate('2026-10-25T16:21:27.815Z')).toMatch(/October|Oct/);
  });

  it('degrades gracefully for unparseable timestamps', () => {
    expect(formatDataDate('nope')).toBe('an unknown date');
  });
});
