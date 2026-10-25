import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';
import { MOCK_SNOWPACK } from '../data/mock';

const NOW = new Date('2026-10-25T20:00:00.000Z');

function withFetchedAt(fetchedAt: string) {
  return { ...MOCK_SNOWPACK, fetchedAt };
}

describe('Header freshness (task 10)', () => {
  it('shows a relative updated stamp', () => {
    render(<Header data={withFetchedAt('2026-10-25T18:30:00.000Z')} now={NOW} />);
    expect(screen.getByTestId('updated-relative')).toHaveTextContent('2h ago');
  });

  it('shows no staleness badge for fresh data', () => {
    render(<Header data={withFetchedAt('2026-10-25T18:30:00.000Z')} now={NOW} />);
    expect(screen.queryByTestId('staleness-badge')).not.toBeInTheDocument();
  });

  it('shows a stale badge after one missed run', () => {
    render(<Header data={withFetchedAt('2026-10-24T07:00:00.000Z')} now={NOW} />);
    const badge = screen.getByTestId('staleness-badge');
    expect(badge).toHaveTextContent('stale');
    expect(badge).toHaveClass('header__staleness--stale');
  });

  it('shows a very-stale badge after two missed runs', () => {
    render(<Header data={withFetchedAt('2026-10-22T08:00:00.000Z')} now={NOW} />);
    const badge = screen.getByTestId('staleness-badge');
    expect(badge).toHaveTextContent('very stale');
    expect(badge).toHaveClass('header__staleness--very-stale');
  });

  it('omits the stamps row entirely without data', () => {
    render(<Header data={null} now={NOW} />);
    expect(screen.queryByTestId('updated-relative')).not.toBeInTheDocument();
  });
});
