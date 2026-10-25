import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeriesChart } from './SeriesChart';
import type { DailyPoint } from '../data/timeseries';
import type { MonthlyPoint } from '../data/history';

const points: DailyPoint[] = [
  { date: '2026-10-01', swe: 0.5, precip: 1 },
  { date: '2026-10-02', swe: 1.2, precip: null },
  { date: '2026-10-03', swe: null, precip: 2 },
];

const history: MonthlyPoint[] = [
  { key: '2025-01', swe: 6.9, precip: 11.2 },
  { key: '2025-02', swe: 10.9, precip: 15.5 },
];

// `width` gives the chart fixed dimensions so it renders real SVG content
// under jsdom (no ResizeObserver there).
const base = {
  title: 'Tony Grove',
  label: 'SWE chart for Tony Grove',
  width: 600,
  historyMode: 'wy' as const,
  historyState: 'idle' as const,
};

describe('SeriesChart', () => {
  it('renders the title and an SVG chart with one element per data point', () => {
    render(<SeriesChart {...base} points={points} history={null} />);
    expect(screen.getByText('Tony Grove')).toBeInTheDocument();
    const svg = document.querySelector('.chart svg')!;
    expect(svg).not.toBeNull();
    // Area path + one bar per point with a precip value.
    expect(svg.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
    expect(svg.querySelectorAll('.recharts-curve.recharts-area-curve')).toHaveLength(1);
  });

  it('exposes an accessible summary on the figure', () => {
    render(<SeriesChart {...base} points={points} history={null} />);
    const fig = screen.getByRole('img', { name: /SWE chart for Tony Grove/ });
    expect(fig).toBeInTheDocument();
  });

  it('shows the empty state when there is no data', () => {
    render(<SeriesChart {...base} points={[]} history={null} />);
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
    expect(document.querySelector('.chart svg')).toBeNull();
  });

  it('shows the empty state when every point is null', () => {
    render(
      <SeriesChart
        {...base}
        points={[{ date: '2026-10-01', swe: null, precip: null }]}
        history={null}
      />,
    );
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
  });

  it('switches to the multi-year series when toggled', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <SeriesChart
        {...base}
        points={points}
        history={history}
        historyMode="multi"
        onToggleHistory={onToggle}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'This water year' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while the multi-year history fetches', () => {
    render(
      <SeriesChart
        {...base}
        points={points}
        history={null}
        historyMode="multi"
        historyState="loading"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading multi-year history');
  });

  it('shows an error state when the multi-year fetch fails', () => {
    render(
      <SeriesChart
        {...base}
        points={points}
        history={null}
        historyMode="multi"
        historyState="error"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load multi-year history');
  });

  it('disables the toggle while loading', () => {
    render(
      <SeriesChart
        {...base}
        points={points}
        history={null}
        historyMode="multi"
        historyState="loading"
        onToggleHistory={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /This water year/ })).toBeDisabled();
  });
});
